import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AST_ORACLE_FIXTURES } from '../../benchmarks/ast-oracle-fixtures.js';
import { BFCL_CASES, SIMPLEQA_CASES } from '../../benchmarks/data.js';
import { loadLettaContextCases } from '../../benchmarks/letta-context.js';
import { runBenchmark, scoreBfcl } from '../../runtime/benchmarks.js';
import type { BenchmarkExecution } from '../../runtime/benchmarks.js';

vi.mock('../../benchmarks/letta-context.js', async (original) => ({
  ...await original<typeof import('../../benchmarks/letta-context.js')>(), loadLettaContextCases: vi.fn(),
}));

const boundaries = ['turn-limit', 'timeout', 'token-budget'] as const;
const usage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, totalInput: 13, source: 'provider' as const };
const source = { revision: 'isolated-boundary-fixture', upstream: 'https://fixture.invalid/', license: 'Fixture only',
  sourceFileHashes: {}, selectedIds: ['boundary-0'], sampling: 'isolated fixture', subsetSha256: '0'.repeat(64) };
const validBfclCalls = AST_ORACLE_FIXTURES.find((item) => item.id === BFCL_CASES[0].id && item.kind === 'valid')!.calls;

function execution(text: string, extra: Partial<BenchmarkExecution> = {}): BenchmarkExecution {
  return { text, calls: [], elapsedMs: 1, estimatedInputTokens: 12, usage, requestCount: 1, toolCallCount: 0, ...extra };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadLettaContextCases).mockResolvedValue({ source,
    cases: [{ id: 'boundary-0', prompt: 'Find the person.', files: [{ path: 'people.txt', text: 'Visible task document.' }], gold: 'isolated-gold' }] });
});

describe('benchmark boundaries cannot turn buffered valid content into success', () => {
  it.each(boundaries)('rejects BFCL valid calls delivered with %s', async (terminationReason) => {
    expect(scoreBfcl(BFCL_CASES[0], validBfclCalls).passed).toBe(true);
    const execute = vi.fn(async () => execution('', { calls: validBfclCalls, toolCallCount: validBfclCalls.length, terminationReason }));
    const report = await runBenchmark({ suite: 'bfcl-v4', limit: 1, execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(report.cases[0].status).not.toBe('passed');
    expect(report.cases[0].terminationReason).toBe(terminationReason);
    expect(report.metrics.correct).toBe(0);
    expect(report.metrics.accuracy).not.toBe(1);
  });

  it.each(boundaries)('does not judge a correct SimpleQA answer delivered with %s', async (terminationReason) => {
    const execute = vi.fn(async () => execution(SIMPLEQA_CASES[0].answer, { terminationReason }));
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, execute });
    expect(execute).toHaveBeenCalledOnce();
    expect(report.cases[0].status).not.toBe('passed');
    expect(report.cases[0].terminationReason).toBe(terminationReason);
    expect(report.metrics.correct).toBe(0);
    expect(report.metrics.accuracy).not.toBe(1);
  });

  it.each(boundaries)('keeps a SimpleQA A grading response delivered with %s unknown', async (terminationReason) => {
    let requests = 0;
    const execute = vi.fn(async () => execution(++requests === 1 ? SIMPLEQA_CASES[0].answer : 'A', requests === 2 ? { terminationReason } : {}));
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(report.cases[0].status).toBe('unknown');
    expect(report.cases[0].grade).toBeUndefined();
    expect(report.metrics).toMatchObject({ correct: 0, graded: 0, unknown: 1, accuracy: null });
  });

  it.each(boundaries)('keeps a Letta valid reward=1 grading response delivered with %s unknown', async (terminationReason) => {
    let requests = 0;
    const execute = vi.fn(async () => execution(++requests === 1 ? 'isolated-gold' : '{"reward":1,"rationale":"exact match"}', requests === 2 ? { terminationReason } : {}));
    const report = await runBenchmark({ suite: 'letta-context', limit: 1, execute });
    expect(execute).toHaveBeenCalledTimes(2);
    expect(report.cases[0].status).toBe('unknown');
    expect(report.cases[0].reward).toBeUndefined();
    expect(report.metrics).toMatchObject({ correct: 0, graded: 0, unknown: 1, accuracy: null, meanReward: null });
  });
});
