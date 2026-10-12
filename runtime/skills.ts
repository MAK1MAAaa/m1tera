import { constants } from 'node:fs';
import { mkdir, open, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import type { Skill, SkillSummary } from '../shared/protocol.js';

export const SKILL_CONTENT_LIMIT = 64 * 1024;
export const SKILL_LIBRARY_LIMIT = 100;
export const SKILL_DIRECTORY_LIMIT = 20;
const LIBRARY_FILE_LIMIT = 8 * 1024 * 1024;

export interface SkillInput {
  name: string;
  description: string;
  instructions: string;
  triggers?: string[];
  enabled?: boolean;
}

const BUILTINS: Omit<Skill, 'updatedAt'>[] = [
  {
    id: 'builtin-writing', name: 'writing', description: '起草和修改文章、邮件、说明文；优先保持作者意图与自然表达。',
    instructions: '先识别读者、目的、篇幅和语气；信息不足且影响结果时提出一个关键问题。修改时保留原意与事实，删去重复和空泛表达。默认直接给出可用成稿；必要时简述关键修改，不虚构引文和经历。',
    triggers: ['写作', '改写', '润色'], enabled: true, builtin: true,
  },
  {
    id: 'builtin-research', name: 'research', description: '为资料调研组织问题、证据与来源；适合需要核验当前信息的任务。',
    instructions: '将问题拆成可核验的子问题，优先使用官方文档、原始论文与一手资料。对会变化的信息核验日期；区分来源事实、推断和未知。引用应直接支持对应结论，说明关键分歧。只有当前可用工具支持网络检索时才执行检索，否则明确资料范围，不捏造搜索结果或链接。',
    triggers: ['调研', '资料', '研究'], enabled: true, builtin: true,
  },
  {
    id: 'builtin-code-review', name: 'code-review', description: '审查代码的正确性、安全性和兼容性，优先报告有证据的缺陷。',
    instructions: '先理解改动意图与调用路径，再检查边界条件、错误处理、资源生命周期、权限和兼容性。优先报告可复现且会影响行为的问题，给出位置、触发条件与实际后果。将未验证的判断标记为假设。避免把个人风格偏好当作缺陷；未经任务授权不要修改文件或执行命令。',
    triggers: ['代码审查', 'review', '检查代码'], enabled: true, builtin: true,
  },
];

function summary(skill: Skill): SkillSummary {
  return { id: skill.id, name: skill.name, description: skill.description, triggers: [...skill.triggers], enabled: skill.enabled, builtin: skill.builtin, updatedAt: skill.updatedAt };
}

function hasInvalidControl(text: string) {
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) return true;
  }
  return false;
}

function validateText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}不能为空`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${field}最多 ${max} 个字符`);
  if (hasInvalidControl(result)) throw new Error(`${field}包含无效控制字符`);
  return result;
}

function validateInput(input: SkillInput): Required<SkillInput> {
  const name = validateText(input.name, '技能名', 64).toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error('技能名须为小写字母、数字和连接词间的短横线');
  const description = validateText(input.description, '技能描述', 300);
  const instructions = validateText(input.instructions, '技能内容', SKILL_CONTENT_LIMIT);
  if (Buffer.byteLength(instructions, 'utf8') > SKILL_CONTENT_LIMIT) throw new Error('技能内容最多 64 KiB');
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('技能开关必须是布尔值');
  const rawTriggers = input.triggers ?? [];
  if (!Array.isArray(rawTriggers) || rawTriggers.length > 20) throw new Error('技能触发提示最多 20 项');
  const triggers = [...new Set(rawTriggers.map((trigger) => validateText(trigger, '触发提示', 64)))];
  return { name, description, instructions, triggers, enabled: input.enabled ?? true };
}

function isMissing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }
function throwIfAborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error('操作已取消'); }

/** Read a regular UTF-8 file with a hard byte bound, including when it grows while being read. */
async function readBoundedText(filename: string, limit: number) {
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error('只能读取普通文件');
    if (info.size > limit) throw new Error(`文件最多 ${limit === SKILL_CONTENT_LIMIT ? '64 KiB' : '8 MiB'}`);
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > limit) throw new Error(`文件最多 ${limit === SKILL_CONTENT_LIMIT ? '64 KiB' : '8 MiB'}`);
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, offset)); }
    catch { throw new Error('文件必须是有效 UTF-8 文本'); }
    if (hasInvalidControl(text)) throw new Error('文件包含二进制内容或无效控制字符');
    return text;
  } finally { await file.close(); }
}

/** Deliberately supports just the scalar metadata used by SKILL.md; no YAML object execution. */
function parseSkillFile(text: string): SkillInput {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[0] !== '---') throw new Error('SKILL.md 须以 YAML frontmatter 开始');
  const end = lines.findIndex((line, index) => index > 0 && line === '---');
  if (end < 0 || end > 200) throw new Error('SKILL.md 的 frontmatter 格式无效');
  const fields: Record<string, string> = {};
  for (let index = 1; index < end; index++) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (fields[key] !== undefined) throw new Error(`frontmatter 重复字段：${key}`);
    let value = raw.trim();
    if (value === '|' || value === '>') {
      const block: string[] = [];
      while (index + 1 < end && (/^\s/.test(lines[index + 1]) || !lines[index + 1].trim())) block.push(lines[++index].trim());
      value = block.join(value === '>' ? ' ' : '\n').trim();
    } else if (value.startsWith('"')) {
      try { const decoded: unknown = JSON.parse(value); if (typeof decoded !== 'string') throw new Error(); value = decoded; }
      catch { throw new Error(`frontmatter ${key} 引号格式无效`); }
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) throw new Error(`frontmatter ${key} 引号格式无效`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else {
      if (value && '[]{},&*!'.includes(value[0])) throw new Error(`frontmatter ${key} 必须是文本`);
      value = value.replace(/\s+#.*$/, '').trim();
    }
    fields[key] = value;
  }
  return { name: fields.name ?? '', description: fields.description ?? '', instructions: lines.slice(end + 1).join('\n').trim() };
}

export class SkillsStore {
  private skills: Skill[] = [];
  private pending = Promise.resolve();
  private initialization?: Promise<void>;
  private initialized = false;
  constructor(readonly directory: string) {}

  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  private async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    let text: string | undefined;
    try { text = await readBoundedText(path.join(this.directory, 'skills.json'), LIBRARY_FILE_LIMIT); }
    catch (error) { if (!isMissing(error)) throw error; }
    if (text === undefined) {
      const updatedAt = new Date().toISOString();
      this.skills = BUILTINS.map((skill) => ({ ...structuredClone(skill), updatedAt }));
      await this.persist(this.skills);
    } else {
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { throw new Error('技能库不是有效 JSON'); }
      if (!parsed || typeof parsed !== 'object' || !('version' in parsed) || parsed.version !== 1 || !('skills' in parsed) || !Array.isArray(parsed.skills) || parsed.skills.length > SKILL_LIBRARY_LIMIT) throw new Error('技能库格式无效');
      const ids = new Set<string>();
      const names = new Set<string>();
      this.skills = parsed.skills.map((item: unknown) => {
        if (!item || typeof item !== 'object') throw new Error('技能库条目无效');
        const skill = item as Skill;
        if (typeof skill.id !== 'string' || skill.id.length > 80 || !skill.id || typeof skill.builtin !== 'boolean' || typeof skill.updatedAt !== 'string' || Number.isNaN(Date.parse(skill.updatedAt))) throw new Error('技能库条目无效');
        if (skill.builtin !== BUILTINS.some((builtin) => builtin.id === skill.id)) throw new Error('技能库的内置标记无效');
        const input = validateInput(skill);
        if (ids.has(skill.id) || names.has(input.name)) throw new Error('技能库包含重复条目');
        ids.add(skill.id); names.add(input.name);
        return { ...input, id: skill.id, builtin: skill.builtin, updatedAt: skill.updatedAt };
      });
      if (BUILTINS.some((builtin) => !ids.has(builtin.id))) throw new Error('技能库缺少内置条目');
    }
    this.initialized = true;
  }

  list(): SkillSummary[] { this.assertInitialized(); return this.skills.map(summary); }
  get(id: string): Skill | undefined { this.assertInitialized(); const skill = this.skills.find((entry) => entry.id === id); return skill ? structuredClone(skill) : undefined; }

  create(input: SkillInput): Promise<Skill> {
    return this.enqueue(async () => {
      if (this.skills.length >= SKILL_LIBRARY_LIMIT) throw new Error('技能库最多 100 项');
      const validated = validateInput(input);
      if (this.skills.some((skill) => skill.name === validated.name)) throw new Error('技能名已存在');
      const skill: Skill = { ...validated, id: randomUUID(), builtin: false, updatedAt: new Date().toISOString() };
      const next = [...this.skills, skill];
      await this.persist(next); this.skills = next;
      return structuredClone(skill);
    });
  }

  update(id: string, patch: Partial<SkillInput>): Promise<Skill> {
    return this.enqueue(async () => {
      const current = this.skills.find((skill) => skill.id === id);
      if (!current) throw new Error('技能不存在');
      if (current.builtin && Object.keys(patch).some((key) => key !== 'enabled')) throw new Error('内置技能仅支持启用或停用');
      const validated = validateInput({ ...current, ...patch });
      if (this.skills.some((skill) => skill.id !== id && skill.name === validated.name)) throw new Error('技能名已存在');
      const skill: Skill = { ...current, ...validated, updatedAt: new Date().toISOString() };
      const next = this.skills.map((entry) => entry.id === id ? skill : entry);
      await this.persist(next); this.skills = next;
      return structuredClone(skill);
    });
  }

  delete(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      const current = this.skills.find((skill) => skill.id === id);
      if (!current) return false;
      if (current.builtin) throw new Error('不能删除内置技能；可以停用');
      const next = this.skills.filter((skill) => skill.id !== id);
      await this.persist(next); this.skills = next;
      return true;
    });
  }

  async importFromFile(filename: string): Promise<Skill> {
    this.assertInitialized();
    if (typeof filename !== 'string' || path.basename(filename).toUpperCase() !== 'SKILL.MD') throw new Error('请选择 SKILL.md 文件');
    const text = await readBoundedText(filename, SKILL_CONTENT_LIMIT);
    return this.create(parseSkillFile(text));
  }

  private assertInitialized() { if (!this.initialized) throw new Error('技能库尚未初始化'); }
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    this.assertInitialized();
    const result = this.pending.then(operation);
    this.pending = result.then(() => {}, () => {});
    return result;
  }

  private async persist(skills: Skill[]) {
    const serialized = JSON.stringify({ version: 1, skills }, null, 2);
    if (Buffer.byteLength(serialized, 'utf8') > LIBRARY_FILE_LIMIT) throw new Error('技能库文件最多 8 MiB');
    const target = path.join(this.directory, 'skills.json');
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } finally { await unlink(temporary).catch(() => {}); }
  }
}

/** Freeze the enabled directory and its content per run; later edits apply to future runs only. */
export function createSkillTool(store: SkillsStore, onUse?: (skill: SkillSummary) => void | Promise<void>): AgentTool {
  const enabled = store.list().filter((skill) => skill.enabled);
  const snapshot = enabled.slice(0, SKILL_DIRECTORY_LIMIT).map((skill) => store.get(skill.id)!);
  const names = snapshot.map((skill) => skill.name);
  const directory = snapshot.map((skill) => `${skill.name}: ${skill.description.replace(/\s+/g, ' ').slice(0, 160)}${skill.triggers.length ? `（关键词：${skill.triggers.join('、').slice(0, 100)}）` : ''}`).join('\n');
  return {
    name: 'use_skill', label: '使用技能',
    description: `当任务适合下列技能时，按名称加载其指令。只加载所需技能；技能不授予文件、命令或网络权限。\n${directory || '当前没有可用技能。'}${enabled.length > SKILL_DIRECTORY_LIMIT ? '\n[目录仅列前 20 项；其他技能需由用户显式选择。]' : ''}`,
    parameters: Type.Object({ name: Type.String({ enum: names, description: '本次运行可用的技能名称' }) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (_id, raw, signal) => {
      throwIfAborted(signal);
      const name = (raw as { name?: unknown } | null)?.name;
      const skill = snapshot.find((entry) => entry.name === name);
      if (!skill) throw new Error('技能未启用或不在本次运行目录中');
      await onUse?.(summary(skill));
      throwIfAborted(signal);
      return { content: [{ type: 'text', text: `技能：${skill.name}\n\n${skill.instructions}` }], details: { skillId: skill.id, name: skill.name } };
    },
  };
}
