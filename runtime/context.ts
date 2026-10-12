import { getEncoding } from 'js-tiktoken';
import { getSystemMessageText, normalizeContext, toToolDeclaration } from '@earendil-works/pi-ai';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import type { ContextEstimate, TokenUsage } from '../shared/protocol.js';
import type { Model, TranscriptContext, Usage } from '@earendil-works/pi-ai';
import type { Settings } from '../shared/protocol.js';

const tokenizer = getEncoding('o200k_base');
const METHOD = 'o200k_base 分项估算，包含保守消息封装开销；实际模型 tokenizer 和服务商封装可能不同。实际 usage 仅首轮，含缓存输入。';

export function countEstimatedTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return tokenizer.encode(text).length;
}

export function buildModel(settings: Pick<Settings, 'baseUrl' | 'model' | 'apiFormat'>): Model<'openai-completions' | 'openai-responses'> {
  const common = {
    id: settings.model, name: settings.model, provider: 'm1tera-openai-compatible',
    baseUrl: settings.baseUrl, reasoning: false, input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    // These are response/provider scheduling metadata, not a context budget. No automatic truncation occurs.
    contextWindow: 128_000, maxTokens: 4096,
  };
  return settings.apiFormat === 'responses'
    ? { ...common, input: ['text'], api: 'openai-responses', reasoning: /^gpt-(?:5|6)/.test(settings.model) }
    : { ...common, input: ['text'], api: 'openai-completions', compat: { supportsDeveloperRole: false, supportsStore: false, maxTokensField: 'max_tokens' } };
}

/** Replace prior app-owned system declarations so disabled tools never remain in the request schema. */
export function buildContext(systemPrompt: string, messages: AgentMessage[], tools: AgentTool[]): TranscriptContext {
  return normalizeContext({ systemPrompt, tools: tools.map(toToolDeclaration), messages: messages.filter((message) => message.role !== 'system') });
}

/** Keep tool-call pairs valid without carrying a previous turn's full Skill instructions forward. */
export function compactPastSkillResults(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => message.role === 'toolResult' && message.toolName === 'use_skill' && !message.isError
    ? { ...message, content: [{ type: 'text', text: '该 Skill 已在上一轮使用。完整指令仅在使用当轮加载；本轮如需使用，请重新选择或调用。' }], details: {} }
    : message);
}

export function estimateContext(systemPrompt: string, messages: AgentMessage[], tools: AgentTool[]): ContextEstimate {
  const system = systemPrompt ? countEstimatedTokens(systemPrompt) + 8 : 0;
  const schemas = tools.map(toToolDeclaration);
  const toolTokens = schemas.length ? countEstimatedTokens(schemas) + 8 : 0;
  const history = messages.filter((message) => message.role !== 'system').reduce((sum, message) => {
    const requestMessage = { ...message } as Partial<AgentMessage>;
    delete requestMessage.timestamp;
    return sum + countEstimatedTokens(requestMessage) + 8;
  }, 0);
  return { system, tools: toolTokens, history, total: system + toolTokens + history, toolCount: tools.length, method: METHOD };
}

/** Count the exact outgoing content fields without retaining the payload or any headers. */
export function estimatePayload(payload: unknown, fallback: ContextEstimate): ContextEstimate {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  const messages = Array.isArray(record.messages) ? record.messages : Array.isArray(record.input) ? record.input : undefined;
  if (!messages) return fallback;
  let system = 0;
  if (typeof record.instructions === 'string' && record.instructions) system += countEstimatedTokens(record.instructions) + 8;
  let history = 0;
  for (const raw of messages) {
    if (!raw || typeof raw !== 'object') continue;
    const message = raw as Record<string, unknown>;
    const tokens = countEstimatedTokens(message) + 8;
    if (message.role === 'system' || message.role === 'developer') system += tokens;
    else history += tokens;
  }
  const schemas = Array.isArray(record.tools) ? record.tools : [];
  const tools = schemas.length ? countEstimatedTokens(schemas) + 8 : 0;
  return { system, history, tools, total: system + history + tools, toolCount: schemas.length, method: METHOD };
}

export function providerUsage(usage: Usage | undefined): TokenUsage | null {
  if (!usage) return null;
  const fields = [usage.input, usage.output, usage.cacheRead, usage.cacheWrite];
  if (!fields.every((number) => Number.isFinite(number) && number >= 0) || fields.every((number) => number === 0)) return null;
  // A nonempty request cannot have zero total input; some compatible providers omit input while reporting output.
  if (usage.input + usage.cacheRead + usage.cacheWrite === 0) return null;
  // Pi providers normalize input to the uncached subset, with cache read/write reported separately.
  return { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
    totalInput: usage.input + usage.cacheRead + usage.cacheWrite, source: 'provider' };
}

export function transcriptSystemText(context: TranscriptContext): string {
  return context.messages.filter((message) => message.role === 'system').map(getSystemMessageText).join('\n');
}
