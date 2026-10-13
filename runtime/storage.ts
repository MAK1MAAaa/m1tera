import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { BaselineReport, BenchmarkReport, Organization, Session, Settings } from '../shared/protocol.js';
import type { RunCheckpoint, SubmissionReceipt } from './checkpoints.js';
import { benchmarkSuite } from '../shared/benchmark-catalog.js';

export interface StoredSession extends Session {
  version: 1;
  agentMessages: AgentMessage[];
  titleSource?: 'automatic' | 'manual';
  checkpoint?: RunCheckpoint;
  submissions?: SubmissionReceipt[];
}

export class Storage {
  private pending = Promise.resolve();
  constructor(readonly directory: string) {}

  async initialize() {
    await mkdir(path.join(this.directory, 'sessions'), { recursive: true, mode: 0o700 });
    await mkdir(path.join(this.directory, 'benchmarks'), { recursive: true, mode: 0o700 });
  }

  async readSettings(): Promise<unknown> {
    try { return JSON.parse(await readFile(path.join(this.directory, 'settings.json'), 'utf8')); }
    catch (error) { if (isMissing(error)) return undefined; throw new Error('设置文件无法读取或不是有效 JSON'); }
  }

  async readOrganization(): Promise<unknown> {
    try { return JSON.parse(await readFile(path.join(this.directory, 'organization.json'), 'utf8')); }
    catch (error) { if (isMissing(error)) return undefined; throw new Error('组织设置无法读取或不是有效 JSON'); }
  }

  async readSessions(): Promise<StoredSession[]> {
    const sessions: StoredSession[] = [];
    for (const name of await readdir(path.join(this.directory, 'sessions'))) {
      if (!/^[\da-f-]{36}\.json$/.test(name)) continue;
      const text = await readFile(path.join(this.directory, 'sessions', name), 'utf8');
      let value: unknown;
      try { value = JSON.parse(text); } catch { throw new Error(`会话文件损坏：${name}`); }
      if (!value || typeof value !== 'object') throw new Error(`会话文件格式错误：${name}`);
      const session = value as StoredSession;
      if (session.version !== 1 || `${session.id}.json` !== name || !Array.isArray(session.messages) || !Array.isArray(session.agentMessages) || !Array.isArray(session.enabledTools) || typeof session.workspace !== 'string') {
        throw new Error(`不支持的会话文件格式：${name}`);
      }
      sessions.push(session);
    }
    return sessions;
  }

  saveSettings(settings: Settings) { return this.atomic('settings.json', settings); }
  saveOrganization(organization: Organization) { return this.atomic('organization.json', organization); }
  saveBaseline(report: BaselineReport) { return this.atomic('context-baseline.json', report); }
  saveBenchmark(id: string, report: BenchmarkReport) { return this.atomic(path.join('benchmarks', `${id}.json`), report); }
  async readBenchmarks(): Promise<{ id: string; report: BenchmarkReport }[]> {
    const reports: { id: string; report: BenchmarkReport }[] = [];
    for (const name of await readdir(path.join(this.directory, 'benchmarks'))) {
      if (!/^[\da-f-]{36}\.json$/.test(name)) continue;
      try {
        const report = JSON.parse(await readFile(path.join(this.directory, 'benchmarks', name), 'utf8')) as BenchmarkReport;
        if (['live', 'fixture'].includes(report.mode) && ['completed', 'cancelled'].includes(report.status) && benchmarkSuite(report.suite)
          && typeof report.measuredAt === 'string' && typeof report.name === 'string' && typeof report.model === 'string'
          && report.metrics && typeof report.metrics === 'object' && !Array.isArray(report.metrics)
          && report.settings && typeof report.settings === 'object' && !Array.isArray(report.settings)
          && (report.settings.tools === undefined || Array.isArray(report.settings.tools) && report.settings.tools.every((tool) => typeof tool === 'string'))
          && report.source && typeof report.source === 'object' && typeof report.source.upstream === 'string'
          && Array.isArray(report.cases) && report.cases.every((item) => item && typeof item.id === 'string' && ['passed', 'failed', 'unknown'].includes(item.status))) {
          reports.push({ id: name.slice(0, -5), report });
        }
      } catch { /* A damaged evaluation report must not prevent loading the user's conversations. */ }
    }
    return reports.sort((a, b) => b.report.measuredAt.localeCompare(a.report.measuredAt));
  }
  saveSession(session: StoredSession) { return this.atomic(path.join('sessions', `${session.id}.json`), session); }
  deleteSession(id: string) { return this.enqueue(async () => { await unlink(path.join(this.directory, 'sessions', `${id}.json`)).catch((error) => { if (!isMissing(error)) throw error; }); }); }

  private atomic(filename: string, data: unknown) {
    const serialized = JSON.stringify(data, null, 2);
    return this.enqueue(async () => {
      const target = path.join(this.directory, filename);
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, { encoding: 'utf8', flag: 'wx', mode: 0o600, flush: true });
        await rename(temporary, target);
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }

  private enqueue(operation: () => Promise<void>) {
    const result = this.pending.then(operation);
    this.pending = result.catch(() => {});
    return result;
  }

  async flush() { await this.pending; }
}

function isMissing(error: unknown) { return error instanceof Error && 'code' in error && error.code === 'ENOENT'; }

/** Preserve interrupted calls as failures; never rerun a write/command with an unknown outcome. */
export function repairToolChain(messages: AgentMessage[]): AgentMessage[] {
  const repaired: AgentMessage[] = [];
  let pending = new Map<string, string>();
  const settle = () => {
    for (const [id, name] of pending) repaired.push({ role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text: '上次运行中断，工具结果未知。此工具未被自动重新执行；请检查实际状态后再决定下一步。' }], isError: true, timestamp: Date.now() });
    pending = new Map();
  };
  for (const message of messages) {
    if (!message || typeof message !== 'object' || !['system', 'user', 'assistant', 'toolResult'].includes(message.role)) throw new Error('会话消息格式无效');
    if (message.role === 'assistant' && !Array.isArray(message.content)) throw new Error('会话助手消息格式无效');
    if (message.role === 'toolResult') {
      if (!pending.has(message.toolCallId)) throw new Error('会话包含孤立工具结果，无法安全恢复');
      pending.delete(message.toolCallId);
      repaired.push(message);
    } else {
      if (pending.size) settle();
      repaired.push(message);
      if (message.role === 'assistant') {
        for (const content of message.content) if (content.type === 'toolCall') {
          if (pending.has(content.id)) throw new Error('会话包含重复工具调用标识');
          pending.set(content.id, content.name);
        }
      }
    }
  }
  settle();
  return repaired;
}
