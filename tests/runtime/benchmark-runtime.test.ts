import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, SimpleStreamOptions, TranscriptContext } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { RuntimeService } from '../../runtime/service.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { BenchmarkReport, BenchmarkStatus, RuntimeEvent, RuntimeRequest, Session, Settings } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });
const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
function message(model: Parameters<StreamFn>[0], content: AssistantMessage['content'], used = true): AssistantMessage {
  return { role: 'assistant', model: model.id, api: model.api, provider: model.provider, content, timestamp: Date.now(),
    stopReason: content.some((part) => part.type === 'toolCall') ? 'toolUse' : 'stop',
    usage: used ? { ...zeroUsage, input: 10, output: 2, cacheRead: 3, totalTokens: 15 } : zeroUsage };
}
function ended(value: AssistantMessage) {
  const stream = new AssistantMessageEventStream();
  stream.push({ type: 'start', partial: value });
  stream.push({ type: 'done', reason: value.stopReason === 'toolUse' ? 'toolUse' : 'stop', message: value });
  stream.end(value);
  return stream;
}
async function request(service: RuntimeService, method: RuntimeRequest['method'], params: unknown = {}) {
  return service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
}
async function until(predicate: () => boolean) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('fixture event timed out');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
async function fixture(streamFn: StreamFn, settingsPatch: Partial<Settings> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-benchmark-runtime-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: directory, streamFn, emit: (event) => events.push(event) });
  cleanup.push(() => service.shutdown());
  const configured = await request(service, 'settings.set', { settings: { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'chat-completions', baseUrl: 'https://benchmark-fixture.invalid/v1', model: 'fixture-A', ...settingsPatch }, apiKey: 'benchmark-memory-secret-A' });
  expect(configured.error).toBeUndefined();
  return { service, directory, events, settings: (configured.result as { settings: Settings }).settings };
}
async function savedText(directory: string): Promise<string> {
  const files: string[] = [];
  async function walk(current: string) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const name = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(name); else files.push(await readFile(name, 'utf8'));
    }
  }
  await walk(directory); return files.join('\n');
}
function toolNames(context: TranscriptContext) {
  return context.messages.flatMap((item) => item.role === 'system' ? (item.toolsAdded ?? []).map((tool) => tool.name) : []);
}

describe('benchmark RuntimeService integration', () => {
  it('runs official BFCL schemas through the shared single-turn harness without session tools, hidden prompts or live fixture scores', async () => {
    const contexts: TranscriptContext[] = [];
    const { service, events } = await fixture((model, context) => {
      contexts.push(structuredClone(context));
      const names = toolNames(context);
      return ended(message(model, [{ type: 'toolCall', id: `bfcl-${contexts.length}`, name: names[0], arguments: names[0] === 'calculate_triangle_area' ? { base: 10, height: 5 } : { side1: 5, side2: 4, side3: 3 } }]));
    }, { systemPrompt: 'USER_SYSTEM_PROMPT_MUST_NOT_LEAK', enabledTools: ['write_file', 'run_command'] });
    const existing = (await request(service, 'sessions.create')).result as Session;
    const started = await request(service, 'benchmark.start', { suite: 'bfcl-v4', limit: 2 });
    expect(started.error).toBeUndefined();
    await service.waitForBenchmark();
    const runId = (started.result as { runId: string }).runId;
    const report = (await request(service, 'benchmark.report', { runId })).result as BenchmarkReport;
    expect(contexts).toHaveLength(2);
    expect(toolNames(contexts[0])).toEqual(['calculate_triangle_area']);
    expect(toolNames(contexts[1])).toContain('triangle_properties_get');
    expect(JSON.stringify(contexts)).not.toContain('USER_SYSTEM_PROMPT_MUST_NOT_LEAK');
    expect(JSON.stringify(contexts)).not.toContain('write_file');
    expect(JSON.stringify(contexts)).not.toContain('run_command');
    expect(report).toMatchObject({ mode: 'fixture', completed: 2, total: 2, settings: { maxAnswerTurns: 1, freshContextPerTask: true, browsing: false } });
    expect(report.metrics).toMatchObject({ correct: 2, graded: 2, accuracy: null, totalInputTokens: 26 });
    expect(events.filter((event) => event.type === 'benchmark.finished')).toHaveLength(1);
    const session = (await request(service, 'sessions.load', { sessionId: existing.id })).result as Session;
    expect(session.messages).toEqual([]);
    expect((await request(service, 'benchmark.status')).result).toMatchObject({ reports: [{ runId, mode: 'fixture', accuracy: null }] });
  });

  it('freezes the selected model and key for all tasks despite settings being changed between requests', async () => {
    const requests: { model: string; key?: string }[] = [];
    let release: (() => void) | undefined;
    const { service, settings } = await fixture((model, _context, options) => {
      requests.push({ model: model.id, key: options?.apiKey });
      const response = message(model, [{ type: 'text', text: requests.length === 1 ? 'independent answer' : 'A' }]);
      if (requests.length !== 1) return ended(response);
      const stream = new AssistantMessageEventStream();
      release = () => { stream.push({ type: 'done', reason: 'stop', message: response }); stream.end(response); };
      return stream;
    });
    const started = await request(service, 'benchmark.start', { suite: 'simpleqa', limit: 1 });
    await until(() => requests.length === 1);
    const changed: Settings = { ...settings, model: 'fixture-B', customProviders: settings.customProviders?.map((provider) => ({ ...provider, models: [...provider.models, { id: 'fixture-B', enabled: true, source: 'manual' as const }] })) };
    expect((await request(service, 'settings.set', { settings: changed, apiKey: 'benchmark-memory-secret-B' })).error).toBeUndefined();
    release!();
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(requests).toEqual([{ model: 'fixture-A', key: 'benchmark-memory-secret-A' }, { model: 'fixture-A', key: 'benchmark-memory-secret-A' }]);
    expect(report.model).toBe('fixture-A');
  });

  it('persists a redacted fixture report, retains unknown usage, and restores reports without persisting the API key', async () => {
    let calls = 0;
    const { service, directory, events } = await fixture((model) => ended(message(model, [{ type: 'text', text: ++calls === 1 ? 'benchmark-memory-secret-A' : 'B' }], false)));
    const started = await request(service, 'benchmark.start', { suite: 'simpleqa', limit: 1 });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(report.cases[0].answer).toContain('已隐藏');
    expect(report.metrics).toMatchObject({ totalInputTokens: null, inputUsageUnknown: true, accuracy: null });
    expect(await savedText(directory)).not.toContain('benchmark-memory-secret-A');
    expect(JSON.stringify(events)).not.toContain('benchmark-memory-secret-A');
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: directory, emit: () => {} });
    cleanup.push(() => restored.shutdown());
    const status = (await request(restored, 'benchmark.status')).result as BenchmarkStatus;
    expect(status.reports[0]).toMatchObject({ mode: 'fixture', suite: 'simpleqa', accuracy: null });
    expect((await request(restored, 'settings.get')).result).toMatchObject({ hasApiKey: false });
  });

  it('cancels a blocked provider response, makes its score unknown, and does not start a grader request', async () => {
    let calls = 0;
    const { service } = await fixture((model, _context, options?: SimpleStreamOptions) => {
      calls++;
      const stream = new AssistantMessageEventStream();
      const abort = () => {
        const error: AssistantMessage = { ...message(model, [], false), stopReason: 'aborted', errorMessage: 'fixture cancelled' };
        stream.push({ type: 'error', reason: 'aborted', error }); stream.end(error);
      };
      options?.signal?.addEventListener('abort', abort, { once: true });
      if (options?.signal?.aborted) abort();
      return stream;
    });
    const started = await request(service, 'benchmark.start', { suite: 'simpleqa', limit: 2 });
    await until(() => calls === 1);
    expect((await request(service, 'benchmark.cancel')).result).toEqual({ cancelled: true });
    await service.waitForBenchmark();
    const report = (await request(service, 'benchmark.report', started.result)).result as BenchmarkReport;
    expect(calls).toBe(1);
    expect(report).toMatchObject({ status: 'cancelled', completed: 1, total: 2, mode: 'fixture' });
    expect(report.metrics).toMatchObject({ graded: 0, unknown: 2, accuracy: null });
  });

  it('rejects unauthenticated live evaluation and disabled models before creating any report', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-benchmark-live-preflight-'));
    cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const service = new RuntimeService({ dataDir: directory, emit: () => {} }); cleanup.push(() => service.shutdown());
    expect((await request(service, 'benchmark.start', { suite: 'simpleqa', limit: 1 })).error?.code).toBe('LOGIN_REQUIRED');
    const configuration = (await request(service, 'settings.get')).result as { settings: Settings };
    const disabled = { ...configuration.settings, chatgptModels: configuration.settings.chatgptModels?.map((model) => ({ ...model, enabled: false })) };
    expect((await request(service, 'settings.set', { settings: disabled })).error).toBeUndefined();
    expect((await request(service, 'benchmark.start', { suite: 'bfcl-v4', limit: 1 })).error).toBeDefined();
    expect((await request(service, 'benchmark.status')).result).toEqual({ reports: [] });
    expect(await readdir(path.join(directory, 'benchmarks'))).toEqual([]);
  });
});
