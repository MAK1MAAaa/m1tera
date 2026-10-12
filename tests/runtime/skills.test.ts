import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSkillTool, SKILL_CONTENT_LIMIT, SKILL_LIBRARY_LIMIT, SkillsStore } from '../../runtime/skills.js';

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-skills-'));
  temporaryDirectories.push(directory);
  const store = new SkillsStore(directory);
  await store.initialize();
  return { store, directory };
}

const input = { name: 'my-skill', description: '测试个人技能', instructions: '仅此正文应在调用工具后出现。', triggers: ['整理'] };

describe('SkillsStore', () => {
  it('provides compact summaries and persists edits, disabled state, and deletion across restart', async () => {
    const { store, directory } = await fixture();
    expect(store.list()).toHaveLength(3);
    expect(store.list().every((skill) => !('instructions' in skill))).toBe(true);
    const created = await store.create(input);
    const updated = await store.update(created.id, { description: '新版说明', enabled: false });
    expect(updated.enabled).toBe(false);
    const restarted = new SkillsStore(directory);
    await restarted.initialize();
    expect(restarted.get(created.id)).toEqual(updated);
    const clone = restarted.get(created.id)!;
    clone.instructions = '不应修改存储';
    clone.triggers.push('错误');
    expect(restarted.get(created.id)!.instructions).toBe(input.instructions);
    expect(restarted.get(created.id)!.triggers).toEqual(['整理']);
    expect(await restarted.delete(created.id)).toBe(true);
    expect(await restarted.delete(created.id)).toBe(false);
    const afterDelete = new SkillsStore(directory);
    await afterDelete.initialize();
    expect(afterDelete.get(created.id)).toBeUndefined();
    expect((await readdir(directory)).filter((filename) => filename.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects invalid and duplicate names; builtin skills can be disabled but not deleted or overwritten', async () => {
    const { store } = await fixture();
    const [builtin] = store.list();
    await expect(store.delete(builtin.id)).rejects.toThrow('内置');
    await expect(store.update(builtin.id, { instructions: '覆盖' })).rejects.toThrow('仅支持');
    expect((await store.update(builtin.id, { enabled: false })).enabled).toBe(false);
    await store.create(input);
    await expect(store.create({ ...input, name: 'MY-SKILL' })).rejects.toThrow('已存在');
    await expect(store.create({ ...input, name: '../escape' })).rejects.toThrow('技能名');
    await expect(store.create({ ...input, name: 'bad-control', instructions: 'a\u0000b' })).rejects.toThrow('控制字符');
    await expect(store.create({ ...input, name: 'large', instructions: '中'.repeat(SKILL_CONTENT_LIMIT / 2) })).rejects.toThrow('64 KiB');
  });

  it('serializes concurrent mutations and caps the complete library at 100 entries', async () => {
    const { store, directory } = await fixture();
    const results = await Promise.allSettled(Array.from({ length: 98 }, (_, index) => store.create({ ...input, name: `test-${index}` })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(97);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(store.list()).toHaveLength(SKILL_LIBRARY_LIMIT);
    const persisted = JSON.parse(await readFile(path.join(directory, 'skills.json'), 'utf8')) as { skills: { name: string }[] };
    expect(persisted.skills).toHaveLength(SKILL_LIBRARY_LIMIT);
    expect(new Set(persisted.skills.map((skill) => skill.name)).size).toBe(SKILL_LIBRARY_LIMIT);
  });

  it('imports only explicitly selected SKILL.md text, with scalar and folded frontmatter', async () => {
    const { store, directory } = await fixture();
    const filename = path.join(directory, 'SKILL.md');
    await writeFile(filename, '---\nname: "paper-summary"\ndescription: >\n  阅读论文并提炼\n  关键证据\nlicense: MIT\n---\n\n先区分作者结果与推断。\n');
    const imported = await store.importFromFile(filename);
    expect(imported.name).toBe('paper-summary');
    expect(imported.description).toBe('阅读论文并提炼 关键证据');
    expect(imported.instructions).toBe('先区分作者结果与推断。');
    expect(imported.builtin).toBe(false);
    await expect(store.importFromFile(filename)).rejects.toThrow('已存在');
    await expect(store.importFromFile(path.join(directory, 'README.md'))).rejects.toThrow('请选择');
    await writeFile(filename, "---\nname: another\ndescription: '作者的''说明'\n---\n只保存正文，不执行脚本。\n");
    expect((await store.importFromFile(filename)).description).toBe("作者的'说明");
  });

  it('rejects oversized, malformed, binary, and invalid UTF-8 imports without changing the library', async () => {
    const { store, directory } = await fixture();
    const filename = path.join(directory, 'SKILL.md');
    for (const [contents, message] of [
      ['x'.repeat(SKILL_CONTENT_LIMIT + 1), '64 KiB'],
      ['# no metadata', 'frontmatter'],
      ['---\nname: broken\n---\n正文', '技能描述'],
      ['---\nname: broken\ndescription: one\ndescription: two\n---\n正文', '重复'],
      [Buffer.from([0, 1, 2]), '二进制'],
      [Buffer.from([0xc3, 0x28]), 'UTF-8'],
    ] as const) {
      await writeFile(filename, contents);
      await expect(store.importFromFile(filename)).rejects.toThrow(message);
      expect(store.list()).toHaveLength(3);
    }
  });

  it('keeps a corrupt library untouched instead of silently replacing user data', async () => {
    const { directory } = await fixture();
    const filename = path.join(directory, 'skills.json');
    await writeFile(filename, '{invalid');
    await expect(new SkillsStore(directory).initialize()).rejects.toThrow('JSON');
    expect(await readFile(filename, 'utf8')).toBe('{invalid');
  });
});

describe('use_skill tool', () => {
  it('does not expose instruction bodies in its schema and returns only the requested frozen skill', async () => {
    const { store } = await fixture();
    const created = await store.create(input);
    const onUse = vi.fn();
    const tool = createSkillTool(store, onUse);
    expect(tool.description).toContain('关键词：整理');
    expect(JSON.stringify({ description: tool.description, parameters: tool.parameters })).not.toContain(input.instructions);
    await store.update(created.id, { enabled: false, instructions: '下一次运行的正文' });
    await store.delete(created.id);
    const used = await tool.execute('call', { name: 'my-skill' });
    expect(used.content).toEqual([{ type: 'text', text: `技能：my-skill\n\n${input.instructions}` }]);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ id: created.id, name: created.name }));
    expect(onUse.mock.calls[0][0]).not.toHaveProperty('instructions');
    await expect(createSkillTool(store).execute('call', { name: 'my-skill' })).rejects.toThrow('未启用');
  });

  it('rejects disabled and unavailable names, and honors cancellation before and during callback', async () => {
    const { store } = await fixture();
    const created = await store.create({ ...input, enabled: false });
    const callback = vi.fn();
    const tool = createSkillTool(store, callback);
    await expect(tool.execute('call', { name: created.name })).rejects.toThrow('未启用');
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute('call', { name: 'writing' }, controller.signal)).rejects.toThrow('取消');
    expect(callback).not.toHaveBeenCalled();
    const running = new AbortController();
    const withCallback = createSkillTool(store, async () => { running.abort(); });
    await expect(withCallback.execute('call', { name: 'writing' }, running.signal)).rejects.toThrow('取消');
  });

  it('bounds automatic discovery to 20 enabled summaries and reports the truncation', async () => {
    const { store } = await fixture();
    for (let index = 0; index < 18; index++) await store.create({ ...input, name: `extra-${index}` });
    const tool = createSkillTool(store);
    expect(tool.description).toContain('前 20 项');
    expect((tool.parameters.properties as Record<string, { enum: string[] }>).name.enum).toHaveLength(20);
    await expect(tool.execute('call', { name: 'extra-17' })).rejects.toThrow('本次运行目录');
    expect(await tool.execute('call', { name: 'extra-16' })).toHaveProperty('details.name', 'extra-16');
  });
});
