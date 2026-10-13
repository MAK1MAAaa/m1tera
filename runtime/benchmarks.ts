import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { HarnessPolicy, TokenUsage } from '../shared/protocol.js';
import type { BenchmarkCall, BenchmarkCase, BenchmarkReport } from '../shared/benchmark-types.js';
export type { BenchmarkCall, BenchmarkCase, BenchmarkReport } from '../shared/benchmark-types.js';
import { BENCHMARK_SOURCE, BFCL_CASES, SIMPLEQA_CASES, SIMPLEQA_GRADER_TEMPLATE } from '../benchmarks/data.js';
import type { BfclExample, BfclFunction } from '../benchmarks/data.js';
import { BENCHMARK_SUITES, benchmarkSuite } from '../shared/benchmark-catalog.js';
import type { BenchmarkProfile, BenchmarkSuiteId } from '../shared/benchmark-catalog.js';
import { runFilesystemBenchmark } from './filesystem-benchmarks.js';

export { BENCHMARK_SUITES };
export type { BenchmarkSuiteId, BenchmarkProfile };

export interface BenchmarkTask {
  prompt: string;
  tools: AgentTool[];
  maxTurns: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  tokenBudget?: number;
}
export interface BenchmarkExecution {
  text: string;
  calls: BenchmarkCall[];
  elapsedMs: number;
  estimatedInputTokens: number;
  usage: TokenUsage | null;
  knownUsage?: TokenUsage | null;
  observedTools?: string[];
  requestCount?: number;
  toolCallCount?: number;
  terminationReason?: 'turn-limit' | 'timeout' | 'token-budget';
}
export interface BenchmarkProgress { completed: number; total: number; phase: 'answering' | 'grading' | 'completed'; taskId?: string }
/** BFCL's OpenAI adapter converts Python-flavoured schema types and dot-separated names. */
export function convertBfclSchema(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value);
  const types: Record<string, string> = { dict: 'object', tuple: 'array', float: 'number', any: 'string' };
  if (typeof copy.type === 'string') {
    if (copy.type === 'float') {
      copy.format = 'float';
      if (typeof copy.description === 'string') copy.description += ' This is a float type value.';
    }
    copy.type = types[copy.type] ?? copy.type;
  }
  if (copy.properties && typeof copy.properties === 'object' && !Array.isArray(copy.properties)) {
    copy.properties = Object.fromEntries(Object.entries(copy.properties).map(([key, schema]) => [key, convertBfclSchema(schema as Record<string, unknown>)]));
  }
  if (copy.items && typeof copy.items === 'object' && !Array.isArray(copy.items)) copy.items = convertBfclSchema(copy.items as Record<string, unknown>);
  return copy;
}

export function benchmarkTools(functions: readonly BfclFunction[]): AgentTool[] {
  return functions.map((definition) => ({
    name: definition.name.replaceAll('.', '_'),
    label: definition.name,
    description: definition.description,
    parameters: convertBfclSchema(definition.parameters) as AgentTool['parameters'],
    // Benchmark API functions are schema probes. They never touch files, network or the host.
    execute: async () => ({ content: [{ type: 'text' as const, text: '调用已记录。' }], details: {} }),
  }));
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function sameValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  if (object(left) && object(right)) return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && sameValue(value, right[key]));
  return left === right;
}
function standardize(value: string): string { return value.replace(/[ ,./\-_*^]/g, '').toLowerCase().replaceAll("'", '"'); }
function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (object(value)) return 'dict';
  return typeof value;
}
function schemaType(type: unknown): string {
  if (type === 'integer' || type === 'float') return 'number';
  if (type === 'tuple') return 'array';
  if (type === 'any') return 'string';
  return String(type);
}
function matchesType(value: unknown, schema: Record<string, unknown>, possible: unknown[]): boolean {
  const expected = schemaType(schema.type);
  const first = possible.find((answer) => answer !== '');
  const actual = valueType(value);
  const variable = first !== undefined && valueType(first) !== expected;
  if (actual !== expected) return variable && actual === valueType(first);
  if (schema.type === 'integer' && !Number.isInteger(value)) return false;
  if ((schema.type === 'array' || schema.type === 'tuple') && Array.isArray(value) && object(schema.items)) {
    return possible.some((answer) => !Array.isArray(answer) || value.every((item) => matchesType(item, schema.items as Record<string, unknown>, answer)));
  }
  return true;
}
function matchesDictionary(value: Record<string, unknown>, possible: unknown[]): boolean {
  return possible.some((answer) => {
    if (!object(answer)) return false;
    for (const [key, item] of Object.entries(value)) {
      const allowed = answer[key];
      if (!Array.isArray(allowed) || !allowed.some((candidate) => typeof item === 'string' && typeof candidate === 'string' ? standardize(item) === standardize(candidate) : sameValue(item, candidate))) return false;
    }
    return Object.entries(answer).every(([key, allowed]) => Object.hasOwn(value, key) || Array.isArray(allowed) && allowed.includes(''));
  });
}
function matchesValue(value: unknown, schema: Record<string, unknown>, possible: unknown[]): boolean {
  if (!matchesType(value, schema, possible)) return false;
  const expected = schemaType(schema.type);
  const first = possible.find((answer) => answer !== '');
  const variable = first !== undefined && valueType(first) !== expected;
  if (!variable && typeof value === 'string') return possible.some((answer) => typeof answer === 'string' && standardize(value) === standardize(answer));
  if (!variable && object(value)) return matchesDictionary(value, possible);
  if (!variable && Array.isArray(value)) {
    if (object(schema.items) && schema.items.type === 'dict') {
      return possible.some((answer) => Array.isArray(answer) && answer.length === value.length && value.every((item, index) => object(item) && matchesDictionary(item, [answer[index]])));
    }
    const normalize = (list: unknown[]) => list.map((item) => typeof item === 'string' ? standardize(item) : item);
    return possible.some((answer) => Array.isArray(answer) && sameValue(normalize(value), normalize(answer)));
  }
  return possible.some((answer) => sameValue(value, answer));
}

/** Local TypeScript port of the official single-call Python AST checker. Not an official BFCL score. */
export function scoreBfcl(example: BfclExample, calls: readonly BenchmarkCall[]): { passed: boolean; errorType?: string } {
  if (calls.length !== 1) return { passed: false, errorType: 'wrong_count' };
  const truth = example.groundTruth[0];
  const expectedName = Object.keys(truth)[0];
  const call = calls[0];
  if (call.name !== expectedName.replaceAll('.', '_')) return { passed: false, errorType: 'wrong_func_name' };
  const definition = example.functions.find((fn) => fn.name === expectedName)!;
  const allowed = truth[expectedName];
  if (!object(call.arguments)) return { passed: false, errorType: 'invalid_arguments' };
  if (definition.parameters.required.some((key) => !Object.hasOwn(call.arguments, key))) return { passed: false, errorType: 'missing_required' };
  for (const [key, value] of Object.entries(call.arguments)) {
    const schema = definition.parameters.properties[key];
    if (!schema || !Object.hasOwn(allowed, key)) return { passed: false, errorType: 'unexpected_param' };
    if (!matchesValue(value, schema, allowed[key])) return { passed: false, errorType: 'type_or_value' };
  }
  if (Object.entries(allowed).some(([key, values]) => !Object.hasOwn(call.arguments, key) && !values.includes(''))) return { passed: false, errorType: 'missing_optional' };
  return { passed: true };
}

function verifiedUsage(usage: TokenUsage | null): TokenUsage | null {
  if (!usage) return null;
  const values = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalInput];
  return values.every((value) => Number.isFinite(value) && value >= 0) && usage.totalInput > 0 && usage.totalInput === usage.input + usage.cacheRead + usage.cacheWrite ? usage : null;
}
function estimate(value: number): number | null { return Number.isFinite(value) && value >= 0 ? value : null; }
function gradingPrompt(question: string, target: string, predictedAnswer: string): string {
  const fields: Record<string, string> = { question, target, predicted_answer: predictedAnswer };
  return SIMPLEQA_GRADER_TEMPLATE.replace(/\{(question|target|predicted_answer)\}/g, (_match, field: string) => fields[field]);
}

export async function runBenchmark(options: {
  suite: BenchmarkSuiteId;
  limit?: number;
  execute: (task: BenchmarkTask) => Promise<BenchmarkExecution>;
  signal?: AbortSignal;
  onProgress?: (progress: BenchmarkProgress) => void;
  mode?: 'live' | 'fixture';
  model?: string;
  providerId?: string;
  cacheDir?: string;
  profile?: BenchmarkProfile;
  maxTurns?: number;
  runTimeoutSeconds?: number;
  reasoningEffort?: string;
  harness?: HarnessPolicy;
}): Promise<BenchmarkReport> {
  const descriptor = benchmarkSuite(options.suite);
  if (!descriptor) throw new Error('未知评测集。');
  const limit = options.limit ?? descriptor.defaultLimit;
  if (!Number.isInteger(limit) || limit < 1 || limit > descriptor.total) throw new Error(`评测题数必须为 1 至 ${descriptor.total} 的整数。`);
  if (options.profile !== undefined && !['agent', 'direct'].includes(options.profile)) throw new Error('未知评测方式。');
  if (options.profile === 'direct' && !options.suite.startsWith('longharness-')) throw new Error('完整上下文单次请求仅支持 LongHarness。');
  if (options.suite !== 'bfcl-v4' && options.suite !== 'simpleqa') return runFilesystemBenchmark({ ...options, limit });
  // Keep equal category coverage in small BFCL runs instead of selecting only the simple prefix.
  const bfclCases = [...BFCL_CASES.slice(0, Math.ceil(limit / 2)), ...BFCL_CASES.slice(10, 10 + Math.floor(limit / 2))];
  const examples = options.suite === 'bfcl-v4' ? bfclCases : SIMPLEQA_CASES.slice(0, limit);
  const started = performance.now();
  const report: BenchmarkReport = {
    mode: options.mode ?? 'live', status: 'completed', suite: options.suite, name: descriptor.name,
    model: options.model ?? '未记录', ...(options.providerId ? { providerId: options.providerId } : {}), measuredAt: new Date().toISOString(),
    source: { ...BENCHMARK_SOURCE[options.suite], selectedIds: examples.map((example) => example.id) },
    grader: options.suite === 'bfcl-v4'
      ? '固定 20 题范围的 TypeScript AST 规则移植；保留官方允许值、可选参数和字符串归一。JavaScript JSON 数值不保留 Python int/float 字面量差别；非官方 BFCL leaderboard。'
      : '原版 OpenAI GRADER_TEMPLATE，答案生成后另一次独立请求；A/B/C。使用同一模型评分，有自评偏差；非官方完整 SimpleQA score。评分响应不合法记未知，绝不默认弃答。',
    settings: { browsing: false, maxAnswerTurns: 1, freshContextPerTask: true, sameModelForGrader: options.suite === 'simpleqa', profile: 'agent', reasoningEffort: options.reasoningEffort ?? '未记录', runTimeoutSeconds: Math.min(options.runTimeoutSeconds ?? 300, 120), ...(options.harness ? { harness: options.harness } : {}) },
    total: examples.length, completed: 0, cases: [],
    metrics: { correct: 0, incorrect: 0, notAttempted: 0, unknown: examples.length, graded: 0, accuracy: null, accuracyGivenAttempted: null,
      denominator: 'graded cases', knownInputTokens: 0, totalInputTokens: null, inputUsageUnknown: true, estimatedInputTokens: null, elapsedMs: 0 },
  };
  for (const example of examples) {
    if (options.signal?.aborted) { report.status = 'cancelled'; break; }
    options.onProgress?.({ completed: report.completed, total: report.total, phase: 'answering', taskId: example.id });
    const item: BenchmarkCase = { id: example.id, status: 'unknown', elapsedMs: null, estimatedInputTokens: null, usage: null };
    report.cases.push(item);
    try {
      const answer = await options.execute({ prompt: example.prompt, tools: options.suite === 'bfcl-v4' ? benchmarkTools((example as BfclExample).functions) : [], maxTurns: 1, systemPrompt: '', signal: options.signal });
      item.answer = answer.text;
      item.calls = answer.calls;
      item.elapsedMs = estimate(answer.elapsedMs);
      item.estimatedInputTokens = estimate(answer.estimatedInputTokens);
      item.usage = verifiedUsage(answer.usage);
      item.knownUsage = verifiedUsage(answer.knownUsage ?? answer.usage);
      item.observedTools = answer.observedTools;
      item.requestCount = answer.requestCount ?? 1;
      item.toolCallCount = answer.toolCallCount ?? answer.calls.length;
      item.terminationReason = answer.terminationReason;
      if (options.signal?.aborted) throw new Error('Cancelled');
      if (answer.terminationReason) { item.status = 'failed'; item.error = `本题达到运行边界：${answer.terminationReason}；未作为成功作答评分。`; }
      else if (options.suite === 'bfcl-v4') {
        const score = scoreBfcl(example as BfclExample, answer.calls);
        item.status = score.passed ? 'passed' : 'failed';
        if (score.errorType) item.error = `工具调用不符合原题 AST 规则：${score.errorType}。`;
      } else {
        const question = example as typeof SIMPLEQA_CASES[number];
        options.onProgress?.({ completed: report.completed, total: report.total, phase: 'grading', taskId: example.id });
        const graded = await options.execute({ prompt: gradingPrompt(question.prompt, question.answer, answer.text), tools: [], maxTurns: 1, systemPrompt: '', signal: options.signal });
        item.graderUsage = verifiedUsage(graded.usage);
        item.graderKnownUsage = verifiedUsage(graded.knownUsage ?? graded.usage);
        item.graderEstimatedInputTokens = estimate(graded.estimatedInputTokens);
        item.requestCount += graded.requestCount ?? 1;
        if (item.elapsedMs !== null && estimate(graded.elapsedMs) !== null) item.elapsedMs += graded.elapsedMs;
        if (options.signal?.aborted) throw new Error('Cancelled');
        const letter = graded.text.trim();
        if (graded.terminationReason) item.error = `评分达到运行边界：${graded.terminationReason}；成绩未知。`;
        else if (graded.calls.length > 0 || !/^[ABC]$/.test(letter)) item.error = '评分响应不符合 A/B/C 格式；成绩未知。';
        else {
          item.grade = ({ A: 'CORRECT', B: 'INCORRECT', C: 'NOT_ATTEMPTED' } as const)[letter as 'A' | 'B' | 'C'];
          item.status = letter === 'A' ? 'passed' : 'failed';
        }
      }
    } catch {
      item.status = 'unknown';
      delete item.requestCount;
      delete item.toolCallCount;
      item.error = options.signal?.aborted ? '评测已取消；此题成绩未知。' : '模型或评分请求失败；此题成绩未知。';
    }
    report.completed++;
    options.onProgress?.({ completed: report.completed, total: report.total, phase: 'completed', taskId: example.id });
    if (options.signal?.aborted) { report.status = 'cancelled'; break; }
  }
  const correct = report.cases.filter((item) => item.status === 'passed').length;
  const notAttempted = report.cases.filter((item) => item.grade === 'NOT_ATTEMPTED').length;
  const incorrect = report.cases.filter((item) => item.status === 'failed' && item.grade !== 'NOT_ATTEMPTED').length;
  const graded = correct + incorrect + notAttempted;
  const executions = report.cases.flatMap((item) => options.suite === 'simpleqa' && !item.terminationReason ? [item.usage, item.graderUsage ?? null] : [item.usage]);
  const knownExecutions = report.cases.flatMap((item) => options.suite === 'simpleqa' && !item.terminationReason ? [item.knownUsage ?? item.usage, item.graderKnownUsage ?? item.graderUsage ?? null] : [item.knownUsage ?? item.usage]);
  const allUsage = report.completed === report.total && executions.every((usage) => usage !== null);
  const knownInputTokens = knownExecutions.reduce((sum, usage) => sum + (usage?.totalInput ?? 0), 0);
  const estimates = report.cases.flatMap((item) => options.suite === 'simpleqa' && !item.terminationReason ? [item.estimatedInputTokens, item.graderEstimatedInputTokens ?? null] : [item.estimatedInputTokens]);
  report.settings.tools = [...new Set(report.cases.flatMap((item) => item.observedTools ?? []))];
  report.metrics = {
    correct, incorrect, notAttempted, unknown: report.total - graded, graded,
    accuracy: report.mode === 'live' && graded > 0 ? correct / graded : null,
    accuracyGivenAttempted: report.mode === 'live' && correct + incorrect > 0 ? correct / (correct + incorrect) : null,
    denominator: 'graded cases', knownInputTokens, totalInputTokens: allUsage ? knownInputTokens : null, inputUsageUnknown: !allUsage,
    estimatedInputTokens: report.completed === report.total && estimates.every((value) => value !== null) ? estimates.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    totalOutputTokens: allUsage ? executions.reduce((sum, usage) => sum + (usage?.output ?? 0), 0) : null,
    ...(report.cases.every((item) => item.requestCount !== undefined) ? { requestCount: report.cases.reduce((sum, item) => sum + (item.requestCount ?? 0), 0) } : {}),
    ...(report.cases.every((item) => item.toolCallCount !== undefined) ? { toolCallCount: report.cases.reduce((sum, item) => sum + (item.toolCallCount ?? 0), 0) } : {}),
    elapsedMs: Math.round(performance.now() - started),
  };
  return report;
}
