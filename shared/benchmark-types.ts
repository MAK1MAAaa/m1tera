import type { HarnessPolicy, TokenUsage } from './protocol.js';
import type { BenchmarkProfile, BenchmarkSuiteId } from './benchmark-catalog.js';

export interface BenchmarkCall { name: string; arguments: Record<string, unknown> }

export interface BenchmarkCase {
  id: string;
  status: 'passed' | 'failed' | 'unknown';
  grade?: 'CORRECT' | 'INCORRECT' | 'NOT_ATTEMPTED';
  answer?: string;
  calls?: BenchmarkCall[];
  error?: string;
  elapsedMs: number | null;
  estimatedInputTokens: number | null;
  usage: TokenUsage | null;
  knownUsage?: TokenUsage | null;
  graderKnownUsage?: TokenUsage | null;
  observedTools?: string[];
  graderUsage?: TokenUsage | null;
  graderEstimatedInputTokens?: number | null;
  reward?: number;
  answerExact?: boolean;
  evidenceExact?: boolean;
  requestCount?: number;
  toolCallCount?: number;
  terminationReason?: 'turn-limit' | 'timeout' | 'token-budget';
}
export interface BenchmarkReport {
  mode: 'live' | 'fixture';
  status: 'completed' | 'cancelled';
  suite: BenchmarkSuiteId;
  name: string;
  model: string;
  providerId?: string;
  measuredAt: string;
  source: { revision: string; upstream: string; license: string; sourceFileHashes: Record<string, string>; selectedIds: string[]; sampling: string; subsetSha256: string; adapterProtocol?: string; promptSha256?: Record<string, string> };
  grader: string;
  settings: { browsing: boolean; maxAnswerTurns: number; freshContextPerTask: true; sameModelForGrader: boolean; profile?: BenchmarkProfile; tools?: string[]; baseTools?: string[]; reasoningEffort?: string; runTimeoutSeconds?: number; tokenBudget?: number; tokenBudgetScope?: 'answer'; budgetAccounting?: 'completed-response'; harness?: HarnessPolicy };
  total: number;
  completed: number;
  cases: BenchmarkCase[];
  metrics: {
    correct: number;
    incorrect: number;
    notAttempted: number;
    unknown: number;
    graded: number;
    accuracy: number | null;
    accuracyGivenAttempted: number | null;
    denominator: 'graded cases';
    knownInputTokens: number;
    totalInputTokens: number | null;
    inputUsageUnknown: boolean;
    estimatedInputTokens: number | null;
    elapsedMs: number;
    meanReward?: number | null;
    totalOutputTokens?: number | null;
    requestCount?: number;
    toolCallCount?: number;
  };
}

