import { describe, expect, it } from 'vitest';
import { AST_ORACLE_FIXTURES } from '../../benchmarks/ast-oracle-fixtures.js';
import { BENCHMARK_SOURCE, BFCL_CASES, SIMPLEQA_CASES } from '../../benchmarks/data.js';
import { benchmarkTools, convertBfclSchema, runBenchmark, scoreBfcl } from '../../runtime/benchmarks.js';
import type { BenchmarkExecution, BenchmarkTask } from '../../runtime/benchmarks.js';
import type { TokenUsage } from '../../shared/protocol.js';

const usage: TokenUsage = { input: 10, output: 2, cacheRead: 3, cacheWrite: 0, totalInput: 13, source: 'provider' };
function execution(text = '', extra: Partial<BenchmarkExecution> = {}): BenchmarkExecution {
  return { text, calls: [], elapsedMs: 1, estimatedInputTokens: 12, usage, ...extra };
}

describe('fixed public benchmark data and AST adapter', () => {
  it('keeps the unchanged fixed questions, immutable source revisions and official sample row IDs', () => {
    expect(BFCL_CASES).toHaveLength(20);
    expect(BFCL_CASES[0].prompt).toBe('Find the area of a triangle with a base of 10 units and height of 5 units.');
    expect(BFCL_CASES.slice(10).map((item) => item.id)).toEqual(Array.from({ length: 10 }, (_, i) => `multiple_${i}`));
    expect(BENCHMARK_SOURCE['bfcl-v4'].revision).toBe('6ea57973c7a6097fd7c5915698c54c17c5b1b6c8');
    expect(BENCHMARK_SOURCE.simpleqa.sourceFileHashes['simpleqa.csv']).toBe('feee3f7e7db3617e94e8fcf1977b756ec420ef8568f4e0fcbbe0e92e9d5fc032');
    expect(SIMPLEQA_CASES.map((item) => item.row)).toEqual([3155, 3445, 331, 2121, 4188, 3980, 3317, 2484, 3904, 2933, 1789, 4134, 1140, 2308, 1144, 776, 2052, 1203, 2540, 809]);
  });

  it.each(AST_ORACLE_FIXTURES)('matches the official Python AST oracle for $id / $kind', (fixture) => {
    const example = BFCL_CASES.find((item) => item.id === fixture.id)!;
    expect(scoreBfcl(example, fixture.calls).passed).toBe(fixture.passed);
  });

  it('accepts official string normalization while rejecting boolean values as integer arguments', () => {
    const country = BFCL_CASES.find((item) => item.id === 'multiple_2')!;
    expect(scoreBfcl(country, [{ name: 'country_info_capital', arguments: { country: 'B-R-A-Z-I-L' } }]).passed).toBe(true);
    const triangle = BFCL_CASES[0];
    expect(scoreBfcl(triangle, [{ name: 'calculate_triangle_area', arguments: { base: true, height: 5 } }]).passed).toBe(false);
    expect(scoreBfcl(triangle, [{ name: 'calculate_triangle_area', arguments: { base: '10', height: 5 } }]).passed).toBe(false);
  });

  it('rejects missing dictionary keys and duplicate calls rather than accepting a partial argument object', () => {
    const average = BFCL_CASES.find((item) => item.id === 'multiple_9')!;
    expect(scoreBfcl(average, [{ name: 'calculate_average', arguments: { gradeDict: { math: 90 } } }]).passed).toBe(false);
    const first = AST_ORACLE_FIXTURES[0].calls[0];
    expect(scoreBfcl(BFCL_CASES[0], [first, first]).passed).toBe(false);
  });

  it('converts nested tuple/dict schemas without mutating the official definitions, and never executes actual APIs', async () => {
    const raw = { type: 'dict', properties: { coordinates: { type: 'tuple', items: { type: 'float' } } }, required: ['coordinates'] };
    expect(convertBfclSchema(raw)).toMatchObject({ type: 'object', properties: { coordinates: { type: 'array', items: { type: 'number' } } } });
    expect(raw.properties.coordinates.type).toBe('tuple');
    const tools = benchmarkTools(BFCL_CASES[10].functions);
    expect(tools[0].name).toBe('triangle_properties_get');
    const result = await tools[0].execute('probe', { side1: 5, side2: 4, side3: 3 });
    expect(result.content).toEqual([{ type: 'text', text: '调用已记录。' }]);
    expect(JSON.stringify(result)).not.toContain('groundTruth');
  });
});

describe('benchmark orchestration and truthful results', () => {
  it('uses balanced BFCL subset coverage, one response and a fresh empty system prompt per task', async () => {
    const tasks: BenchmarkTask[] = [];
    const ids: string[] = [];
    const report = await runBenchmark({ suite: 'bfcl-v4', limit: 2, model: 'recorded-model', execute: async (task) => {
      tasks.push(task);
      const example = BFCL_CASES.find((item) => item.prompt === task.prompt)!;
      ids.push(example.id);
      return execution('', { calls: AST_ORACLE_FIXTURES.find((item) => item.id === example.id && item.kind === 'valid')!.calls });
    } });
    expect(ids).toEqual(['simple_python_0', 'multiple_0']);
    expect(tasks.every((task) => task.maxTurns === 1 && task.systemPrompt === '')).toBe(true);
    expect(report.metrics).toMatchObject({ correct: 2, graded: 2, unknown: 0, accuracy: 1, totalInputTokens: 26 });
    expect(report.source.selectedIds).toEqual(ids);
    expect(report.grader).toContain('非官方');
  });

  it('sends only original SimpleQA questions to the answer agent and keeps gold targets in a separate grading request', async () => {
    const tasks: BenchmarkTask[] = [];
    const progress: string[] = [];
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, execute: async (task) => {
      tasks.push(task);
      return execution(tasks.length === 1 ? 'my independent response' : 'A');
    }, onProgress: (item) => progress.push(item.phase) });
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({ prompt: SIMPLEQA_CASES[0].prompt, tools: [], maxTurns: 1, systemPrompt: '' });
    expect(tasks[0].prompt).not.toContain(SIMPLEQA_CASES[0].answer);
    expect(tasks[1].prompt).toContain(`Gold target: ${SIMPLEQA_CASES[0].answer}`);
    expect(tasks[1].prompt).toContain('Predicted answer: my independent response');
    expect(tasks[1].tools).toEqual([]);
    expect(progress).toEqual(['answering', 'grading', 'completed']);
    expect(report.cases[0]).toMatchObject({ grade: 'CORRECT', status: 'passed' });
    expect(report.metrics).toMatchObject({ accuracy: 1, totalInputTokens: 26, estimatedInputTokens: 24 });
  });

  it('reports missing usage as unknown while retaining cache-inclusive partial known input', async () => {
    let call = 0;
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, execute: async () => execution(++call === 1 ? 'answer' : 'B', { usage: call === 1 ? usage : null }) });
    expect(report.metrics).toMatchObject({ incorrect: 1, knownInputTokens: 13, totalInputTokens: null, inputUsageUnknown: true });
  });

  it('never turns malformed grader output into an incorrect answer or an abstention', async () => {
    let call = 0;
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, execute: async () => execution(++call === 1 ? 'answer' : 'This is probably A') });
    expect(report.metrics).toMatchObject({ correct: 0, incorrect: 0, notAttempted: 0, graded: 0, unknown: 1, accuracy: null });
    expect(report.cases[0].status).toBe('unknown');
  });

  it('distinguishes an official C abstention from a request failure and strips upstream exception details', async () => {
    let call = 0;
    const report = await runBenchmark({ suite: 'simpleqa', limit: 2, execute: async () => {
      call++;
      if (call === 3) throw new Error('private-api-key https://user:secret@gateway.example');
      return execution(call === 1 ? 'I do not know' : 'C');
    } });
    expect(report.metrics).toMatchObject({ notAttempted: 1, graded: 1, unknown: 1, accuracy: 0, accuracyGivenAttempted: null });
    expect(JSON.stringify(report)).not.toContain('private-api-key');
    expect(JSON.stringify(report)).not.toContain('gateway.example');
  });

  it('cancels before a task without invoking a model or inventing scores', async () => {
    const controller = new AbortController(); controller.abort();
    const report = await runBenchmark({ suite: 'bfcl-v4', limit: 2, signal: controller.signal, execute: async () => { throw new Error('must not run'); } });
    expect(report).toMatchObject({ status: 'cancelled', completed: 0, total: 2, cases: [] });
    expect(report.metrics).toMatchObject({ accuracy: null, unknown: 2, totalInputTokens: null });
  });

  it('does not grade or continue after cancellation during an answer', async () => {
    const controller = new AbortController();
    let calls = 0;
    const report = await runBenchmark({ suite: 'simpleqa', limit: 2, signal: controller.signal, execute: async () => {
      calls++; controller.abort(); return execution('partial answer');
    } });
    expect(calls).toBe(1);
    expect(report).toMatchObject({ status: 'cancelled', completed: 1 });
    expect(report.metrics).toMatchObject({ graded: 0, unknown: 2, accuracy: null });
  });

  it('keeps a cancelled grading request unknown even when a buffered A arrives after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const report = await runBenchmark({ suite: 'simpleqa', limit: 1, signal: controller.signal, execute: async () => {
      calls++;
      if (calls === 2) controller.abort();
      return execution(calls === 1 ? 'answer' : 'A');
    } });
    expect(report.status).toBe('cancelled');
    expect(report.metrics).toMatchObject({ graded: 0, unknown: 1, accuracy: null });
  });

  it('never publishes an accuracy for fixture callbacks even when all grading fixtures pass', async () => {
    let call = 0;
    const report = await runBenchmark({ suite: 'simpleqa', mode: 'fixture', limit: 1, execute: async () => execution(++call === 1 ? 'fixture answer' : 'A') });
    expect(report.mode).toBe('fixture');
    expect(report.metrics).toMatchObject({ correct: 1, graded: 1, accuracy: null, accuracyGivenAttempted: null });
  });

  it('rejects unsupported suite identifiers and excessive budgets before invoking a model', async () => {
    const execute = async () => execution();
    await expect(runBenchmark({ suite: 'bfcl-v4', limit: 21, execute })).rejects.toThrow('1 至 20');
    await expect(runBenchmark({ suite: 'invalid' as 'bfcl-v4', execute })).rejects.toThrow('未知评测集');
  });
});
