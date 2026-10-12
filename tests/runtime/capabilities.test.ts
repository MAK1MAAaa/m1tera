import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listWorkspaceFiles, readAttachments } from '../../runtime/attachments.js';
import { createWebSearchTool, parseSearchResults, searchWeb } from '../../runtime/web-search.js';

const directories: string[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function workspace() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-capabilities-'));
  directories.push(directory);
  const root = path.join(directory, 'workspace');
  await mkdir(root);
  return { directory, root };
}

function result(title: string, url: string, snippet = 'Official &amp; useful documentation') {
  return `<div class="result"><h2><a rel="nofollow" class="result__a" href="${url}">${title}</a></h2><a class="result__snippet">${snippet}</a></div>`;
}
const html = result('<b>Tauri</b> &amp; Rust', '//duckduckgo.com/l/?uddg=https%3A%2F%2Fv2.tauri.app%2Fdevelop%2F%23start&amp;rut=unused');
function fakeFetch(body: string, init?: ResponseInit): typeof fetch {
  return vi.fn(async () => new Response(body, { headers: { 'content-type': 'text/html' }, ...init })) as unknown as typeof fetch;
}

describe('workspace file mentions', () => {
  it('lists bounded relative file metadata, filters by relative path, and skips build trees and links', async () => {
    const { directory, root } = await workspace();
    await mkdir(path.join(root, 'src'));
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, 'src', 'app.ts'), 'export const value = 1;');
    await writeFile(path.join(root, 'readme.md'), 'hello');
    await writeFile(path.join(root, 'node_modules', 'hidden.ts'), 'ignored');
    await writeFile(path.join(directory, 'outside.md'), 'outside');
    await symlink(path.join(directory, 'outside.md'), path.join(root, 'escape.md'));
    await symlink(path.join(root, 'src'), path.join(root, 'loop'));
    expect(await listWorkspaceFiles(root)).toEqual([{ path: 'readme.md', size: 5 }, { path: 'src/app.ts', size: 23 }]);
    expect(await listWorkspaceFiles(root, 'SRC/APP')).toEqual([{ path: 'src/app.ts', size: 23 }]);
  });

  it('limits the picker to 100 choices and omits oversized files', async () => {
    const { root } = await workspace();
    await Promise.all(Array.from({ length: 105 }, (_, index) => writeFile(path.join(root, `${index}.txt`), 'file')));
    await writeFile(path.join(root, 'oversized.bin'), Buffer.alloc(128 * 1024 + 1));
    expect(await listWorkspaceFiles(root)).toHaveLength(100);
    expect(await listWorkspaceFiles(root, 'oversized')).toEqual([]);
  });

  it('reads explicitly chosen UTF-8 contents once and rejects traversal, external links, directories and absolute paths', async () => {
    const { directory, root } = await workspace();
    await writeFile(path.join(root, '你好.md'), '你好，世界');
    await writeFile(path.join(directory, 'private.md'), 'private');
    await symlink(path.join(directory, 'private.md'), path.join(root, 'escape.md'));
    await symlink(path.join(root, '你好.md'), path.join(root, 'alias.md'));
    expect(await readAttachments(root, ['你好.md', 'alias.md'])).toEqual([{ path: '你好.md', content: '你好，世界', size: 15 }]);
    await expect(readAttachments(root, ['../private.md'])).rejects.toThrow('超出工作区');
    await expect(readAttachments(root, ['escape.md'])).rejects.toThrow('工作区外');
    await expect(readAttachments(root, [path.join(root, '你好.md')])).rejects.toThrow('相对路径');
    await expect(readAttachments(root, ['.'])).rejects.toThrow('普通文件');
  });

  it('rejects binary/invalid UTF-8 and enforces file, total and count budgets', async () => {
    const { root } = await workspace();
    await writeFile(path.join(root, 'binary'), Buffer.from([65, 0, 66]));
    await writeFile(path.join(root, 'invalid'), Buffer.from([0xc3, 0x28]));
    await writeFile(path.join(root, 'large'), 'x'.repeat(128 * 1024 + 1));
    await expect(readAttachments(root, ['binary'])).rejects.toThrow('二进制');
    await expect(readAttachments(root, ['invalid'])).rejects.toThrow('UTF-8');
    await expect(readAttachments(root, ['large'])).rejects.toThrow('128 KiB');
    await expect(readAttachments(root, Array.from({ length: 9 }, () => 'invalid'))).rejects.toThrow('8 个文件');
    const files = Array.from({ length: 5 }, (_, index) => `file-${index}`);
    await Promise.all(files.map((file) => writeFile(path.join(root, file), 'x'.repeat(128 * 1024))));
    expect(await readAttachments(root, files.slice(0, 4))).toHaveLength(4);
    await expect(readAttachments(root, files)).rejects.toThrow('512 KiB');
  });

  it('cancels picker and attachment reads before filesystem work', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(listWorkspaceFiles('/missing', '', controller.signal)).rejects.toThrow('已取消');
    await expect(readAttachments('/missing', ['file'], controller.signal)).rejects.toThrow('已取消');
  });
});

describe('public web search capability', () => {
  it('requests the fixed public provider, decodes redirect links, strips markup, and returns real source URLs', async () => {
    const provider = fakeFetch(html);
    const response = await searchWeb('Tauri docs', { fetch: provider });
    expect(response).toEqual({ provider: 'DuckDuckGo HTML', results: [{ title: 'Tauri & Rust', url: 'https://v2.tauri.app/develop/', snippet: 'Official & useful documentation' }] });
    const [url, options] = vi.mocked(provider).mock.calls[0];
    expect(String(url)).toBe('https://html.duckduckgo.com/html/?q=Tauri+docs');
    expect(options).toMatchObject({ method: 'GET', redirect: 'error' });
    expect(options?.headers).not.toHaveProperty('authorization');
    expect(options?.headers).not.toHaveProperty('cookie');
  });

  it('bounds/deduplicates results and excludes script, credential, private-address and provider links', () => {
    const sources = Array.from({ length: 9 }, (_, index) => result(`Title ${index}`, `https://example.com/${index}`, 'a'.repeat(1000))).join('');
    const rejected = [result('Script', 'javascript:alert(1)'), result('Private', 'http://127.0.0.1/private'), result('Private v6', 'http://[::1]/private'), result('Credentials', 'https://user:secret@example.com/private'), result('Provider ad', 'https://duckduckgo.com/y.js?ad=one')].join('');
    const response = parseSearchResults(rejected + sources + sources);
    expect(response).toHaveLength(6);
    expect(response.every((entry) => entry.url.startsWith('https://example.com/'))).toBe(true);
    expect(response[0].snippet).toHaveLength(800);
    expect(parseSearchResults(result('One', 'https://example.com/#one') + result('Two', 'https://example.com/#two'))).toHaveLength(1);
  });

  it('supports public lite result markup and numeric entities', () => {
    expect(parseSearchResults('<a class="result-link" href="https://example.com/">A&#x26;B</a><td class="result-snippet">&#20013;文</td>')).toEqual([{ title: 'A&B', url: 'https://example.com/', snippet: '中文' }]);
  });

  it('fails clearly on captcha, no credible results, provider errors, unexpected types and oversize bodies', async () => {
    await expect(searchWeb('docs', { fetch: fakeFetch('<form id="challenge-form" action="/anomaly.js">challenge</form>') })).rejects.toMatchObject({ code: 'SEARCH_CHALLENGE' });
    await expect(searchWeb('docs', { fetch: fakeFetch('<div>No results</div>') })).rejects.toMatchObject({ code: 'SEARCH_NO_RESULTS' });
    await expect(searchWeb('docs', { fetch: fakeFetch('private provider response', { status: 403 }) })).rejects.toThrow('HTTP 403');
    await expect(searchWeb('docs', { fetch: fakeFetch(html, { headers: { 'content-type': 'application/json' } }) })).rejects.toMatchObject({ code: 'SEARCH_UNTRUSTED_RESPONSE' });
    await expect(searchWeb('docs', { fetch: fakeFetch('x'.repeat(1024 * 1024 + 1)) })).rejects.toMatchObject({ code: 'SEARCH_TOO_LARGE' });
  });

  it('honors cancellation even if an injected provider ignores the signal, and aborts a hanging body', async () => {
    const before = new AbortController();
    before.abort();
    const unused = fakeFetch(html);
    await expect(searchWeb('docs', { fetch: unused, signal: before.signal })).rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });
    expect(unused).not.toHaveBeenCalled();
    const controller = new AbortController();
    const operation = searchWeb('docs', { fetch: vi.fn(() => new Promise<Response>(() => {})), signal: controller.signal });
    controller.abort();
    await expect(operation).rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });
    const bodyController = new AbortController();
    const body = new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode('<html>')); } });
    const hanging = searchWeb('docs', { fetch: vi.fn(async () => new Response(body)), signal: bodyController.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    bodyController.abort();
    await expect(hanging).rejects.toMatchObject({ code: 'SEARCH_CANCELLED' });
  });

  it('times out within 12 seconds and validates queries without making an HTTP request', async () => {
    const provider = vi.fn(() => new Promise<Response>(() => {}));
    await expect(searchWeb('', { fetch: provider })).rejects.toMatchObject({ code: 'SEARCH_INVALID_QUERY' });
    await expect(searchWeb('x'.repeat(501), { fetch: provider })).rejects.toMatchObject({ code: 'SEARCH_INVALID_QUERY' });
    expect(provider).not.toHaveBeenCalled();
    vi.useFakeTimers();
    const timed = searchWeb('docs', { fetch: provider });
    const rejected = expect(timed).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(12000);
    await rejected;
  });

  it('provides an opt-in executable AgentTool with bounded, sourced results', async () => {
    const tool = createWebSearchTool({ fetch: fakeFetch(html) });
    expect(tool.name).toBe('web_search');
    const response = await tool.execute('search-call', { query: 'Tauri docs' });
    expect(response.details).toMatchObject({ provider: 'DuckDuckGo HTML', results: [{ url: 'https://v2.tauri.app/develop/' }] });
    expect(response.content[0]).toMatchObject({ type: 'text' });
  });
});
