import { describe, expect, it } from 'vitest';
import { createCorpusTools } from '../../runtime/benchmark-corpus.js';
import type { AgentTool } from '@earendil-works/pi-agent-core';

async function call(tools: AgentTool[], name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const result = await tools.find((tool) => tool.name === name)!.execute('synthetic-call', args, signal);
  const text = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('');
  return JSON.parse(text);
}

describe('read-only benchmark corpus', () => {
  it('exposes exactly the supplied corpus with three replay-safe tools and no host access', async () => {
    const input = [{ path: 'people.txt', text: '甲😀乙' }, { path: 'nested/records.md', text: 'facts' }];
    const tools = createCorpusTools(input);
    input[0].text = 'mutated outside tool';
    expect(tools.map((tool) => tool.name)).toEqual(['list_directory', 'read_file', 'search_file']);
    expect(tools.every((tool) => tool.replay === 'safe')).toBe(true);
    expect(await call(tools, 'list_directory', {})).toEqual([{ path: 'people.txt', characters: 3 }, { path: 'nested/records.md', characters: 5 }]);
    expect(await call(tools, 'read_file', { path: 'people.txt' })).toMatchObject({ text: '甲😀乙', nextOffset: null });
    for (const path of ['/etc/passwd', '../private', 'people.txt/../records.md', 'missing.txt']) {
      await expect(call(tools, 'read_file', { path })).rejects.toThrow('不属于本题');
      await expect(call(tools, 'search_file', { path, query: 'secret' })).rejects.toThrow('不属于本题');
    }
  });

  it('reads complete Unicode pages without splitting surrogate pairs or losing the tail', async () => {
    const text = '你好😀'.repeat(1500) + '尾部';
    const tools = createCorpusTools([{ path: 'corpus.txt', text }]);
    let restored = '';
    let offset = 0;
    for (;;) {
      const page = await call(tools, 'read_file', { path: 'corpus.txt', offset, limit: 31 });
      expect([...page.text].length).toBeLessThanOrEqual(31);
      expect(page.text).not.toMatch(/[\uD800-\uDBFF]$/);
      expect(page.offset).toBe(offset);
      restored += page.text;
      if (page.nextOffset === null) break;
      offset = page.nextOffset;
    }
    expect(restored).toBe(text);
    expect(await call(tools, 'read_file', { path: 'corpus.txt', offset: [...text].length })).toMatchObject({ text: '', nextOffset: null });
    await expect(call(tools, 'read_file', { path: 'corpus.txt', offset: [...text].length + 1 })).rejects.toThrow('超出');
  });

  it('searches literal text with Unicode offsets, limit and continuation rather than interpreting regex or commands', async () => {
    const tools = createCorpusTools([{ path: 'corpus.txt', text: '甲😀hit乙hit [a.*] $(echo secret) HIT' }]);
    const first = await call(tools, 'search_file', { path: 'corpus.txt', query: 'hit', limit: 1 });
    expect(first.matches.map((match: { offset: number }) => match.offset)).toEqual([2]);
    expect(first.nextOffset).toBe(5);
    const second = await call(tools, 'search_file', { path: 'corpus.txt', query: 'hit', offset: first.nextOffset, limit: 1 });
    expect(second.matches.map((match: { offset: number }) => match.offset)).toEqual([6]);
    expect(second.nextOffset).toBeNull();
    expect((await call(tools, 'search_file', { path: 'corpus.txt', query: 'a.*' })).matches).toHaveLength(1);
    expect((await call(tools, 'search_file', { path: 'corpus.txt', query: '.*' })).matches).toHaveLength(1);
    expect((await call(tools, 'search_file', { path: 'corpus.txt', query: '$(echo secret)' })).matches).toHaveLength(1);
    expect((await call(tools, 'search_file', { path: 'corpus.txt', query: 'Hit' })).matches).toEqual([]);
    expect((await call(tools, 'search_file', { path: 'corpus.txt', query: 'hit', offset: 500 })).matches).toEqual([]);
  });

  it.each(['', '../private', '/absolute', 'nested/../private', 'windows\\private', 'bad\0path'])('rejects invalid registered path %s', (path) => {
    expect(() => createCorpusTools([{ path, text: 'private' }])).toThrow('路径');
  });

  it('rejects duplicate corpus paths and validates read/search pagination even without an outer schema validator', async () => {
    expect(() => createCorpusTools([{ path: 'file', text: 'a' }, { path: 'file', text: 'b' }])).toThrow('路径');
    const tools = createCorpusTools([{ path: 'file', text: 'data' }]);
    for (const args of [{ offset: -1 }, { offset: 0.5 }, { limit: 0 }, { limit: 16385 }]) {
      await expect(call(tools, 'read_file', { path: 'file', ...args })).rejects.toThrow();
    }
    for (const args of [{ query: '' }, { query: 'x'.repeat(513) }, { query: 'a', offset: -1 },
      { query: 'a', offset: 0.5 }, { query: 'a', limit: 0 }, { query: 'a', limit: 21 }]) {
      await expect(call(tools, 'search_file', { path: 'file', ...args })).rejects.toThrow('参数');
    }
  });

  it.each(['list_directory', 'read_file', 'search_file'])('honors cancellation before %s accesses corpus', async (name) => {
    const tools = createCorpusTools([{ path: 'file', text: 'private' }]);
    const controller = new AbortController(); controller.abort();
    await expect(call(tools, name, { path: 'file', query: 'private' }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
