import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, TranscriptContext } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { loadLongHarnessCases } from '../../benchmarks/longharness.js';
import { loadLettaContextCases } from '../../benchmarks/letta-context.js';
import { RuntimeService } from '../../runtime/service.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { BenchmarkReport, RuntimeEvent, RuntimeRequest, Settings } from '../../shared/protocol.js';

vi.mock('../../benchmarks/longharness.js', async (original) => ({
  ...await original<typeof import('../../benchmarks/longharness.js')>(), loadLongHarnessCases: vi.fn(),
}));
vi.mock('../../benchmarks/letta-context.js', async (original) => ({
  ...await original<typeof import('../../benchmarks/letta-context.js')>(), loadLettaContextCases: vi.fn(),
}));
const source = { revision: 'synthetic-fixed', upstream: 'https://fixture.invalid', license: 'synthetic',
  sourceFileHashes: { 'corpus.txt': 'a'.repeat(64) }, selectedIds: ['case-0'], sampling: 'synthetic', subsetSha256: 'b'.repeat(64) };
const files = [{ path: 'corpus.txt', text: 'safe corpus without oracle answers' }];
const cleanup: (() => Promise<void>)[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadLongHarnessCases).mockImplementation(async (_suite, limit) => ({ source,
    cases: Array.from({ length: limit }, (_, index) => ({ id: `case-${index}`, task: 'constraint-solving-search', prompt: `Question ${index}`, files,
      gold: { matches: ['oracle-only-answer'], required_files: ['hidden-route'], verification_query: 'SELECT hidden-value' } })),
  }));
  vi.mocked(loadLettaContextCases).mockImplementation(async (limit) => ({ source,
    cases: Array.from({ length: limit }, (_, index) => ({ id: `case-${index}`, prompt: `Question ${index}`, files, gold: 'oracle-only-answer' })),
  }));
});
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function ended(model: Parameters<StreamFn>[0], content: AssistantMessage['content'], used = true) {
  const value: AssistantMessage = { role: 'assistant', model: model.id, api: model.api, provider: model.provider, content,
    timestamp: Date.now(), stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    usage: used ? { ...zeroUsage, input: 10, output: 2, cacheRead: 3, totalTokens: 15 } : zeroUsage };
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: value });
  stream.push({ type: 'done', reason: value.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: value });
  stream.end(value);
  return stream;
}
function toolNames(context: TranscriptContext) {
  return context.messages.flatMap((item) => item.role === 'system' ? (item.toolsAdded ?? []).map((tool) => tool.name) : []);
}
async function request(service: RuntimeService, method: RuntimeRequest['method'], params: unknown = {}) {
  return service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
}
async function fixture(streamFn: StreamFn, settingsPatch: Partial<Settings> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-filesystem-runtime-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: directory, streamFn, emit: (event) => events.push(event) });
  cleanup.push(() => service.shutdown());
  const configured = await request(service, 'settings.set', { settings: { ...DEFAULT_SETTINGS, connection: 'compatible',
    apiFormat: 'chat-completions', baseUrl: 'https://fixture.invalid/v1', model: 'fixture-model', ...settingsPatch }, apiKey: 'ephemeral-fixture-secret' });
  expect(configured.error).toBeUndefined();
  return { service, directory, events };
}

describe('filesystem benchmark through the shared RuntimeService harness', () => {
  it('executes multiple tool rounds, reports only the final assistant text, counts actual request usage and restores the saved fixture report', async () => {
    const contexts: TranscriptContext[] = [];
    const { service, directory, events } = await fixture(async (model, context, options) => {
      contexts.push(structuredClone(context));
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      const round = contexts.length;
      if (round === 1) return ended(model, [{ type: 'text', text: 'Intermediate planning.' },
        { type: 'toolCall', id: 'list-1', name: 'list_directory', arguments: {} }]);
      if (round === 2) return ended(model, [{ type: 'text', text: 'Intermediate inspecting.' },
        { type: 'toolCall', id: 'read-2', name: 'read_file', arguments: { path: 'corpus.txt' } }]);
      return ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' }]);
    }, { systemPrompt: 'USER_PROMPT_NOT_ALLOWED', enabledTools: ['write_file', 'run_command'] });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1 });
    expect(started.error).toBeUndefined();
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(contexts).toHaveLength(3);
    expect(toolNames(contexts[0])).toEqual(['list_directory', 'read_file', 'search_file']);
    expect(JSON.stringify(contexts)).not.toMatch(/USER_PROMPT_NOT_ALLOWED|oracle-only-answer|hidden-route|SELECT hidden-value|write_file|run_command/);
    expect(report.cases[0]).toMatchObject({ status: 'passed', answer: '{"matches":["oracle-only-answer"]}', requestCount: 3, toolCallCount: 2,
      usage: { input: 30, cacheRead: 9, totalInput: 39 } });
    expect(report.cases[0].answer).not.toContain('Intermediate');
    expect(report.metrics).toMatchObject({ correct: 1, graded: 1, accuracy: null, requestCount: 3, toolCallCount: 2, totalInputTokens: 39, totalOutputTokens: 6 });
    expect(events.filter((event) => event.type === 'benchmark.finished')).toHaveLength(1);
    const storedFiles = await readdir(path.join(directory, 'benchmarks'));
    expect(storedFiles).toHaveLength(1);
    const stored = await readFile(path.join(directory, 'benchmarks', storedFiles[0]), 'utf8');
    expect(stored).not.toContain('ephemeral-fixture-secret');
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: directory, emit: () => {} });
    cleanup.push(() => restored.shutdown());
    expect((await request(restored, 'benchmark.status')).result).toMatchObject({ reports: [{ suite: 'longharness-constraint', profile: 'agent', mode: 'fixture', accuracy: null }] });
    expect((await request(restored, 'benchmark.report', started.result)).result).toEqual(report);
  });

  it('gives the direct profile complete documents, zero tools and exactly one model request', async () => {
    const contexts: TranscriptContext[] = [];
    const { service } = await fixture(async (model, context, options) => {
      contexts.push(structuredClone(context));
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      return ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' }]);
    });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1, profile: 'direct' });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(contexts).toHaveLength(1);
    expect(toolNames(contexts[0])).toEqual([]);
    expect(JSON.stringify(contexts)).toContain('safe corpus without oracle answers');
    expect(JSON.stringify(contexts)).not.toMatch(/oracle-only-answer|hidden-route|SELECT hidden-value/);
    expect(report.settings).toMatchObject({ profile: 'direct', maxAnswerTurns: 1, tools: [] });
    expect(report.metrics).toMatchObject({ requestCount: 1, toolCallCount: 0, accuracy: null });
  });

  it('uses suite-specific defaults and rejects bad profiles before invoking a loader or provider', async () => {
    const provider = vi.fn<StreamFn>((model) => ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' }]));
    const { service } = await fixture(provider);
    for (const params of [{ suite: 'longharness-constraint', profile: 'invalid' }, { suite: 'letta-context', profile: 'direct' },
      { suite: 'longharness-memos', limit: 51 }, { suite: 'letta-context', limit: 101 }]) {
      expect((await request(service, 'benchmark.start', params)).error?.code).toBe('INVALID_PARAMS');
    }
    expect(provider).not.toHaveBeenCalled();
    expect(loadLongHarnessCases).not.toHaveBeenCalled();
    expect(loadLettaContextCases).not.toHaveBeenCalled();
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint' });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(report.total).toBe(2);
    expect(loadLongHarnessCases).toHaveBeenCalledWith('longharness-constraint', 2, expect.objectContaining({ cacheDir: expect.stringContaining('benchmark-cache') }));
  });

  it('treats an exhausted multi-turn budget as a known failure instead of grading pending work as successful', async () => {
    let requests = 0;
    const { service } = await fixture(async (model, context, options) => {
      requests++;
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      return ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' },
        { type: 'toolCall', id: `pending-${requests}`, name: 'read_file', arguments: { path: 'corpus.txt' } }]);
    }, { harness: { ...DEFAULT_SETTINGS.harness!, maxModelTurns: 2 } });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(requests).toBe(2);
    expect(report.cases[0]).toMatchObject({ status: 'failed', terminationReason: 'turn-limit' });
    expect(report.metrics).toMatchObject({ incorrect: 1, graded: 1, unknown: 0, requestCount: 2 });
  });

  it('preserves missing provider usage and fixture mean reward as unknown across answer and independent grader requests', async () => {
    let requests = 0;
    const { service } = await fixture(async (model, context, options) => {
      requests++;
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      return ended(model, [{ type: 'text', text: requests === 1 ? 'I cannot help with that.' : '{"reward":0.5,"rationale":"refusal"}' }], requests === 1);
    });
    const started = await request(service, 'benchmark.start', { suite: 'letta-context', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(requests).toBe(2);
    expect(report.cases[0]).toMatchObject({ status: 'failed', reward: 0.5, graderUsage: null });
    expect(report.metrics).toMatchObject({ correct: 0, incorrect: 1, accuracy: null, meanReward: null,
      requestCount: 2, knownInputTokens: 13, totalInputTokens: null, inputUsageUnknown: true });
  });

  it('retains the agent-profile turn boundary even when the configured model-turn budget is one', async () => {
    let requests = 0;
    const { service } = await fixture(async (model, context, options) => {
      requests++;
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      return ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' },
        { type: 'toolCall', id: 'pending-one-turn', name: 'read_file', arguments: { path: 'corpus.txt' } }]);
    }, { harness: { ...DEFAULT_SETTINGS.harness!, maxModelTurns: 1 } });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(requests).toBe(1);
    expect(report.cases[0]).toMatchObject({ status: 'failed', terminationReason: 'turn-limit' });
    expect(report.metrics).toMatchObject({ correct: 0, incorrect: 1, graded: 1, unknown: 0 });
  });

  it('retains known provider usage from the first turn when the final response has no usage', async () => {
    let requests = 0;
    const { service } = await fixture(async (model, context, options) => {
      requests++;
      await options?.onPayload?.({ model: model.id, messages: context.messages }, model);
      return requests === 1
        ? ended(model, [{ type: 'toolCall', id: 'read-metered', name: 'read_file', arguments: { path: 'corpus.txt' } }])
        : ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' }], false);
    });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(requests).toBe(2);
    expect(report.cases[0]).toMatchObject({ status: 'passed', usage: null,
      knownUsage: { input: 10, output: 2, cacheRead: 3, totalInput: 13 }, requestCount: 2 });
    expect(report.metrics).toMatchObject({ knownInputTokens: 13, totalInputTokens: null, totalOutputTokens: null,
      inputUsageUnknown: true, requestCount: 2, toolCallCount: 1 });
  });

  it.each(['chat-completions', 'responses'] as const)('records the dynamically disclosed artifact reader from %s request schemas after a large search result', async (apiFormat) => {
    const largeText = Array.from({ length: 24 }, (_, index) => `${index}: needle ${'context record data '.repeat(40)}\n`).join('');
    vi.mocked(loadLongHarnessCases).mockResolvedValue({ source,
      cases: [{ id: 'large-case', task: 'constraint-solving-search', prompt: 'Read relevant original evidence.',
        files: [{ path: 'corpus.txt', text: largeText }], gold: { matches: ['oracle-only-answer'] } }] });
    const contexts: TranscriptContext[] = [];
    const { service } = await fixture(async (model, context, options) => {
      contexts.push(structuredClone(context));
      const names = toolNames(context);
      const tools = names.map((name) => apiFormat === 'responses'
        ? { type: 'function', name } : { type: 'function', function: { name } });
      await options?.onPayload?.({ model: model.id, messages: context.messages, tools }, model);
      if (contexts.length === 1) return ended(model, [{ type: 'toolCall', id: 'large-search', name: 'search_file',
        arguments: { path: 'corpus.txt', query: 'needle', limit: 20 } }]);
      if (contexts.length === 2) {
        expect(names).toContain('read_artifact');
        const artifactId = /工具结果已外置：([\da-f-]{36})/.exec(JSON.stringify(context))?.[1];
        expect(artifactId).toBeDefined();
        return ended(model, [{ type: 'toolCall', id: 'original-page', name: 'read_artifact',
          arguments: { id: artifactId, offset: 0, limit: 256 } }]);
      }
      return ended(model, [{ type: 'text', text: '{"matches":["oracle-only-answer"]}' }]);
    }, { apiFormat, harness: { ...DEFAULT_SETTINGS.harness!, toolResultTokenLimit: 512 } });
    const started = await request(service, 'benchmark.start', { suite: 'longharness-constraint', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(contexts).toHaveLength(3);
    expect(toolNames(contexts[0])).toEqual(['list_directory', 'read_file', 'search_file']);
    expect(toolNames(contexts[1])).toEqual(['list_directory', 'read_file', 'search_file', 'read_artifact']);
    expect(JSON.stringify(contexts[2])).toContain('needle');
    expect(report.cases[0]).toMatchObject({ status: 'passed', requestCount: 3, toolCallCount: 2,
      observedTools: ['list_directory', 'read_file', 'search_file', 'read_artifact'] });
    expect(report.cases[0].calls?.map((call) => call.name)).toEqual(['search_file', 'read_artifact']);
    expect(report.settings).toMatchObject({ baseTools: ['list_directory', 'read_file', 'search_file'],
      tools: ['list_directory', 'read_file', 'search_file', 'read_artifact'] });
  });
});
