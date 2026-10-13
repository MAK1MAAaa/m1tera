import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentToolResult } from '@earendil-works/pi-agent-core';
import { ARTIFACT_BYTE_LIMIT, ArtifactStore, createReadArtifactTool, offloadToolResult, sliceTextPage } from '../../runtime/artifacts.js';
import { countEstimatedTokens } from '../../runtime/context.js';
import { createTools } from '../../runtime/tools.js';
import { readAttachments } from '../../runtime/attachments.js';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-artifacts-'));
  directories.push(directory);
  const store = new ArtifactStore(directory);
  await store.initialize();
  return { directory, store, sessionId: randomUUID() };
}

function result(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: { source: 'fixture' } };
}
function content(result: AgentToolResult<unknown>) {
  return result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}

describe('session artifacts', () => {
  it('stores exact UTF-8 content atomically with private permissions and verified metadata', async () => {
    const { directory, store, sessionId } = await fixture();
    const text = '\ufeff中文内容😀\n第二行';
    const metadata = await store.put(sessionId, text);
    expect(metadata).toEqual({ id: expect.stringMatching(/^[\da-f-]{36}$/), bytes: Buffer.byteLength(text), sha256: createHash('sha256').update(text).digest('hex'), totalCharacters: [...text].length });
    const folder = path.join(directory, 'artifacts', sessionId);
    expect(await readdir(folder)).toEqual([`${metadata.id}.txt`]);
    expect(await readFile(path.join(folder, `${metadata.id}.txt`), 'utf8')).toBe(text);
    if (process.platform !== 'win32') expect((await lstat(path.join(folder, `${metadata.id}.txt`))).mode & 0o777).toBe(0o600);
    const restarted = new ArtifactStore(directory);
    await restarted.initialize();
    expect((await restarted.read(sessionId, metadata.id)).text).toBe(text);
  });

  it('paginates a large single-line Chinese JSON without splitting emoji or losing its tail', async () => {
    const { store, sessionId } = await fixture();
    const text = JSON.stringify({ content: '你好😀'.repeat(7000), tail: '结束' });
    const metadata = await store.put(sessionId, text);
    let recovered = '';
    let offset = 0;
    for (;;) {
      const page = await store.read(sessionId, metadata.id, offset, 4001);
      expect([...page.text].length).toBeLessThanOrEqual(4001);
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/);
      recovered += page.text;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(recovered).toBe(text);
    expect((await store.read(sessionId, metadata.id, metadata.totalCharacters)).text).toBe('');
  });

  it('deduplicates simultaneous writes in a session without sharing IDs across sessions', async () => {
    const { directory, store, sessionId } = await fixture();
    const text = '稳定的内容😀';
    const [first, second, third] = await Promise.all([store.put(sessionId, text), store.put(sessionId, text), store.put(sessionId, text)]);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(await store.put(sessionId, text)).toEqual(first);
    expect(await readdir(path.join(directory, 'artifacts', sessionId))).toHaveLength(1);
    expect((await store.put(randomUUID(), text)).id).not.toBe(first.id);
    const target = path.join(directory, 'artifacts', sessionId, `${first.id}.txt`);
    await rm(target);
    await symlink(path.join(directory, 'outside'), target);
    await expect(store.put(sessionId, text)).rejects.toThrow('符号链接');
  });

  it('rejects invalid identifiers, sizes and pagination before exposing content', async () => {
    const { store, sessionId } = await fixture();
    await expect(store.put('../escape', 'text')).rejects.toThrow('UUID');
    await expect(store.put(sessionId, 'incomplete\ud800')).rejects.toThrow('Unicode');
    await expect(store.put(sessionId, 'x'.repeat(ARTIFACT_BYTE_LIMIT + 1))).rejects.toThrow('8 MiB');
    const saved = await store.put(sessionId, 'abcd');
    for (const [offset, limit] of [[-1, 1], [0.5, 1], [0, 0], [0, 16385], [Number.NaN, 1], [0, Number.POSITIVE_INFINITY]]) {
      await expect(store.read(sessionId, saved.id, offset, limit)).rejects.toThrow();
    }
    await expect(store.read(sessionId, saved.id, 5)).rejects.toThrow('超出');
    await expect(store.read(sessionId, '../escape')).rejects.toThrow('UUID');
    await expect(store.read(randomUUID(), saved.id)).rejects.toThrow();
  });

  it('rejects symlink artifacts, symlink session directories and root replacement', async () => {
    const { directory, store, sessionId } = await fixture();
    const metadata = await store.put(sessionId, 'secret');
    const folder = path.join(directory, 'artifacts', sessionId);
    const filename = path.join(folder, `${metadata.id}.txt`);
    const outside = path.join(directory, 'outside.txt');
    await writeFile(outside, 'outside secret');
    await rm(filename);
    await symlink(outside, filename);
    await expect(store.read(sessionId, metadata.id)).rejects.toThrow('符号链接');
    const alien = randomUUID();
    await symlink(folder, path.join(directory, 'artifacts', alien));
    await expect(store.put(alien, 'no')).rejects.toThrow('符号链接');
    await expect(store.read(alien, metadata.id)).rejects.toThrow('符号链接');
    const externalFolder = path.join(directory, 'external-folder');
    await mkdir(externalFolder);
    await rm(path.join(directory, 'artifacts'), { recursive: true });
    await symlink(externalFolder, path.join(directory, 'artifacts'));
    await expect(store.put(sessionId, 'no')).rejects.toThrow('符号链接');
    expect(await readdir(externalFolder)).toEqual([]);
  });

  it('requires initialization and refuses an existing linked artifacts root', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-artifacts-init-'));
    directories.push(directory);
    await expect(new ArtifactStore(directory).put(randomUUID(), 'text')).rejects.toThrow('初始化');
    await mkdir(path.join(directory, 'linked'));
    await symlink(path.join(directory, 'linked'), path.join(directory, 'artifacts'));
    await expect(new ArtifactStore(directory).initialize()).rejects.toThrow('符号链接');
  });

  it('allows only disclosed IDs to the reader tool and observes cancellation', async () => {
    const { store, sessionId } = await fixture();
    const saved = await store.put(sessionId, 'abcdef');
    const hidden = await store.put(sessionId, 'private');
    const allowed = new Set<string>();
    const tool = createReadArtifactTool(store, sessionId, allowed);
    await expect(tool.execute('call', { id: saved.id })).rejects.toThrow('未授权');
    allowed.add(saved.id);
    expect(content(await tool.execute('call', { id: saved.id, offset: 2, limit: 2 }))).toContain('cd\n[还有内容：');
    expect(content(await tool.execute('call', { id: saved.id, offset: 4 }))).toBe('ef');
    await expect(tool.execute('call', { id: hidden.id })).rejects.toThrow('未授权');
    const controller = new AbortController(); controller.abort();
    await expect(tool.execute('call', { id: saved.id }, controller.signal)).rejects.toThrow('取消');
    expect(tool.replay).toBe('safe');
  });
});

describe('tool result offloading', () => {
  it('offloads a long unbroken Unicode JSON result with its complete content preserved', async () => {
    const { store, sessionId } = await fixture();
    const text = JSON.stringify({ data: '🤝复杂结果'.repeat(5000), final: '尾部' });
    const offloaded = await offloadToolResult(store, sessionId, 'run_command', result(text), 1000);
    expect(offloaded.offloaded).toBe(true);
    expect(countEstimatedTokens(content(offloaded.result))).toBeLessThanOrEqual(1000);
    const offset = offloaded.artifact!.totalCharacters - 20;
    expect((await store.read(sessionId, offloaded.artifact!.id, offset)).text).toBe([...text].slice(-20).join(''));
  });

  it('replaces a large result with a bounded head/tail preview and recoverable reference', async () => {
    const { store, sessionId } = await fixture();
    const text = `头部\n${'🤝复杂结果\n'.repeat(5000)}\n尾部`;
    const original = result(text);
    const offloaded = await offloadToolResult(store, sessionId, 'run_command', original, 1000);
    expect(offloaded.offloaded).toBe(true);
    expect(offloaded.result.details).toMatchObject({ source: 'fixture', artifact: offloaded.artifact });
    expect(content(offloaded.result)).toContain('头部');
    expect(content(offloaded.result)).toContain('尾部');
    expect(content(offloaded.result)).toContain(offloaded.artifact!.id);
    expect(countEstimatedTokens(content(offloaded.result))).toBeLessThanOrEqual(1000);
    expect(original.content[0]).toEqual({ type: 'text', text });
    const page = await store.read(sessionId, offloaded.artifact!.id, 12000, 20);
    expect(page.text).toBe([...text].slice(12000, 12020).join(''));
  });

  it('stores multiple text blocks in order and redacts secrets before writing or previewing', async () => {
    const { directory, store, sessionId } = await fixture();
    const original = { content: [{ type: 'text' as const, text: 'secret-token'.repeat(500) }, { type: 'text' as const, text: 'last block' }], details: {} };
    const offloaded = await offloadToolResult(store, sessionId, 'web_search', original, 100, { redact: (text) => text.replaceAll('secret-token', '[redacted]') });
    expect(offloaded.offloaded).toBe(true);
    const stored = await readFile(path.join(directory, 'artifacts', sessionId, `${offloaded.artifact!.id}.txt`), 'utf8');
    expect(stored).toBe(`${'[redacted]'.repeat(500)}\nlast block`);
    expect(stored + content(offloaded.result)).not.toContain('secret-token');
  });

  it('leaves short results, failures, paged reads, skills and mixed images unchanged', async () => {
    const { store, sessionId } = await fixture();
    const put = vi.spyOn(store, 'put');
    const long = result('long '.repeat(3000));
    const image = { content: [...long.content, { type: 'image' as const, data: 'data', mimeType: 'image/png' }], details: {} };
    for (const [tool, value, options] of [
      ['run_command', result('short'), {}], ['run_command', { ...long, isError: true }, {}], ['run_command', long, { isError: true }],
      ['read_file', long, {}], ['read_artifact', long, {}], ['use_skill', long, {}], ['web_search', image, {}],
    ] as const) expect(await offloadToolResult(store, sessionId, tool, value, 100, options)).toEqual({ result: value, offloaded: false });
    expect(put).not.toHaveBeenCalled();
  });

  it('keeps the original result and emits a fixed warning when storage fails', async () => {
    const { store, sessionId } = await fixture();
    vi.spyOn(store, 'put').mockRejectedValue(new Error('sensitive path and secret'));
    const original = result('结果记录\n'.repeat(4000));
    const failed = await offloadToolResult(store, sessionId, 'list_directory', original, 100);
    expect(failed.result).toBe(original);
    expect(failed).toEqual({ result: original, offloaded: false, warning: '工具结果外置未完成，保留原始结果。' });
    await expect(offloadToolResult(store, sessionId, 'tool', original, 0)).rejects.toThrow('正整数');
  });
});

describe('workspace text pagination', () => {
  async function workspaceTool(text: string) {
    const { directory } = await fixture();
    await writeFile(path.join(directory, 'text.txt'), text);
    const tools = createTools(['read_file'], { workspace: directory, approve: async () => false });
    return { directory, tool: tools[0] };
  }

  it('keeps short default reads unchanged and introduces no schemas when tools are disabled', async () => {
    const { directory, tool } = await workspaceTool('你好😀');
    expect(content(await tool.execute('call', { path: 'text.txt' }))).toBe('你好😀');
    expect(tool.replay).toBe('safe');
    expect(createTools([], { workspace: directory, approve: async () => false })).toEqual([]);
    expect(await readAttachments(directory, ['text.txt'])).toEqual([{ path: 'text.txt', size: 10, content: '你好😀' }]);
  });

  it('reads middle and tail of files beyond the former 128 KiB limit with Unicode offsets', async () => {
    const text = `开始${'中文😀'.repeat(20000)}终点`;
    const { tool } = await workspaceTool(text);
    const first = await tool.execute('call', { path: 'text.txt' });
    expect(content(first)).toContain('[还有内容：');
    expect(first.details).toMatchObject({ offset: 0, nextOffset: 4096, totalCharacters: [...text].length });
    const offset = [...text].length - 6;
    expect(content(await tool.execute('call', { path: 'text.txt', offset, limit: 6 }))).toBe([...text].slice(-6).join(''));
    const middle = await tool.execute('call', { path: 'text.txt', offset: 30000, limit: 16384 });
    expect(content(middle)).toContain([...text].slice(30000, 46384).join(''));
  });

  it('rejects invalid pages, oversized/binary/invalid UTF-8 files, and paths outside the workspace', async () => {
    const { directory, tool } = await workspaceTool('abc');
    await expect(tool.execute('call', { path: 'text.txt', offset: -1 })).rejects.toThrow('offset');
    await expect(tool.execute('call', { path: 'text.txt', offset: 4 })).rejects.toThrow('超出');
    await expect(tool.execute('call', { path: 'text.txt', limit: 16385 })).rejects.toThrow('limit');
    await writeFile(path.join(directory, 'large.txt'), 'x'.repeat(ARTIFACT_BYTE_LIMIT + 1));
    await expect(tool.execute('call', { path: 'large.txt' })).rejects.toThrow('8 MiB');
    await writeFile(path.join(directory, 'binary.txt'), Buffer.from([0, 1, 2]));
    await expect(tool.execute('call', { path: 'binary.txt' })).rejects.toThrow('二进制');
    await writeFile(path.join(directory, 'invalid.txt'), Buffer.from([0xff, 0xfe]));
    await expect(tool.execute('call', { path: 'invalid.txt' })).rejects.toThrow('UTF-8');
    await expect(tool.execute('call', { path: '../outside.txt' })).rejects.toThrow('超出工作区');
  });

  it('keeps explicit attachments complete at 128 KiB and rejects oversized attachments', async () => {
    const text = 'a'.repeat(128 * 1024);
    const { directory } = await workspaceTool(text);
    expect((await readAttachments(directory, ['text.txt']))[0].content).toBe(text);
    await writeFile(path.join(directory, 'text.txt'), text + 'b');
    await expect(readAttachments(directory, ['text.txt'])).rejects.toThrow('128 KiB');
  });

  it('documents Unicode code point offsets consistently at an exact page boundary', () => {
    expect(sliceTextPage('a😀中文', 1, 2)).toEqual({ text: '😀中', offset: 1, nextOffset: 3, totalCharacters: 4 });
    expect(sliceTextPage('a😀中文', 4)).toEqual({ text: '', offset: 4, nextOffset: null, totalCharacters: 4 });
  });
});
