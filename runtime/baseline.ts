import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import type { Api, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import { TOOL_NAMES, type BaselineReport, type Settings } from '../shared/protocol.js';
import { buildContext, estimateContext, estimatePayload, providerUsage } from './context.js';
import { createTools } from './tools.js';

export const BASELINE_PROMPT = '只回复 OK，不调用工具。';

/** Synthetic schema scaling only. None of these tools execute during measurement. */
export function baselineTools(count: 0 | 4 | 20): AgentTool[] {
  const base = createTools(TOOL_NAMES, { workspace: '', approve: async () => false });
  return Array.from({ length: count }, (_, i) => {
    const template = base[i % base.length]!;
    return { ...template,
      name: i < base.length ? template.name : `${template.name}_${Math.floor(i / base.length) + 1}`,
      execute: async () => { throw new Error('基线测量不执行工具。'); },
    };
  });
}

export async function runBaseline(options: {
  settings: Settings;
  model?: Model<Api>;
  streamFn?: StreamFn;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<BaselineReport> {
  const { settings, model, streamFn } = options;
  const live = Boolean(model && streamFn);
  const report: BaselineReport = {
    model: settings.model, connection: settings.connection, prompt: BASELINE_PROMPT,
    measuredAt: new Date().toISOString(), mode: live ? 'live' : 'estimate', cases: [],
  };
  for (const count of [0, 4, 20] as const) {
    const tools = baselineTools(count);
    const messages = [{ role: 'user' as const, content: BASELINE_PROMPT, timestamp: 0 }];
    let estimate = estimateContext(settings.systemPrompt, messages, tools);
    if (!model || !streamFn) {
      report.cases.push({ toolCount: count, estimate, usage: null, elapsedMs: null });
      continue;
    }
    const context = buildContext(settings.systemPrompt, messages, tools);
    const started = performance.now();
    try {
      const timeout = AbortSignal.timeout(60_000);
      const streamOptions: SimpleStreamOptions = {
        apiKey: options.apiKey, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        maxTokens: 2048, reasoning: 'low',
        onPayload(payload) { estimate = estimatePayload(payload, estimate); },
      };
      const stream = await streamFn(model, context, streamOptions);
      const result = await stream.result();
      if (result.stopReason === 'error' || result.stopReason === 'aborted') throw new Error('模型未完成此轮基线请求。');
      report.cases.push({ toolCount: count, estimate, usage: providerUsage(result.usage), elapsedMs: Math.round(performance.now() - started) });
    } catch {
      // Avoid forwarding upstream exceptions, which can contain authorization data.
      report.cases.push({ toolCount: count, estimate, usage: null, elapsedMs: Math.round(performance.now() - started), error: '模型请求失败或超时；未获得可核验 usage。' });
    }
  }
  return report;
}
