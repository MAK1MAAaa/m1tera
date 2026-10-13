import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentOptions, AgentTool, AfterToolCallContext, BeforeToolCallContext } from '@earendil-works/pi-agent-core';
import { DEFAULT_HARNESS_POLICY } from '../shared/protocol.js';
import type { HarnessPolicy } from '../shared/protocol.js';
import { buildContext, countEstimatedTokens, estimateContext } from './context.js';
import { ArtifactStore, createReadArtifactTool, offloadToolResult } from './artifacts.js';

export function validateHarnessPolicy(value: unknown): HarnessPolicy {
  if (value === undefined) return { ...DEFAULT_HARNESS_POLICY };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Harness 设置格式无效');
  const raw = value as Record<string, unknown>;
  const policy = { ...DEFAULT_HARNESS_POLICY, ...raw };
  if (typeof policy.offloadToolResults !== 'boolean') throw new Error('工具结果外置设置无效');
  for (const [key, min, max] of [['toolResultTokenLimit', 512, 32768], ['maxModelTurns', 1, 256], ['runTimeoutSeconds', 10, 3600]] as const) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < min || policy[key] > max) throw new Error(`${key} 超出允许范围 ${min}–${max}`);
  }
  return { offloadToolResults: policy.offloadToolResults, toolResultTokenLimit: policy.toolResultTokenLimit, maxModelTurns: policy.maxModelTurns, runTimeoutSeconds: policy.runTimeoutSeconds };
}

export interface HistoryProjection { messages: AgentMessage[]; artifactIds: Set<string>; offloadedResults: number; savedHistoryTokens: number }

/** The archive is unchanged. Only completed, older call arguments are projected into references. */
export async function projectHistory(messages: AgentMessage[], store: ArtifactStore, sessionId: string, policy: HarnessPolicy, redact: (text: string) => string = (text) => text): Promise<HistoryProjection> {
  const artifactIds = new Set<string>();
  let offloadedResults = 0;
  const latestUser = messages.findLastIndex((message) => message.role === 'user');
  const settled = new Set(messages.flatMap((message) => message.role === 'toolResult' ? [message.toolCallId] : []));
  const projected: AgentMessage[] = [];
  for (const [index, message] of messages.entries()) {
    if (message.role === 'toolResult') {
      const existing = (message.details as { artifact?: { id?: string } } | undefined)?.artifact?.id;
      if (existing) artifactIds.add(existing);
      if (policy.offloadToolResults && index < latestUser && !existing) {
        const result = await offloadToolResult(store, sessionId, message.toolName, { content: message.content, details: message.details }, policy.toolResultTokenLimit, { isError: message.isError, redact });
        if (result.offloaded && result.artifact) {
          artifactIds.add(result.artifact.id); offloadedResults++;
          projected.push({ ...message, content: result.result.content, details: JSON.parse(JSON.stringify(result.result.details ?? {})) });
          continue;
        }
      }
    } else if (policy.offloadToolResults && message.role === 'assistant' && index < latestUser) {
      const content = [] as typeof message.content;
      for (const block of message.content) {
        if (block.type !== 'toolCall' || !settled.has(block.id) || countEstimatedTokens(block.arguments) <= policy.toolResultTokenLimit) { content.push(block); continue; }
        try {
          const artifact = await store.put(sessionId, redact(JSON.stringify(block.arguments)));
          artifactIds.add(artifact.id); offloadedResults++;
          // Preserve schema-compatible scalar fields and the original call/result pairing.
          const args = { ...block.arguments };
          for (const [key, value] of Object.entries(args)) if (typeof value === 'string' && countEstimatedTokens(value) > policy.toolResultTokenLimit / 2) args[key] = `[已完成调用的原始 ${key} 已归档：artifact ${artifact.id}；需要时使用 read_artifact。]`;
          content.push({ ...block, arguments: args });
        } catch { content.push(block); }
      }
      projected.push({ ...message, content }); continue;
    }
    projected.push(message);
  }
  const before = countEstimatedTokens(messages.filter((message) => message.role !== 'system'));
  const after = countEstimatedTokens(projected.filter((message) => message.role !== 'system'));
  return { messages: projected, artifactIds, offloadedResults, savedHistoryTokens: Math.max(0, before - after) };
}

export interface HarnessMetrics {
  modelTurns: number;
  estimatedInputTokens: number;
  offloadedResults: number;
  savedHistoryTokens: number;
  limitReason?: string;
}
interface HarnessOptions {
  sessionId: string;
  systemPrompt: string;
  tools: AgentTool[];
  artifacts: ArtifactStore;
  policy: HarnessPolicy;
  redact?: (text: string) => string;
  onTurn?: (turn: number) => Promise<void>;
  onIntent?: (context: BeforeToolCallContext) => Promise<void>;
  onResult?: (context: AfterToolCallContext) => Promise<void>;
}

/** Chat and benchmark share the same context pipeline and bounded Pi loop. */
export function createHarnessAgent(options: AgentOptions, harness: HarnessOptions) {
  const metrics: HarnessMetrics = { modelTurns: 0, estimatedInputTokens: 0, offloadedResults: 0, savedHistoryTokens: 0 };
  const allowedIds = new Set<string>();
  let projection: HistoryProjection | undefined;
  let activeTools = harness.tools;
  const failStorage = (error: unknown) => {
    metrics.limitReason = '检查点保存失败，已停止后续操作；请检查存储状态后再继续。';
    agent?.abort();
    throw error;
  };
  const agent = new Agent({
    ...options,
    prepareRequest: async ({ context }) => {
      if (metrics.limitReason) throw new Error(metrics.limitReason);
      if (metrics.modelTurns >= harness.policy.maxModelTurns) throw new Error('已达到本次运行的模型轮次上限');
      metrics.modelTurns++;
      try { await harness.onTurn?.(metrics.modelTurns); } catch (error) { failStorage(error); }
      projection = await projectHistory(context.messages, harness.artifacts, harness.sessionId, harness.policy, harness.redact);
      for (const id of projection.artifactIds) allowedIds.add(id);
      // Retrieval is disclosed only when references exist and the session has tool capabilities.
      activeTools = allowedIds.size && harness.tools.length ? [...harness.tools, createReadArtifactTool(harness.artifacts, harness.sessionId, allowedIds)] : harness.tools;
      metrics.offloadedResults += projection.offloadedResults;
      metrics.savedHistoryTokens = projection.savedHistoryTokens;
      const estimated = estimateContext(harness.systemPrompt, projection.messages, activeTools);
      metrics.estimatedInputTokens += estimated.total;
      return { context: { messages: buildContext(harness.systemPrompt, context.messages, activeTools).messages, tools: activeTools } };
    },
    transformContext: async (messages) => buildContext(harness.systemPrompt, projection?.messages ?? messages, activeTools).messages,
    beforeToolCall: async (context, signal) => {
      if (signal?.aborted || metrics.limitReason) return { block: true, terminate: true, reason: metrics.limitReason ?? '已停止' };
      try { await harness.onIntent?.(context); } catch (error) { failStorage(error); }
      return undefined;
    },
    afterToolCall: async (context) => {
      const offloaded = harness.policy.offloadToolResults
        ? await offloadToolResult(harness.artifacts, harness.sessionId, context.toolCall.name, context.result, harness.policy.toolResultTokenLimit, { isError: context.isError, redact: harness.redact })
        : { result: context.result, offloaded: false };
      if ('artifact' in offloaded && offloaded.artifact) { allowedIds.add(offloaded.artifact.id); metrics.offloadedResults++; }
      const resultContext = { ...context, result: offloaded.result };
      try { await harness.onResult?.(resultContext); } catch (error) { failStorage(error); }
      return { content: offloaded.result.content, details: offloaded.result.details, ...(context.result.structuredContent !== undefined && !offloaded.offloaded ? { structuredContent: context.result.structuredContent } : {}) };
    },
    finishTurn: async (context) => {
      if (metrics.limitReason) return { action: 'end' };
      const hasCalls = context.message.content.some((block) => block.type === 'toolCall');
      if (hasCalls && metrics.modelTurns >= harness.policy.maxModelTurns) {
        metrics.limitReason = `已达到 ${harness.policy.maxModelTurns} 轮模型请求上限。可检查结果后继续任务。`;
        return { action: 'end' };
      }
      return undefined;
    },
  });
  return { agent, metrics };
}
