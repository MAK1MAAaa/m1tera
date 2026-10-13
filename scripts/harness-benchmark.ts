import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { Model } from '@earendil-works/pi-ai';
import type { AgentTool, StreamFn } from '@earendil-works/pi-agent-core';
import { ArtifactStore } from '../runtime/artifacts.js';
import type { ArtifactMetadata } from '../runtime/artifacts.js';
import { buildModel, estimatePayload, providerUsage } from '../runtime/context.js';
import { createHarnessAgent } from '../runtime/harness.js';
import { createTools } from '../runtime/tools.js';
import { DEFAULT_HARNESS_POLICY, TOOL_NAMES } from '../shared/protocol.js';
import type { ContextEstimate, HarnessPolicy, TokenUsage } from '../shared/protocol.js';

interface PayloadMessage { role: string; content?: string; tool_call_id?: string }
interface Payload { messages: PayloadMessage[]; tools?: { function?: { name: string }; name?: string }[] }
interface ScriptedCall { name: string; args: Record<string, string | number>; id: string }
interface RequestMeasurement {
  turn: number;
  payloadBytes: number;
  toolNames: string[];
  estimate: ContextEstimate;
  providerUsage: TokenUsage | null;
}
interface RetrievalMeasurement { correct: boolean; offset: number; nextOffset: number | null; characters: number }
const model = buildModel({ baseUrl: 'https://local-harness.invalid/v1', model: 'fixture-local-harness', apiFormat: 'chat-completions' });
const policy: HarnessPolicy = { ...DEFAULT_HARNESS_POLICY, toolResultTokenLimit: 4096 };
const temporaryDirectories: string[] = [];
const middleMarker = 'MIDDLE_CHECKPOINT=retry-budget-3';
const endMarker = 'END_STATUS=completed-with-2-retries';
const task = '读取 harness-log.txt 的完整日志，找到中间的 MIDDLE_CHECKPOINT 与末尾的 END_STATUS 标记并返回这两个值。';
const emptyEstimate: ContextEstimate = { system: 0, tools: 0, history: 0, total: 0, toolCount: 0, method: '' };

function requireCondition(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function hash(text: string) { return createHash('sha256').update(text, 'utf8').digest('hex'); }
function payloadTools(payload: Payload) { return (payload.tools ?? []).map((tool) => tool.function?.name ?? tool.name ?? '').filter(Boolean); }

/** Real Pi request formatting and SSE parsing, backed by an in-process scripted fetch, never a network endpoint. */
function scriptedProvider(respond: (payload: Payload, turn: number) => ScriptedCall | string) {
  const requests: RequestMeasurement[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const body = typeof init?.body === 'string' ? init.body : input instanceof Request ? await input.text() : undefined;
    requireCondition(body, 'fixture 未收到请求体');
    const payload = JSON.parse(body) as Payload;
    requireCondition(Array.isArray(payload.messages), 'fixture 未收到 Chat Completions 消息');
    const estimate = estimatePayload(payload, emptyEstimate);
    estimate.method = estimate.method.split('实际 usage')[0].trim();
    const turn = requests.length + 1;
    requests.push({ turn, payloadBytes: Buffer.byteLength(body), toolNames: payloadTools(payload), estimate, providerUsage: null });
    const response = respond(payload, turn);
    const delta = typeof response === 'string'
      ? { role: 'assistant', content: response }
      : { role: 'assistant', tool_calls: [{ index: 0, id: response.id, type: 'function', function: { name: response.name, arguments: JSON.stringify(response.args) } }] };
    const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    const data = frame({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta, finish_reason: null }] })
      + frame({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: model.id, choices: [{ index: 0, delta: {}, finish_reason: typeof response === 'string' ? 'stop' : 'tool_calls' }] })
      + 'data: [DONE]\n\n';
    // The fixture deliberately omits usage; zero-valued adapter defaults remain unknown.
    return new Response(data, { headers: { 'content-type': 'text/event-stream', 'x-request-id': `fixture-${turn}` } });
  };
  const streamFn: StreamFn = (selected, context, options) => streamSimple(selected as Model<'openai-completions'>, context, { ...options, apiKey: 'unused-fixture', fetch: fetcher });
  return { streamFn, requests };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-local-harness-'));
  temporaryDirectories.push(directory);
  const artifacts = new ArtifactStore(path.join(directory, 'appdata'));
  await artifacts.initialize();
  return { directory, artifacts, sessionId: randomUUID() };
}

function countedTools(tools: AgentTool[], counts: Record<string, number>) {
  return tools.map((tool) => ({ ...tool, execute: async (...args: Parameters<AgentTool['execute']>) => {
    counts[tool.name] = (counts[tool.name] ?? 0) + 1;
    return tool.execute(...args);
  } }));
}

async function firstTurn(toolCount: 0 | 4) {
  const setup = await fixture();
  const toolExecutions: Record<string, number> = {};
  const tools = countedTools(createTools(toolCount ? TOOL_NAMES : [], { workspace: setup.directory, approve: async () => true }), toolExecutions);
  const provider = scriptedProvider(() => '你好');
  const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: provider.streamFn }, { ...setup, systemPrompt: '', tools, policy });
  await agent.prompt('你好');
  requireCondition(provider.requests.length === 1, '首轮目录评测未保持单请求');
  requireCondition(Object.values(toolExecutions).length === 0, '首轮目录评测不应执行工具');
  requireCondition(provider.requests[0].toolNames.length === toolCount, '首轮工具定义数量不匹配');
  return { toolCount, request: provider.requests[0], metrics, toolExecutions };
}

function makeLog() {
  const lines = ['# Synthetic local harness fixture; these are not production events.'];
  for (let index = 0; index < 240; index++) {
    const minute = String(Math.floor(index / 60)).padStart(2, '0');
    const second = String(index % 60).padStart(2, '0');
    lines.push(`2026-10-13T00:${minute}:${second}Z INFO batch-step=${String(index).padStart(4, '0')} worker=alpha action=validate queue=ready duration_ms=${String(20 + index % 80).padStart(3, '0')} bytes=${String(1024 + index * 17).padStart(6, '0')} status=ok note=本地合成日志`);
    if (index === 120) lines.push(middleMarker);
  }
  lines.push(endMarker);
  return `${lines.join('\n')}\n`;
}

function logReader(payload: Payload, turn: number): ScriptedCall | string {
  if (turn === 1) return { name: 'run_command', args: { command: process.platform === 'win32' ? 'type harness-log.txt' : 'cat harness-log.txt', timeoutSeconds: 10 }, id: 'read-log' };
  const text = payload.messages.filter((message) => message.role === 'tool').map((message) => message.content ?? '').join('\n');
  const middle = text.match(/MIDDLE_CHECKPOINT=([^\s]+)/)?.[1];
  const end = text.match(/END_STATUS=([^\s]+)/)?.[1];
  if (middle && end) return `MIDDLE_CHECKPOINT=${middle}\nEND_STATUS=${end}`;
  const id = text.match(/工具结果已外置：([\da-f-]{36})/)?.[1];
  const total = Number(text.match(/(\d+) 个 Unicode 字符/)?.[1]);
  requireCondition(id && Number.isInteger(total) && payloadTools(payload).includes('read_artifact'), 'fixture 需要中部内容但未获得有效的外置引用');
  // This fixture task explicitly asks for a middle marker; the scripted provider reads a middle page.
  return { name: 'read_artifact', args: { id, offset: Math.max(0, Math.floor(total / 2) - 512), limit: 1536 }, id: 'read-middle-page' };
}

async function largeLog(offloadToolResults: boolean, source: string) {
  const setup = await fixture();
  await writeFile(path.join(setup.directory, 'harness-log.txt'), source, 'utf8');
  requireCondition(Buffer.byteLength(source) < 64 * 1024, '合成日志超过现有命令输出上限，会破坏对照');
  const toolExecutions: Record<string, number> = {};
  const tools = countedTools(createTools(['run_command'], { workspace: setup.directory, approve: async () => true }), toolExecutions);
  const provider = scriptedProvider(logReader);
  const observed: { artifact?: ArtifactMetadata; retrieval: RetrievalMeasurement | null } = { retrieval: null };
  const started = performance.now();
  const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: provider.streamFn, toolExecution: 'sequential' }, {
    ...setup, systemPrompt: '', tools, policy: { ...policy, offloadToolResults },
    onResult: async (context) => {
      const details = context.result.details as { artifact?: ArtifactMetadata; offset?: number; nextOffset?: number | null };
      if (details.artifact) observed.artifact = details.artifact;
      if (context.toolCall.name === 'read_artifact') {
        const returned = context.result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        const offset = details.offset!;
        observed.retrieval = { correct: returned.startsWith([...source].slice(offset, offset + 1536).join('')) && returned.includes(middleMarker), offset, nextOffset: details.nextOffset ?? null, characters: 1536 };
        toolExecutions.read_artifact = (toolExecutions.read_artifact ?? 0) + 1;
        requireCondition(!details.artifact, '读取页不应再次外置');
      }
    },
  });
  await agent.prompt(task);
  const final = agent.state.messages.findLast((message) => message.role === 'assistant');
  requireCondition(final?.role === 'assistant', 'fixture 没有最终消息');
  const finalText = final.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  requireCondition(finalText === `${middleMarker}\n${endMarker}`, 'fixture 未能保留两个日志标记');
  requireCondition(toolExecutions.run_command === 1, '日志命令不应重复执行');
  let archived: { bytes: number; sha256: string; bytesMatch: boolean; hashMatches: boolean } | null = null;
  const { artifact, retrieval } = observed;
  if (artifact) {
    const saved = await readFile(path.join(setup.artifacts.directory, 'artifacts', setup.sessionId, `${artifact.id}.txt`));
    archived = { bytes: saved.length, sha256: createHash('sha256').update(saved).digest('hex'), bytesMatch: saved.length === Buffer.byteLength(source) && saved.length === artifact.bytes, hashMatches: createHash('sha256').update(saved).digest('hex') === hash(source) && artifact.sha256 === hash(source) };
    requireCondition(archived.bytesMatch && archived.hashMatches && retrieval?.correct, '外置内容或分页验证失败');
  }
  requireCondition(offloadToolResults === Boolean(artifact), '外置策略未生效');
  requireCondition(providerUsage(final.usage) === null, 'fixture 不应产生真实 provider usage');
  return { variant: offloadToolResults ? 'offload' : 'raw', requests: provider.requests, estimatedTotalInput: provider.requests.reduce((sum, request) => sum + request.estimate.total, 0), modelRequests: provider.requests.length,
    toolExecutions, archived, retrieval, finalMarkersPreserved: true, providerUsage: null, elapsedMs: Number((performance.now() - started).toFixed(2)), metrics };
}

async function turnGuard() {
  const setup = await fixture();
  const toolExecutions: Record<string, number> = {};
  const tools = countedTools(createTools(['list_directory'], { workspace: setup.directory, approve: async () => true }), toolExecutions);
  const provider = scriptedProvider((_payload, turn) => ({ name: 'list_directory', args: { path: '.' }, id: `repeat-${turn}` }));
  const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: provider.streamFn }, { ...setup, systemPrompt: '', tools, policy: { ...policy, maxModelTurns: 2 } });
  await agent.prompt('反复列出目录');
  requireCondition(provider.requests.length === 2 && toolExecutions.list_directory === 2 && metrics.limitReason, '模型轮次边界未停止循环');
  return { configuredMaxTurns: 2, modelRequests: provider.requests.length, toolExecutions, stopped: true, reason: metrics.limitReason, providerUsage: null };
}

async function checkpointGuard(stage: 'intent' | 'result') {
  const setup = await fixture();
  const toolExecutions: Record<string, number> = {};
  const tools = countedTools(createTools(['write_file'], { workspace: setup.directory, approve: async () => true }), toolExecutions);
  const provider = scriptedProvider((_payload, turn) => ({ name: 'write_file', args: { path: 'effect.txt', content: 'fixture writes once' }, id: `write-${turn}` }));
  const fail = async () => { throw new Error('synthetic checkpoint failure'); };
  const { agent, metrics } = createHarnessAgent({ initialState: { model, tools }, streamFn: provider.streamFn }, { ...setup, systemPrompt: '', tools, policy, ...(stage === 'intent' ? { onIntent: fail } : { onResult: fail }) });
  await agent.prompt('验证检查点失败时不自动重放写入');
  const writes = toolExecutions.write_file ?? 0;
  const saved = await readFile(path.join(setup.directory, 'effect.txt'), 'utf8').catch(() => undefined);
  requireCondition(provider.requests.length === 1 && metrics.limitReason && writes === (stage === 'intent' ? 0 : 1), '检查点失败后存在额外请求或写入');
  requireCondition(stage === 'intent' ? saved === undefined : saved === 'fixture writes once', '实际文件副作用不匹配');
  return { stage, modelRequests: provider.requests.length, writeExecutions: writes, fileExists: saved !== undefined, stopped: true, automaticReplays: 0, reason: metrics.limitReason, providerUsage: null };
}

function markdown(report: Awaited<ReturnType<typeof measure>>) {
  const { raw, optimized, estimatedInputSavings, estimatedInputSavingsPercent } = report.largeToolResult;
  const rows = [
    '# Harness 本地管线评测', '',
    `执行时间：${report.generatedAt}。模式：\`${report.mode}\`；平台：${report.environment.platform}/${report.environment.arch}；Node ${report.environment.node}。`, '',
    '本评测执行实际 `createHarnessAgent`、Pi Chat Completions 请求格式化/SSE 解析、工作区工具及 ArtifactStore，使用进程内脚本服务端，不访问真实模型或账户。没有模型准确率成绩；所有 provider usage 均为未知。', '',
    '## 首轮工具目录', '',
    '| 工具定义数 | 系统估算 | 工具定义估算 | 消息估算 | 首轮合计估算 | 实际 usage |',
    '| ---: | ---: | ---: | ---: | ---: | --- |',
    ...report.firstTurn.map((value) => `| ${value.toolCount} | ${value.request.estimate.system} | ${value.request.estimate.tools} | ${value.request.estimate.history} | ${value.request.estimate.total} | 未知 |`), '',
    '两种配置均使用空系统提示词、短消息“你好”，只调用一次脚本模型，不执行工具；纯聊天没有隐藏工具或 artifact schema。', '',
    '## 完整日志与外置结果对照', '',
    `相同任务、脚本服务端决策、原始日志和 run_command 工具；唯一策略差异是结果外置开关。日志为 ${report.largeToolResult.source.bytes} 字节的 240 条合成事件，包含中部和尾部标记，未超过命令输出 64 KiB 上限。`, '',
    '| 模式 | 模型请求数 | 每次请求输入估算 | 累计输入估算 | 命令执行 | artifact 读取 |',
    '| --- | ---: | --- | ---: | ---: | ---: |',
    `| 原文 | ${raw.modelRequests} | ${raw.requests.map((request) => request.estimate.total).join(' / ')} | ${raw.estimatedTotalInput} | ${raw.toolExecutions.run_command} | ${raw.toolExecutions.read_artifact ?? 0} |`,
    `| 外置 | ${optimized.modelRequests} | ${optimized.requests.map((request) => request.estimate.total).join(' / ')} | ${optimized.estimatedTotalInput} | ${optimized.toolExecutions.run_command} | ${optimized.toolExecutions.read_artifact ?? 0} |`, '',
    `在这个固定样本上，累计输入估算减少 ${estimatedInputSavings}（${estimatedInputSavingsPercent}%）；已计入外置增加的分页请求及 read_artifact schema。没有添加重复对话以放大收益。`, '',
    '原文模式一次拿到完整日志；外置模式额外读取中部页。脚本服务端根据可见引用和总字符数选中部范围，无法代表真实模型发现、选择和理解证据的能力。两个模式返回相同标记；分页实际经过 harness 的 read_artifact.execute；原文件与 artifact 的字节数及 SHA-256 完全一致，读取页没有再次外置。', '',
    `原文 SHA-256：\`${report.largeToolResult.source.sha256}\`。`, '',
    '## 运行边界', '',
    `- 模型轮次上限：设为 2，实际 ${report.guards.turnLimit.modelRequests} 次请求、${report.guards.turnLimit.toolExecutions.list_directory} 次只读工具执行，未发第 3 次请求。`,
    ...report.guards.checkpoints.map((value) => `- ${value.stage === 'intent' ? '执行意图' : '工具结果'}检查点失败：${value.modelRequests} 次模型请求、${value.writeExecutions} 次写入、${value.automaticReplays} 次自动重放；${value.fileExists ? '已执行写入保留，等待人工检查' : '文件未产生'}。`), '',
    '## 测量限制与复现', '',
    `${report.tokenMethod} 数值来自真正送到脚本 fetch 的 OpenAI 格式 content/schema；不能等同服务商 tokenizer 或实际 usage，也不证明 BFCL、SimpleQA 或其他模型能力 benchmark 成绩。`, '',
    '运行：`node --import tsx scripts/harness-benchmark.ts`。报告覆盖写入本文件及 `harness-local.json`；所有合成工作区、会话和 artifacts 在 finally 中删除。随机 artifact ID 可能使重跑估算相差少量 token。', '',
  ];
  return rows.join('\n');
}

async function measure() {
  const firstTurns = [await firstTurn(0), await firstTurn(4)];
  const source = makeLog();
  const raw = await largeLog(false, source);
  const optimized = await largeLog(true, source);
  const savings = raw.estimatedTotalInput - optimized.estimatedTotalInput;
  return {
    version: 1, mode: 'local-harness' as const, provider: 'in-process scripted OpenAI-compatible SSE fixture', model: model.id, generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, arch: process.arch, node: process.version },
    tokenMethod: firstTurns[0].request.estimate.method,
    policy, providerUsage: null,
    firstTurn: firstTurns,
    largeToolResult: { task, source: { kind: 'synthetic-log-fixture', eventRows: 240, bytes: Buffer.byteLength(source), sha256: hash(source) }, raw, optimized,
      estimatedInputSavings: savings, estimatedInputSavingsPercent: Number((savings / raw.estimatedTotalInput * 100).toFixed(2)) },
    guards: { turnLimit: await turnGuard(), checkpoints: [await checkpointGuard('intent'), await checkpointGuard('result')] },
  };
}

async function main() {
  try {
    const report = await measure();
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const output = path.join(root, 'docs', 'benchmarks');
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'harness-local.json'), `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(path.join(output, 'harness-local.md'), markdown(report));
    console.log(JSON.stringify({ mode: report.mode, firstTurn: report.firstTurn.map((value) => ({ tools: value.toolCount, estimatedInput: value.request.estimate.total })),
      rawEstimatedInput: report.largeToolResult.raw.estimatedTotalInput, optimizedEstimatedInput: report.largeToolResult.optimized.estimatedTotalInput,
      estimatedInputSavingsPercent: report.largeToolResult.estimatedInputSavingsPercent, sourceBytes: report.largeToolResult.source.bytes,
      modelRequests: { raw: report.largeToolResult.raw.modelRequests, optimized: report.largeToolResult.optimized.modelRequests }, guards: report.guards,
      providerUsage: null, output: path.join(output, 'harness-local.json') }, null, 2));
  } finally { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); }
}

await main();
