import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Type } from 'typebox';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import type { AgentMessage, AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { ArtifactStore } from '../../runtime/artifacts.js';
import { buildContext, buildModel, countEstimatedTokens } from '../../runtime/context.js';
import { createHarnessAgent, projectHistory, validateHarnessPolicy } from '../../runtime/harness.js';
import { DEFAULT_HARNESS_POLICY } from '../../shared/protocol.js';
import type { HarnessPolicy } from '../../shared/protocol.js';

const directories: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });
const model = buildModel({ baseUrl: 'http://localhost:1/v1', model: 'fixture', apiFormat: 'chat-completions' });
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const policy: HarnessPolicy = { ...DEFAULT_HARNESS_POLICY, toolResultTokenLimit: 512 };

function assistant(content: AssistantMessage['content'] = [{ type: 'text', text: '已完成' }]): AssistantMessage {
  return { role: 'assistant', content, api: model.api, provider: model.provider, model: model.id, usage, timestamp: Date.now(), stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop' };
}
function call(name: string, args: Record<string, string | number> = {}, id = 'call-1') {
  return assistant([{ type: 'toolCall', id, name, arguments: args }]);
}
function output(name: string, text: string, id = 'call-1', isError = false): AgentMessage {
  return { role: 'toolResult', toolCallId: id, toolName: name, content: [{ type: 'text', text }], details: {}, timestamp: Date.now(), isError };
}
function user(text: string): AgentMessage { return { role: 'user', content: text, timestamp: Date.now() }; }
function text(message: AgentMessage) {
  return typeof message.content === 'string' ? message.content : message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
}
function toolNames(context: TranscriptContext) {
  return context.messages.flatMap((message) => message.role === 'system' ? (message.toolsAdded ?? []).map((tool) => tool.name) : []);
}
function scriptedStream(respond: (context: TranscriptContext, index: number) => AssistantMessage) {
  const requests: TranscriptContext[] = [];
  const streamFn: StreamFn = (_model, context) => {
    requests.push(structuredClone(context));
    const message = respond(context, requests.length - 1);
    const stream = new AssistantMessageEventStream();
    stream.push({ type: 'start', partial: message });
    stream.push({ type: 'done', reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop', message });
    stream.end(message);
    return stream;
  };
  return { streamFn, requests };
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-harness-'));
  directories.push(directory);
  const artifacts = new ArtifactStore(directory);
  await artifacts.initialize();
  return { directory, artifacts, sessionId: randomUUID() };
}
function tool(name: string, value = '工具成功'): AgentTool {
  return { name, label: name, description: '测试工具', parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe', execute: vi.fn(async () => ({ content: [{ type: 'text' as const, text: value }], details: {} })) };
}

describe('history projection', () => {
  it('archives old completed write arguments while preserving scalar arguments, call pairs and source history', async () => {
    const { directory, artifacts, sessionId } = await fixture();
    const content = `开头${'中文😀'.repeat(15000)}结尾`;
    const messages = [user('创建文件'), call('write_file', { path: 'notes.txt', content }), output('write_file', '已写入 notes.txt'), assistant(), user('继续检查')];
    const before = structuredClone(messages);
    const projected = await projectHistory(messages, artifacts, sessionId, policy);
    expect(messages).toEqual(before);
    const oldCall = projected.messages[1];
    if (oldCall.role !== 'assistant' || oldCall.content[0].type !== 'toolCall') throw new Error('missing projected call');
    expect(oldCall.content[0]).toMatchObject({ id: 'call-1', name: 'write_file', arguments: { path: 'notes.txt', content: expect.stringContaining('已归档') } });
    expect(projected.messages[2]).toMatchObject({ role: 'toolResult', toolCallId: 'call-1', toolName: 'write_file' });
    expect(projected.offloadedResults).toBe(1);
    expect(projected.savedHistoryTokens).toBeGreaterThan(countEstimatedTokens(messages) * 0.9);
    const [id] = projected.artifactIds;
    expect(JSON.parse(await readFile(path.join(directory, 'artifacts', sessionId, `${id}.txt`), 'utf8'))).toEqual({ path: 'notes.txt', content });
    expect((await projectHistory(messages, artifacts, sessionId, policy)).artifactIds).toEqual(projected.artifactIds);
  });

  it('does not project unfinished calls, the current turn or short values', async () => {
    const { artifacts, sessionId } = await fixture();
    const content = 'long-content\n'.repeat(5000);
    const messages = [user('旧任务'), call('write_file', { path: 'unknown.txt', content }, 'unfinished'), user('本轮任务'), call('write_file', { path: 'current.txt', content }, 'current'), output('write_file', 'ok', 'current')];
    const projected = await projectHistory(messages, artifacts, sessionId, policy);
    expect(projected.messages).toEqual(messages);
    expect(projected.artifactIds.size).toBe(0);
    expect(projected.offloadedResults).toBe(0);
    const short = [user('之前'), call('read_file', { path: 'small.txt' }), output('read_file', 'small'), user('现在')];
    expect((await projectHistory(short, artifacts, sessionId, policy)).messages).toEqual(short);
  });

  it('retains errors and mixed image results and respects disabled offloading', async () => {
    const { artifacts, sessionId } = await fixture();
    const long = 'tool result\n'.repeat(6000);
    const failed = output('run_command', long, 'failed', true);
    const mixed: AgentMessage = { role: 'toolResult', toolCallId: 'image', toolName: 'web_search', timestamp: Date.now(), isError: false, details: {}, content: [{ type: 'text', text: long }, { type: 'image', data: 'fixture', mimeType: 'image/png' }] };
    const messages = [user('过去'), call('run_command', {}, 'failed'), failed, call('web_search', {}, 'image'), mixed, user('现在')];
    const projected = await projectHistory(messages, artifacts, sessionId, policy);
    expect(projected.messages).toEqual(messages);
    expect(projected.artifactIds.size).toBe(0);
    const textMessages = [user('过去'), call('run_command'), output('run_command', long), user('现在')];
    expect((await projectHistory(textMessages, artifacts, sessionId, { ...policy, offloadToolResults: false })).messages).toEqual(textMessages);
  });

  it('preserves original arguments and results if the artifact write fails', async () => {
    const { artifacts, sessionId } = await fixture();
    vi.spyOn(artifacts, 'put').mockRejectedValue(new Error('disk unavailable'));
    const messages = [user('过去'), call('write_file', { path: 'large.txt', content: 'large contents\n'.repeat(5000) }), output('write_file', 'written'), user('现在')];
    const projected = await projectHistory(messages, artifacts, sessionId, policy);
    expect(projected.messages).toEqual(messages);
    expect(projected.artifactIds.size).toBe(0);
  });
});

describe('shared harness factory', () => {
  it('keeps pure chat free of tool schemas and hidden system instructions', async () => {
    const setup = await fixture();
    const scripted = scriptedStream(() => assistant());
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools: [], messages: [] }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools: [], policy });
    await agent.prompt('你好');
    expect(scripted.requests).toHaveLength(1);
    expect(toolNames(scripted.requests[0])).toEqual([]);
    expect(scripted.requests[0].messages.filter((message) => message.role === 'system')).toEqual([]);
    expect(metrics.offloadedResults).toBe(0);
    expect(metrics.modelTurns).toBe(1);
  });

  it('does not disclose artifact reading for small tool outputs', async () => {
    const setup = await fixture();
    const tools = [tool('list_directory', 'file\tnotes.txt')];
    const scripted = scriptedStream((_context, index) => index === 0 ? call('list_directory') : assistant());
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools, policy });
    await agent.prompt('列目录');
    expect(scripted.requests).toHaveLength(2);
    expect(scripted.requests.map(toolNames)).toEqual([['list_directory'], ['list_directory']]);
    expect(text(scripted.requests[1].messages.find((message) => message.role === 'toolResult')!)).toBe('file\tnotes.txt');
    expect(metrics.offloadedResults).toBe(0);
  });

  it('progressively discloses retrieval after offloading and does not offload a retrieved page again', async () => {
    const setup = await fixture();
    const stdout = `头部\n${'内容😀\n'.repeat(8000)}\n尾部`;
    const tools = [tool('run_command', stdout)];
    let artifactId = '';
    const scripted = scriptedStream((context, index) => {
      if (index === 0) return call('run_command');
      if (index === 1) {
        const result = context.messages.findLast((message) => message.role === 'toolResult');
        if (!result || result.role !== 'toolResult') throw new Error('missing result');
        artifactId = (result.details as { artifact: { id: string } }).artifact.id;
        return call('read_artifact', { id: artifactId, offset: 4096, limit: 16384 }, 'read-page');
      }
      return assistant();
    });
    const onResult = vi.fn(async () => {});
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn, toolExecution: 'sequential' }, { ...setup, systemPrompt: '', tools, policy, onResult });
    await agent.prompt('检查大输出的中部');
    expect(scripted.requests).toHaveLength(3);
    expect(scripted.requests.map(toolNames)).toEqual([['run_command'], ['run_command', 'read_artifact'], ['run_command', 'read_artifact']]);
    expect(JSON.stringify(scripted.requests[1])).not.toContain(stdout);
    expect(text(scripted.requests[1].messages.find((message) => message.role === 'toolResult')!)).toContain(artifactId);
    const retrieved = scripted.requests[2].messages.find((message) => message.role === 'toolResult' && message.toolCallId === 'read-page');
    expect(retrieved).toBeDefined();
    expect(text(retrieved!)).toContain([...stdout].slice(4096, 4096 + 16384).join(''));
    expect(retrieved).toMatchObject({ details: { id: artifactId, nextOffset: 20480 } });
    expect(retrieved!.role === 'toolResult' && retrieved!.details).not.toHaveProperty('artifact');
    expect(metrics.offloadedResults).toBe(1);
    expect(onResult).toHaveBeenCalledTimes(2);
  });

  it('uses the projected history in the next request while the source archive retains full arguments', async () => {
    const setup = await fixture();
    const original = [user('创建文件'), call('write_file', { path: 'old.txt', content: 'source contents\n'.repeat(6000) }), output('write_file', 'written'), assistant()];
    const snapshot = structuredClone(original);
    const tools = [tool('write_file')];
    const scripted = scriptedStream(() => assistant());
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools, messages: buildContext('', original, tools).messages }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools, policy });
    await agent.prompt('检查已有文件');
    expect(original).toEqual(snapshot);
    expect(toolNames(scripted.requests[0])).toEqual(['write_file', 'read_artifact']);
    expect(JSON.stringify(scripted.requests[0])).toContain('已归档');
    expect(JSON.stringify(scripted.requests[0])).not.toContain('source contents\n'.repeat(6000));
    expect(JSON.stringify(agent.state.messages)).toContain(JSON.stringify('source contents\n'.repeat(6000)).slice(1, -1));
    expect(metrics.savedHistoryTokens).toBeGreaterThan(1000);
  });

  it('ends a looping tool task at its model-turn limit without making another provider request', async () => {
    const setup = await fixture();
    const tools = [tool('list_directory')];
    const scripted = scriptedStream((_context, index) => call('list_directory', {}, `loop-${index}`));
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools, policy: { ...policy, maxModelTurns: 2 } });
    await agent.prompt('一直检查');
    expect(scripted.requests).toHaveLength(2);
    expect(tools[0].execute).toHaveBeenCalledTimes(2);
    expect(metrics.modelTurns).toBe(2);
    expect(metrics.limitReason).toContain('2 轮');
    expect(agent.state.messages.filter((message) => message.role === 'toolResult')).toHaveLength(2);
  });

  it('waits for an intent checkpoint and blocks the side effect if that checkpoint fails', async () => {
    const setup = await fixture();
    const tools = [tool('write_file')];
    const scripted = scriptedStream(() => call('write_file'));
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools, policy, onIntent: async () => { throw new Error('checkpoint refused'); } });
    await agent.prompt('写文件');
    expect(tools[0].execute).not.toHaveBeenCalled();
    expect(scripted.requests).toHaveLength(1);
    expect(metrics.limitReason).toContain('检查点保存失败');
  });

  it('awaits intent and result checkpoints before running the tool and sending the following request', async () => {
    const setup = await fixture();
    const tools = [tool('write_file')];
    const scripted = scriptedStream((_context, index) => index === 0 ? call('write_file') : assistant());
    let releaseIntent!: () => void;
    let releaseResult!: () => void;
    let enterIntent!: () => void;
    let enterResult!: () => void;
    const intentGate = new Promise<void>((resolve) => { releaseIntent = resolve; });
    const resultGate = new Promise<void>((resolve) => { releaseResult = resolve; });
    const intentEntered = new Promise<void>((resolve) => { enterIntent = resolve; });
    const resultEntered = new Promise<void>((resolve) => { enterResult = resolve; });
    const { agent } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn }, {
      ...setup, systemPrompt: '', tools, policy,
      onIntent: async () => { enterIntent(); await intentGate; },
      onResult: async () => { enterResult(); await resultGate; },
    });
    const running = agent.prompt('写入文件');
    await intentEntered;
    expect(tools[0].execute).not.toHaveBeenCalled();
    expect(scripted.requests).toHaveLength(1);
    releaseIntent();
    await resultEntered;
    expect(tools[0].execute).toHaveBeenCalledTimes(1);
    expect(scripted.requests).toHaveLength(1);
    releaseResult();
    await running;
    expect(scripted.requests).toHaveLength(2);
  });

  it('stops after a result checkpoint failure without replaying an already executed tool', async () => {
    const setup = await fixture();
    const tools = [tool('write_file')];
    const scripted = scriptedStream(() => call('write_file'));
    const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: scripted.streamFn }, { ...setup, systemPrompt: '', tools, policy, onResult: async () => { throw new Error('checkpoint write failed'); } });
    await agent.prompt('写入文件');
    expect(tools[0].execute).toHaveBeenCalledTimes(1);
    expect(scripted.requests).toHaveLength(1);
    expect(metrics.limitReason).toContain('检查点保存失败');
  });
});

describe('harness policy and token accounting', () => {
  it('accepts defaults and rejects invalid budgets instead of silently removing limits', () => {
    expect(validateHarnessPolicy(undefined)).toEqual(DEFAULT_HARNESS_POLICY);
    expect(validateHarnessPolicy({ maxModelTurns: 8 })).toMatchObject({ maxModelTurns: 8, offloadToolResults: true });
    for (const value of [null, [], { maxModelTurns: 0 }, { maxModelTurns: 257 }, { toolResultTokenLimit: 511 }, { toolResultTokenLimit: 32769 }, { runTimeoutSeconds: 9 }, { runTimeoutSeconds: 3601 }, { offloadToolResults: 'yes' }]) expect(() => validateHarnessPolicy(value)).toThrow();
  });

  it('bounds counting work for huge unbroken emoji strings while retaining a conservative estimate', () => {
    const input = '😀'.repeat(40000);
    const perEmoji = countEstimatedTokens('😀');
    const started = performance.now();
    const estimated = countEstimatedTokens(input);
    const durationMs = performance.now() - started;
    expect(estimated).toBeGreaterThanOrEqual(perEmoji * 40000);
    expect(durationMs).toBeLessThan(500);
  });
});
