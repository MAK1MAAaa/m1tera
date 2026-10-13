import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLongHarnessCases } from '../../benchmarks/longharness.js';
import { loadLettaContextCases } from '../../benchmarks/letta-context.js';
import { runBenchmark } from '../../runtime/benchmarks.js';
import { runFilesystemBenchmark } from '../../runtime/filesystem-benchmarks.js';
import type { BenchmarkExecution, BenchmarkTask } from '../../runtime/benchmarks.js';
import type { BenchmarkSuiteId } from '../../shared/benchmark-catalog.js';
import type { LongHarnessCase } from '../../benchmarks/longharness.js';

vi.mock('../../benchmarks/longharness.js', async (original) => ({
  ...await original<typeof import('../../benchmarks/longharness.js')>(), loadLongHarnessCases: vi.fn(),
}));
vi.mock('../../benchmarks/letta-context.js', async (original) => ({
  ...await original<typeof import('../../benchmarks/letta-context.js')>(), loadLettaContextCases: vi.fn(),
}));

const source = { revision: 'fixed-synthetic-revision', upstream: 'https://fixture.invalid/source', license: 'synthetic',
  sourceFileHashes: { 'corpus.txt': 'a'.repeat(64), 'gold.json': 'b'.repeat(64) }, selectedIds: ['case-0'],
  sampling: 'synthetic selection', subsetSha256: 'c'.repeat(64) };
const files = [{ path: 'corpus.txt', text: 'visible corpus facts' }];
const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, totalInput: 13, source: 'provider' as const };
function execution(text: string, extra: Partial<BenchmarkExecution> = {}): BenchmarkExecution {
  return { text, calls: [], elapsedMs: 5, estimatedInputTokens: 14, usage, requestCount: 1, toolCallCount: 0, ...extra };
}
function longCase(task = 'constraint-solving-search', gold: unknown = { matches: ['hidden-gold'] }): LongHarnessCase {
  return { id: 'case-0', task, prompt: 'Find the answer from the documents.', files: structuredClone(files), gold };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadLongHarnessCases).mockResolvedValue({ source: structuredClone(source), cases: [longCase()] });
  vi.mocked(loadLettaContextCases).mockResolvedValue({ source: structuredClone(source),
    cases: [{ id: 'case-0', prompt: 'Find a person.', files: structuredClone(files), gold: 'hidden-gold' }] });
});

describe('filesystem benchmark execution contracts', () => {
  it('runs an agent with bounded multiple turns and only document tools; gold never reaches the answer agent', async () => {
    const tasks: BenchmarkTask[] = [];
    const report = await runBenchmark({ suite: 'longharness-constraint', limit: 1, cacheDir: '/synthetic-cache',
      execute: async (task) => { tasks.push(task); return execution('{"matches":["hidden-gold"]}', { requestCount: 3, toolCallCount: 2 }); } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ maxTurns: 24, systemPrompt: '', tokenBudget: 300_000 });
    expect(tasks[0].prompt).not.toContain('hidden-gold');
    expect(tasks[0].prompt).not.toContain('visible corpus facts');
    expect(tasks[0].tools.map((tool) => tool.name)).toEqual(['list_directory', 'read_file', 'search_file']);
    const listed = await tasks[0].tools[0].execute('probe', {});
    const text = JSON.stringify(listed);
    expect(text).toContain('corpus.txt');
    expect(text).not.toMatch(/gold|required_files|verification_query/);
    expect(report.metrics).toMatchObject({ correct: 1, graded: 1, accuracy: 1, requestCount: 3, toolCallCount: 2, totalInputTokens: 13 });
    expect(report.source).toEqual(source);
    expect(loadLongHarnessCases).toHaveBeenCalledWith('longharness-constraint', 1, expect.objectContaining({ cacheDir: '/synthetic-cache' }));
  });

  it('offers a single-request direct profile with the entire corpus and zero tools, while excluding gold and route hints', async () => {
    const tasks: BenchmarkTask[] = [];
    const example = { ...longCase(), required_files: ['private-route'], verification_query: 'SELECT hidden-gold' };
    vi.mocked(loadLongHarnessCases).mockResolvedValue({ source, cases: [example] });
    const report = await runBenchmark({ suite: 'longharness-constraint', limit: 1, profile: 'direct',
      execute: async (task) => { tasks.push(task); return execution('{"matches":["hidden-gold"]}'); } });
    expect(tasks[0]).toMatchObject({ maxTurns: 1, systemPrompt: '', tools: [] });
    expect(tasks[0].prompt).toContain('visible corpus facts');
    expect(tasks[0].prompt).not.toMatch(/hidden-gold|private-route|SELECT/);
    expect(report.settings).toMatchObject({ profile: 'direct', maxAnswerTurns: 1, tools: [], sameModelForGrader: false });
  });

  it.each([
    ['longharness-constraint', 'constraint-solving-search', { matches: ['person'] }, '{"matches":["person"]}'],
    ['longharness-memos', 'outlier-memo-detection', { memo_ids: ['M-001'] }, 'Final Answer: [M-001]'],
    ['longharness-tracing', 'program-execution-tracing', { answer: { value: 3 }, evidence: [1, 2] }, '{"answer":{"value":3},"evidence":[2,1]}'],
    ['longharness-pairs', 'equivalent-program-pair-search', { expected_pairs: [[1, 2]] }, '[[2,1]]'],
  ] as const)('selects suite %s and keeps fixed source identity with its specific official task rule', async (suite, task, gold, answer) => {
    vi.mocked(loadLongHarnessCases).mockResolvedValue({ source, cases: [longCase(task, gold)] });
    const report = await runBenchmark({ suite, limit: 1, execute: async () => execution(answer) });
    expect(report).toMatchObject({ suite, source, metrics: { correct: 1, unknown: 0 } });
    expect(vi.mocked(loadLongHarnessCases).mock.calls[0][0]).toBe(suite);
  });

  it('requires both program-tracing result and evidence rather than granting success for a correct final value alone', async () => {
    vi.mocked(loadLongHarnessCases).mockResolvedValue({ source, cases: [longCase('program-execution-tracing', { answer: { value: 3 }, evidence: [1, 2] })] });
    const report = await runBenchmark({ suite: 'longharness-tracing', limit: 1,
      execute: async () => execution('{"answer":{"value":3},"evidence":[1]}') });
    expect(report.cases[0]).toMatchObject({ status: 'failed', answerExact: true, evidenceExact: false });
    expect(report.metrics).toMatchObject({ correct: 0, incorrect: 1, graded: 1, unknown: 0, accuracy: 0 });
  });

  it('tracks Letta refusal reward separately from strict success and isolates the gold in an independent grader request', async () => {
    const tasks: BenchmarkTask[] = [];
    const report = await runBenchmark({ suite: 'letta-context', limit: 1, execute: async (task) => {
      tasks.push(task); return execution(tasks.length === 1 ? 'I cannot help with that.' : '{"reward":0.5,"rationale":"refusal"}');
    } });
    expect(tasks[0].prompt).not.toContain('hidden-gold');
    expect(tasks[0].tools.map((tool) => tool.name)).toEqual(['list_directory', 'read_file', 'search_file']);
    expect(tasks[1].prompt).toContain('Expected Answer: hidden-gold');
    expect(tasks[1]).toMatchObject({ tools: [], maxTurns: 1, systemPrompt: '' });
    expect(report.cases[0]).toMatchObject({ status: 'failed', reward: 0.5, requestCount: 2 });
    expect(report.metrics).toMatchObject({ correct: 0, incorrect: 1, graded: 1, unknown: 0, accuracy: 0, meanReward: 0.5, totalInputTokens: 26 });
  });

  it('keeps malformed or tool-calling judge results unknown, excludes them from mean reward, and preserves known input usage', async () => {
    vi.mocked(loadLettaContextCases).mockResolvedValue({ source, cases: [0, 1].map((index) => ({ id: `case-${index}`, prompt: 'Question', files, gold: 'gold' })) });
    let step = 0;
    const report = await runBenchmark({ suite: 'letta-context', limit: 2, execute: async () => {
      step++;
      return execution(step % 2 ? 'answer' : step === 2 ? '{"reward":0.25}' : '{"reward":1}',
        step === 4 ? { calls: [{ name: 'untrusted_tool', arguments: {} }] } : {});
    } });
    expect(report.metrics).toMatchObject({ graded: 0, unknown: 2, accuracy: null, meanReward: null, knownInputTokens: 52 });
    expect(report.cases.every((item) => item.status === 'unknown' && item.reward === undefined)).toBe(true);
  });

  it('does not publish fixture accuracy or mean reward even when injected answers satisfy all rules', async () => {
    let requests = 0;
    const report = await runBenchmark({ suite: 'letta-context', limit: 1, mode: 'fixture',
      execute: async () => execution(++requests === 1 ? 'answer' : '{"reward":1}') });
    expect(report).toMatchObject({ mode: 'fixture', metrics: { correct: 1, accuracy: null, accuracyGivenAttempted: null, meanReward: null } });
  });

  it('keeps total usage unknown if the grader or answer does not expose usage instead of converting it to zero', async () => {
    let requests = 0;
    const report = await runBenchmark({ suite: 'letta-context', limit: 1, execute: async () => {
      requests++; return execution(requests === 1 ? 'answer' : '{"reward":1}', requests === 2 ? { usage: null } : {});
    } });
    expect(report.metrics).toMatchObject({ correct: 1, knownInputTokens: 13, totalInputTokens: null, totalOutputTokens: null, inputUsageUnknown: true });
    expect(report.cases[0].graderUsage).toBeNull();
  });

  it('preserves the known first response of a partially metered multi-turn answer without claiming a complete total', async () => {
    const report = await runBenchmark({ suite: 'longharness-constraint', limit: 1,
      execute: async () => execution('{"matches":["hidden-gold"]}', { usage: null, knownUsage: usage, requestCount: 2 }) });
    expect(report.cases[0]).toMatchObject({ status: 'passed', usage: null, knownUsage: usage, requestCount: 2 });
    expect(report.metrics).toMatchObject({ correct: 1, knownInputTokens: 13, totalInputTokens: null,
      totalOutputTokens: null, inputUsageUnknown: true, requestCount: 2 });
  });

  it.each(['turn-limit', 'timeout', 'token-budget'] as const)('marks a %s boundary as a measured failure without requesting a grader', async (terminationReason) => {
    const execute = vi.fn(async () => execution('apparently correct answer', { terminationReason }));
    const report = await runBenchmark({ suite: 'letta-context', limit: 1, execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(report.cases[0]).toMatchObject({ status: 'failed', reward: 0, terminationReason });
    expect(report.metrics).toMatchObject({ graded: 1, incorrect: 1, unknown: 0, meanReward: 0, accuracy: 0, totalInputTokens: 13 });
  });

  it('cancels after answering without requesting a grader or beginning subsequent tasks', async () => {
    vi.mocked(loadLettaContextCases).mockResolvedValue({ source, cases: [0, 1].map((index) => ({ id: `case-${index}`, prompt: 'Question', files, gold: 'gold' })) });
    const controller = new AbortController();
    const execute = vi.fn(async () => { controller.abort(); return execution('partial'); });
    const report = await runBenchmark({ suite: 'letta-context', limit: 2, signal: controller.signal, execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(report).toMatchObject({ status: 'cancelled', completed: 1, total: 2, metrics: { graded: 0, unknown: 2, accuracy: null, meanReward: null, totalInputTokens: null } });
    expect(report.cases[0].reward).toBeUndefined();
  });

  it('applies catalog default limits and validates profile/limit before loading any remote corpus', async () => {
    await runBenchmark({ suite: 'letta-context', execute: async () => execution('ungraded') });
    expect(loadLettaContextCases).toHaveBeenCalledWith(3, expect.any(Object));
    vi.clearAllMocks();
    await runBenchmark({ suite: 'longharness-memos', execute: async () => execution('[]') });
    expect(loadLongHarnessCases).toHaveBeenCalledWith('longharness-memos', 2, expect.any(Object));
    vi.clearAllMocks();
    for (const [suite, limit, profile] of [['letta-context', 101, 'agent'], ['longharness-memos', 51, 'agent'],
      ['letta-context', 1, 'direct'], ['longharness-memos', 1, 'invalid'], ['unknown', 1, 'agent']]) {
      await expect(runBenchmark({ suite: suite as BenchmarkSuiteId, limit: limit as number,
        profile: profile as 'agent', execute: async () => execution('unused') })).rejects.toThrow();
    }
    expect(loadLongHarnessCases).not.toHaveBeenCalled();
    expect(loadLettaContextCases).not.toHaveBeenCalled();
  });

  it('does not hide dataset failures behind a fabricated completed benchmark', async () => {
    vi.mocked(loadLongHarnessCases).mockRejectedValue(new Error('hash mismatch'));
    const execute = vi.fn(async () => execution('unused'));
    await expect(runFilesystemBenchmark({ suite: 'longharness-memos', limit: 1, execute })).rejects.toThrow('hash mismatch');
    expect(execute).not.toHaveBeenCalled();
  });
});
