import os from 'node:os';
import path from 'node:path';
import { loadLongHarnessCases, scoreLongHarness } from '../benchmarks/longharness.js';
import type { LongHarnessSuiteId } from '../benchmarks/longharness.js';
import { loadLettaContextCases, makeLettaJudgePrompt, parseLettaReward } from '../benchmarks/letta-context.js';
import { benchmarkSuite } from '../shared/benchmark-catalog.js';
import type { BenchmarkProfile, BenchmarkSuiteId } from '../shared/benchmark-catalog.js';
import type { BenchmarkCase, BenchmarkExecution, BenchmarkProgress, BenchmarkReport, BenchmarkTask } from './benchmarks.js';
import type { HarnessPolicy, TokenUsage } from '../shared/protocol.js';
import { createCorpusTools } from './benchmark-corpus.js';

interface Options {
  suite: BenchmarkSuiteId;
  limit: number;
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
}
const validUsage = (usage: TokenUsage | null) => usage && [usage.input, usage.output, usage.cacheRead, usage.cacheWrite, usage.totalInput].every((n) => Number.isFinite(n) && n >= 0) && usage.totalInput > 0 && usage.totalInput === usage.input + usage.cacheRead + usage.cacheWrite ? usage : null;
const estimate = (value: number) => Number.isFinite(value) && value >= 0 ? value : null;

export async function runFilesystemBenchmark(options: Options): Promise<BenchmarkReport> {
  const started = performance.now();
  const isLetta = options.suite === 'letta-context';
  const profile = options.profile ?? 'agent';
  const maxTurns = profile === 'direct' ? 1 : Math.min(options.maxTurns ?? 24, 24);
  const tokenBudget = 300_000;
  const cache = { cacheDir: options.cacheDir ?? path.join(os.tmpdir(), 'm1tera-benchmark-corpus'), signal: options.signal };
  const dataset = isLetta
    ? await loadLettaContextCases(options.limit, cache)
    : await loadLongHarnessCases(options.suite as LongHarnessSuiteId, options.limit, cache);
  const descriptor = benchmarkSuite(options.suite)!;
  const tools = profile === 'direct' ? [] : ['list_directory', 'read_file', 'search_file'];
  const report: BenchmarkReport = {
    mode: options.mode ?? 'live', status: 'completed', suite: options.suite, name: descriptor.name, model: options.model ?? '未记录',
    ...(options.providerId ? { providerId: options.providerId } : {}), measuredAt: new Date().toISOString(), source: dataset.source,
    grader: isLetta
      ? 'Letta filesystem_cloud 官方 rubric，另次同模型 JSON reward 评分；0/0.5/1，存在自评偏差。不是 Filesystem v2 或官方全榜成绩。'
      : '依据固定 LongHarness score_one 独立实现的精确集合/JSON评分；程序追踪同时要求结果和证据。只读检索或单次完整上下文轨，预算及工具不同于论文全量实验。',
    settings: { browsing: false, maxAnswerTurns: maxTurns, freshContextPerTask: true, sameModelForGrader: isLetta, profile, tools, baseTools: tools, reasoningEffort: options.reasoningEffort ?? '未记录', runTimeoutSeconds: Math.min(options.runTimeoutSeconds ?? 300, maxTurns > 1 ? 600 : 120), tokenBudget, tokenBudgetScope: 'answer', budgetAccounting: 'completed-response', ...(options.harness ? { harness: options.harness } : {}) },
    total: dataset.cases.length, completed: 0, cases: [],
    metrics: { correct: 0, incorrect: 0, notAttempted: 0, unknown: dataset.cases.length, graded: 0, accuracy: null, accuracyGivenAttempted: null, denominator: 'graded cases', knownInputTokens: 0, totalInputTokens: null, inputUsageUnknown: true, estimatedInputTokens: null, elapsedMs: 0 },
  };
  for (const example of dataset.cases) {
    if (options.signal?.aborted) { report.status = 'cancelled'; break; }
    const item: BenchmarkCase = { id: example.id, status: 'unknown', elapsedMs: null, estimatedInputTokens: null, usage: null };
    report.cases.push(item);
    options.onProgress?.({ completed: report.completed, total: report.total, phase: 'answering', taskId: example.id });
    try {
      // Only documents are visible to the answer agent. Gold and audit metadata stay in this closure.
      const prompt = profile === 'direct'
        ? `${example.prompt}\n\n${example.files.map((file) => `文件：${file.path}\n${file.text}`).join('\n\n')}`
        : `${example.prompt}\n\n题目材料已放在本题虚拟文件目录。使用 list_directory、read_file、search_file 查看原文；请在最后一条答复给出最终答案。`;
      const answer = await options.execute({ prompt, tools: profile === 'direct' ? [] : createCorpusTools(example.files), maxTurns, systemPrompt: '', tokenBudget, signal: options.signal });
      item.answer = answer.text;
      item.calls = answer.calls;
      item.elapsedMs = estimate(answer.elapsedMs);
      item.estimatedInputTokens = estimate(answer.estimatedInputTokens);
      item.usage = validUsage(answer.usage);
      item.knownUsage = validUsage(answer.knownUsage ?? answer.usage);
      item.observedTools = answer.observedTools;
      item.requestCount = answer.requestCount ?? 1;
      item.toolCallCount = answer.toolCallCount ?? answer.calls.length;
      item.terminationReason = answer.terminationReason;
      if (options.signal?.aborted) throw new Error('Cancelled');
      if (answer.terminationReason) {
        item.status = 'failed';
        item.error = `本题达到运行边界：${answer.terminationReason}；未作为成功作答评分。`;
        if (isLetta) item.reward = 0;
      } else if (isLetta) {
        options.onProgress?.({ completed: report.completed, total: report.total, phase: 'grading', taskId: example.id });
        const graded = await options.execute({ prompt: makeLettaJudgePrompt(example.prompt, answer.text, example.gold), tools: [], maxTurns: 1, systemPrompt: '', signal: options.signal });
        item.graderUsage = validUsage(graded.usage);
        item.graderKnownUsage = validUsage(graded.knownUsage ?? graded.usage);
        item.graderEstimatedInputTokens = estimate(graded.estimatedInputTokens);
        item.requestCount = (item.requestCount ?? 0) + (graded.requestCount ?? 1);
        if (item.elapsedMs !== null && estimate(graded.elapsedMs) !== null) item.elapsedMs += graded.elapsedMs;
        if (options.signal?.aborted) throw new Error('Cancelled');
        const reward = graded.terminationReason || graded.calls.length ? null : parseLettaReward(graded.text);
        if (reward === null) item.error = graded.terminationReason ? `评分达到运行边界：${graded.terminationReason}；成绩未知。` : '评分响应不符合有限 JSON reward 格式；成绩未知。';
        else { item.reward = reward; item.status = reward === 1 ? 'passed' : 'failed'; }
      } else {
        const score = scoreLongHarness('task' in example && typeof example.task === 'string' ? example.task : '', answer.text, example.gold);
        item.status = score.passed ? 'passed' : 'failed';
        item.answerExact = score.answerExact;
        item.evidenceExact = score.evidenceExact;
        if (!score.passed) item.error = score.error ?? '最终答案不满足固定原题的精确规则。';
      }
    } catch {
      item.status = 'unknown';
      delete item.reward;
      delete item.requestCount;
      delete item.toolCallCount;
      item.error = options.signal?.aborted ? '评测已取消；此题成绩未知。' : '模型或评分请求失败；此题成绩未知。';
    }
    report.completed++;
    options.onProgress?.({ completed: report.completed, total: report.total, phase: 'completed', taskId: example.id });
    if (options.signal?.aborted) { report.status = 'cancelled'; break; }
  }
  const correct = report.cases.filter((item) => item.status === 'passed').length;
  const incorrect = report.cases.filter((item) => item.status === 'failed').length;
  const graded = correct + incorrect;
  const executions = report.cases.flatMap((item) => isLetta && !item.terminationReason ? [item.usage, item.graderUsage ?? null] : [item.usage]);
  const known = executions.filter((usage): usage is TokenUsage => usage !== null);
  const knownExecutions = report.cases.flatMap((item) => isLetta && !item.terminationReason ? [item.knownUsage ?? item.usage, item.graderKnownUsage ?? item.graderUsage ?? null] : [item.knownUsage ?? item.usage]);
  const allUsage = report.completed === report.total && known.length === executions.length;
  const estimates = report.cases.flatMap((item) => isLetta && !item.terminationReason ? [item.estimatedInputTokens, item.graderEstimatedInputTokens ?? null] : [item.estimatedInputTokens]);
  const allEstimates = report.completed === report.total && estimates.every((value) => value !== null);
  report.settings.tools = [...new Set([...tools, ...report.cases.flatMap((item) => item.observedTools ?? [])])];
  report.metrics = {
    correct, incorrect, notAttempted: 0, unknown: report.total - graded, graded,
    accuracy: report.mode === 'live' && graded ? correct / graded : null,
    accuracyGivenAttempted: report.mode === 'live' && graded ? correct / graded : null,
    ...(isLetta ? { meanReward: report.mode === 'live' && graded ? report.cases.reduce((sum, item) => sum + (item.reward ?? 0), 0) / graded : null } : {}),
    denominator: 'graded cases', knownInputTokens: knownExecutions.reduce((sum, usage) => sum + (usage?.totalInput ?? 0), 0),
    totalInputTokens: allUsage ? known.reduce((sum, usage) => sum + usage.totalInput, 0) : null, inputUsageUnknown: !allUsage,
    totalOutputTokens: allUsage ? known.reduce((sum, usage) => sum + usage.output, 0) : null,
    estimatedInputTokens: allEstimates ? estimates.reduce<number>((sum, value) => sum + (value ?? 0), 0) : null,
    ...(report.cases.every((item) => item.requestCount !== undefined) ? { requestCount: report.cases.reduce((sum, item) => sum + (item.requestCount ?? 0), 0) } : {}),
    ...(report.cases.every((item) => item.toolCallCount !== undefined) ? { toolCallCount: report.cases.reduce((sum, item) => sum + (item.toolCallCount ?? 0), 0) } : {}),
    elapsedMs: Math.round(performance.now() - started),
  };
  return report;
}
