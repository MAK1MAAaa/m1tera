import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { RuntimeService } from '../../runtime/service.js';
import { Storage } from '../../runtime/storage.js';
import type { StoredSession } from '../../runtime/storage.js';
import { createCheckpoint, recordApproval, recordToolIntent } from '../../runtime/checkpoints.js';
import { DEFAULT_HARNESS_POLICY, DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { RuntimeEvent, RuntimeRequest, Session, Settings } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const task of cleanup.splice(0).reverse()) await task(); });
const usage = { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 12, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function response(model: Parameters<StreamFn>[0], content: AssistantMessage['content'] = [{ type: 'text', text: '完成' }]): AssistantMessage {
  return { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage, timestamp: Date.now(), stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop' };
}
function stream(value: AssistantMessage) {
  const output = new AssistantMessageEventStream();
  output.push({ type: 'start', partial: value });
  output.push({ type: 'done', reason: value.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: value });
  output.end(value); return output;
}
async function request(service: RuntimeService, method: RuntimeRequest['method'], params: unknown = {}, id = crypto.randomUUID()) {
  return service.handle({ id, method, params } as RuntimeRequest);
}
async function until(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('fixture event timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(respond: (model: Parameters<StreamFn>[0], context: TranscriptContext, index: number) => AssistantMessage, extra: Partial<Settings> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-durable-runtime-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace'); await mkdir(workspace);
  const dataDir = path.join(directory, 'appdata');
  const requests: TranscriptContext[] = [];
  const streamFn: StreamFn = (model, context) => { requests.push(structuredClone(context)); return stream(respond(model, context, requests.length - 1)); };
  const events: RuntimeEvent[] = [];
  const committedOutcomes: StoredSession[] = [];
  const service = new RuntimeService({ dataDir, streamFn, emit: (event) => {
    events.push(event);
    if (event.type === 'tool.finished' && !event.isError) {
      const target = path.join(dataDir, 'sessions', `${event.sessionId}.json`);
      committedOutcomes.push(JSON.parse(readFileSync(target, 'utf8')) as StoredSession);
    }
  } });
  cleanup.push(() => service.shutdown());
  expect((await request(service, 'settings.set', { settings: { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'chat-completions', baseUrl: 'https://durable-fixture.invalid/v1', model: 'fixture', workspace, ...extra }, apiKey: 'durable-memory-only-key' })).error).toBeUndefined();
  const session = (await request(service, 'sessions.create')).result as Session;
  return { directory, workspace, dataDir, requests, events, committedOutcomes, service, session, streamFn };
}
async function stored(dataDir: string, id: string): Promise<StoredSession> { return JSON.parse(await readFile(path.join(dataDir, 'sessions', `${id}.json`), 'utf8')) as StoredSession; }

describe('durable runtime admission and tool boundaries', () => {
  it('acknowledges only a persisted input and deduplicates the same request ID without another model call or user message', async () => {
    const { service, session, requests, dataDir } = await fixture((model) => response(model));
    const id = crypto.randomUUID();
    const params = { sessionId: session.id, text: '只接受一次的输入' };
    const accepted = await request(service, 'run.start', params, id);
    expect(accepted.error).toBeUndefined();
    const admitted = await stored(dataDir, session.id);
    expect(admitted.messages.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(admitted.checkpoint?.submissionId).toBe(id);
    const duplicate = await request(service, 'run.start', params, id);
    expect(duplicate.result).toEqual(accepted.result);
    await service.waitForIdle();
    expect(requests).toHaveLength(1);
    expect((await stored(dataDir, session.id)).messages.filter((message) => message.role === 'user')).toHaveLength(1);
    const conflict = await request(service, 'run.start', { ...params, text: '同 ID 的其他输入' }, id);
    expect(conflict.error?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(requests).toHaveLength(1);
  });

  it('retains submission receipts across restart without restoring any API key or automatically running the prior task', async () => {
    const { service, session, requests, dataDir, streamFn } = await fixture((model) => response(model));
    const id = crypto.randomUUID(); const params = { sessionId: session.id, text: '跨重启同一次输入' };
    const accepted = await request(service, 'run.start', params, id);
    await service.waitForIdle(); await service.shutdown();
    const restored = new RuntimeService({ dataDir, streamFn, emit: () => {} }); cleanup.push(() => restored.shutdown());
    await restored.ready;
    expect((await request(restored, 'settings.get')).result).toMatchObject({ hasApiKey: false });
    expect((await request(restored, 'run.start', params, id)).result).toEqual(accepted.result);
    expect(requests).toHaveLength(1);
    expect(await readFile(path.join(dataDir, 'sessions', `${session.id}.json`), 'utf8')).not.toContain('durable-memory-only-key');
  });

  it('rejects reusing a submission ID after the system prompt or API format changes without another input or model call', async () => {
    const { service, session, requests, dataDir } = await fixture((model) => response(model));
    const id = crypto.randomUUID(); const params = { sessionId: session.id, text: '这次提交绑定完整的运行配置' };
    expect((await request(service, 'run.start', params, id)).error).toBeUndefined();
    await service.waitForIdle();
    const current = (await request(service, 'settings.get')).result as { settings: Settings };
    const originalSettings = current.settings;
    expect((await request(service, 'settings.set', { settings: { ...originalSettings, systemPrompt: '另一个系统提示词' } })).error).toBeUndefined();
    expect((await request(service, 'run.start', params, id)).error?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect((await request(service, 'settings.set', { settings: { ...originalSettings, apiFormat: 'responses', customProviders: originalSettings.customProviders?.map((provider) => provider.id === originalSettings.providerId ? { ...provider, apiFormat: 'responses' as const } : provider) } })).error).toBeUndefined();
    expect((await request(service, 'run.start', params, id)).error?.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(requests).toHaveLength(1);
    expect((await stored(dataDir, session.id)).messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('rolls back failed input admission, emits no accepted-input event and permits a clean retry', async () => {
    const { service, session, requests, events, dataDir } = await fixture((model) => response(model));
    const original = await stored(dataDir, session.id);
    const save = Storage.prototype.saveSession;
    let rejected = false;
    vi.spyOn(Storage.prototype, 'saveSession').mockImplementation(function (this: Storage, value) {
      if (!rejected && value.checkpoint?.status === 'running') { rejected = true; return Promise.reject(new Error('simulated admission disk failure')); }
      return save.call(this, value);
    });
    const id = crypto.randomUUID(); const params = { sessionId: session.id, text: '保存失败时不能接受的输入' };
    const failed = await request(service, 'run.start', params, id);
    expect(failed.error).toBeDefined();
    expect(requests).toHaveLength(0);
    expect(events.some((event) => event.type === 'run.started' || event.type === 'message')).toBe(false);
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ messages: original.messages, title: original.title });
    expect((await stored(dataDir, session.id)).submissions).toEqual(original.submissions);
    expect((await request(service, 'run.start', params, id)).error).toBeUndefined();
    await service.waitForIdle();
    expect(requests).toHaveLength(1);
    expect((await stored(dataDir, session.id)).messages.filter((message) => message.role === 'user')).toHaveLength(1);
  });

  it('does not execute a filesystem effect when the tool intent cannot be persisted', async () => {
    const { service, session, workspace, events } = await fixture((model) => response(model, [{ type: 'toolCall', id: 'write-with-failed-intent', name: 'write_file', arguments: { path: 'must-not-exist.txt', content: 'forbidden side effect' } }]));
    expect((await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' })).error).toBeUndefined();
    const save = Storage.prototype.saveSession;
    let failed = false;
    vi.spyOn(Storage.prototype, 'saveSession').mockImplementation(function (this: Storage, value) {
      if (!failed && value.checkpoint?.toolCalls['write-with-failed-intent']?.state === 'intent') { failed = true; return Promise.reject(new Error('simulated intent disk failure')); }
      return save.call(this, value);
    });
    await request(service, 'run.start', { sessionId: session.id, text: '工具 intent 持久化失败' });
    await service.waitForIdle();
    expect(failed).toBe(true);
    expect(existsSync(path.join(workspace, 'must-not-exist.txt'))).toBe(false);
    expect(events.some((event) => event.type === 'approval.resolved' && event.approved)).toBe(false);
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'error' });
  });

  it('persists the successful outcome and transcript before exposing tool.finished to the frontend', async () => {
    const { service, session, workspace, committedOutcomes } = await fixture((model, _context, index) => index === 0
      ? response(model, [{ type: 'toolCall', id: 'committed-write', name: 'write_file', arguments: { path: 'committed.txt', content: 'saved effect' } }]) : response(model));
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' });
    await request(service, 'run.start', { sessionId: session.id, text: '执行并提交写入结果' });
    await service.waitForIdle();
    expect(await readFile(path.join(workspace, 'committed.txt'), 'utf8')).toBe('saved effect');
    expect(committedOutcomes).toHaveLength(1);
    const snapshot = committedOutcomes[0];
    expect(snapshot.checkpoint?.toolCalls['committed-write']).toMatchObject({ state: 'completed', approval: 'approved', isError: false });
    expect(snapshot.agentMessages.find((message) => message.role === 'toolResult' && message.toolCallId === 'committed-write')).toMatchObject({ isError: false, toolName: 'write_file' });
  });

  it('keeps the final outcome and transcript consistent when outcome persistence fails after the write effect', async () => {
    const { service, session, workspace, requests, dataDir } = await fixture((model) => response(model, [{ type: 'toolCall', id: 'outcome-save-failure', name: 'write_file', arguments: { path: 'effect-before-failure.txt', content: 'effect happened once' } }]));
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' });
    const save = Storage.prototype.saveSession;
    let failed = false;
    vi.spyOn(Storage.prototype, 'saveSession').mockImplementation(function (this: Storage, value) {
      if (!failed && value.checkpoint?.toolCalls['outcome-save-failure']?.state === 'completed') { failed = true; return Promise.reject(new Error('simulated outcome disk failure')); }
      return save.call(this, value);
    });
    await request(service, 'run.start', { sessionId: session.id, text: '写入成功后检查点提交失败' });
    await service.waitForIdle();
    expect(failed).toBe(true);
    expect(await readFile(path.join(workspace, 'effect-before-failure.txt'), 'utf8')).toBe('effect happened once');
    expect(requests).toHaveLength(1);
    const snapshot = await stored(dataDir, session.id);
    const outcome = snapshot.checkpoint?.toolCalls['outcome-save-failure'];
    const toolResult = snapshot.agentMessages.find((message) => message.role === 'toolResult' && message.toolCallId === 'outcome-save-failure');
    expect(toolResult?.role).toBe('toolResult');
    if (outcome?.state === 'completed') expect(toolResult).toMatchObject({ isError: false });
    else if (outcome?.state === 'failed') expect(toolResult).toMatchObject({ isError: true });
    else expect(outcome?.state).toBe('interrupted');
  });
});

describe('durable interrupted recovery and explicit continuation', () => {
  it('deduplicates the same resume RPC ID while running and after completion without a second continuation', async () => {
    const { service, session, workspace, requests, dataDir } = await fixture((model, _context, index) => index === 0
      ? response(model, [{ type: 'toolCall', id: 'resume-dedup-read', name: 'read_file', arguments: { path: 'pause.txt' } }]) : response(model),
    { harness: { ...DEFAULT_HARNESS_POLICY, maxModelTurns: 1 } });
    await writeFile(path.join(workspace, 'pause.txt'), 'persisted result');
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['read_file'], approvalMode: 'auto' });
    await request(service, 'run.start', { sessionId: session.id, text: '先暂停再重试继续 RPC' });
    await service.waitForIdle();
    expect((await stored(dataDir, session.id)).checkpoint?.status).toBe('paused');
    expect(requests).toHaveLength(1);
    const id = crypto.randomUUID(); const params = { sessionId: session.id };
    const accepted = await request(service, 'run.resume', params, id);
    expect(accepted.error).toBeUndefined();
    expect((await request(service, 'run.resume', params, id)).result).toEqual(accepted.result);
    await service.waitForIdle();
    expect((await stored(dataDir, session.id)).checkpoint?.status).toBe('completed');
    const finishedRetry = await request(service, 'run.resume', params, id);
    expect(finishedRetry.error).toBeUndefined();
    expect(finishedRetry.result).toEqual(accepted.result);
    expect(requests).toHaveLength(2);
    const snapshot = await stored(dataDir, session.id);
    expect(snapshot.messages.filter((message) => message.role === 'user' && message.text.startsWith('继续上次任务。'))).toHaveLength(1);
    expect(snapshot.approvalMode).toBe('ask');
  });

  it('expires a prior approval, repairs unknown results, and resumes with fresh approval without reopening old attachments', async () => {
    const { service, session, workspace, dataDir, requests } = await fixture((model) => response(model));
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' });
    await service.shutdown();
    const seed = await stored(dataDir, session.id);
    let checkpoint = createCheckpoint({ runId: 'interrupted-run', submissionId: 'interrupted-input', input: { text: '原任务', attachments: ['now-missing.txt'], skillIds: [] }, model: 'fixture' });
    checkpoint = recordToolIntent(checkpoint, 'unknown-write', 'write_file', { path: 'unknown-effect.txt', content: 'must not replay' }, 'never');
    checkpoint = recordApproval(checkpoint, 'unknown-write', 'approved');
    seed.checkpoint = checkpoint;
    seed.agentMessages = [{ role: 'user', content: '原任务', timestamp: Date.now() }, { role: 'assistant', api: 'openai-completions', provider: 'm1tera-openai-compatible', model: 'fixture', usage, stopReason: 'toolUse', timestamp: Date.now(), content: [{ type: 'toolCall', id: 'unknown-write', name: 'write_file', arguments: { path: 'unknown-effect.txt', content: 'must not replay' } }] }];
    await writeFile(path.join(dataDir, 'sessions', `${session.id}.json`), JSON.stringify(seed));
    const resumedRequests: TranscriptContext[] = [];
    const events: RuntimeEvent[] = [];
    const restored = new RuntimeService({ dataDir, emit: (event) => events.push(event), streamFn: (model, context) => {
      resumedRequests.push(structuredClone(context));
      return stream(resumedRequests.length === 1
        ? response(model, [{ type: 'toolCall', id: 'new-write', name: 'write_file', arguments: { path: 'fresh-approval.txt', content: 'new effect' } }]) : response(model));
    } }); cleanup.push(() => restored.shutdown());
    const recovered = (await request(restored, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(recovered.runState).toMatchObject({ status: 'interrupted', canResume: true, unknownToolCalls: 1 });
    expect((await stored(dataDir, session.id)).checkpoint?.toolCalls['unknown-write']).toMatchObject({ state: 'interrupted', approval: 'expired' });
    expect(requests).toHaveLength(0);
    expect(resumedRequests).toHaveLength(0);
    expect(existsSync(path.join(workspace, 'unknown-effect.txt'))).toBe(false);
    expect((await request(restored, 'approval.resolve', { approvalId: 'old-approval-id', approved: true })).result).toEqual({ resolved: false });
    expect((await request(restored, 'run.resume', { sessionId: session.id })).error).toBeUndefined();
    await until(() => events.some((event) => event.type === 'approval.requested'));
    expect(existsSync(path.join(workspace, 'fresh-approval.txt'))).toBe(false);
    expect(events.some((event) => event.type === 'approval.resolved' && event.automatic)).toBe(false);
    const approval = events.find((event) => event.type === 'approval.requested');
    if (approval?.type !== 'approval.requested') throw new Error('new approval missing');
    await request(restored, 'approval.resolve', { approvalId: approval.approval.id, approved: false });
    await restored.waitForIdle();
    expect(existsSync(path.join(workspace, 'fresh-approval.txt'))).toBe(false);
    const latest = await stored(dataDir, session.id);
    expect(latest.approvalMode).toBe('ask');
    expect(latest.checkpoint?.input.attachments ?? []).toEqual([]);
    expect(JSON.stringify(resumedRequests[0])).toContain('工具结果未知');
    const lastUser = resumedRequests[0].messages.findLast((message) => message.role === 'user');
    expect(JSON.stringify(lastUser)).toContain('先检查实际状态');
    expect(JSON.stringify(lastUser)).not.toContain('now-missing.txt');
  });

  it('pauses a bounded tool loop and continues from the saved result after explicit resume', async () => {
    const { service, session, workspace, requests, dataDir } = await fixture((model, _context, index) => index === 0
      ? response(model, [{ type: 'toolCall', id: 'bounded-read', name: 'read_file', arguments: { path: 'hello.txt' } }]) : response(model),
    { harness: { ...DEFAULT_HARNESS_POLICY, maxModelTurns: 1 } });
    await writeFile(path.join(workspace, 'hello.txt'), 'saved boundary data');
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['read_file'] });
    await request(service, 'run.start', { sessionId: session.id, text: '读取再继续，但先限制一轮' });
    await service.waitForIdle();
    expect(requests).toHaveLength(1);
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ runState: { status: 'paused', canResume: true, modelTurns: 1 } });
    expect((await stored(dataDir, session.id)).checkpoint?.toolCalls['bounded-read']).toMatchObject({ state: 'completed' });
    await writeFile(path.join(workspace, 'hello.txt'), 'changed after saved boundary');
    expect((await request(service, 'run.resume', { sessionId: session.id })).error).toBeUndefined();
    await service.waitForIdle();
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain('saved boundary data');
    expect(JSON.stringify(requests[1])).not.toContain('changed after saved boundary');
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ runState: { status: 'completed', canResume: false } });
  });

  it('continues a legacy session without checkpoints or receipts through the new harness', async () => {
    const { service, session, dataDir } = await fixture((model) => response(model));
    await service.shutdown();
    const legacy = await stored(dataDir, session.id);
    delete legacy.checkpoint; delete legacy.submissions;
    legacy.agentMessages = [{ role: 'user', content: 'legacy context', timestamp: Date.now() }];
    await writeFile(path.join(dataDir, 'sessions', `${session.id}.json`), JSON.stringify(legacy));
    const contexts: TranscriptContext[] = [];
    const restored = new RuntimeService({ dataDir, emit: () => {}, streamFn: (model, context) => { contexts.push(structuredClone(context)); return stream(response(model)); } }); cleanup.push(() => restored.shutdown());
    expect((await request(restored, 'run.start', { sessionId: session.id, text: 'new context' })).error).toBeUndefined();
    await restored.waitForIdle();
    expect(contexts).toHaveLength(1);
    expect(JSON.stringify(contexts[0])).toContain('legacy context');
    expect(JSON.stringify(contexts[0])).toContain('new context');
    expect((await stored(dataDir, session.id)).checkpoint?.status).toBe('completed');
  });
});
