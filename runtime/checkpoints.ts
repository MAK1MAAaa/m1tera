import { createHash } from 'node:crypto';
import type { ComposerDraft } from '../shared/protocol.js';

export type RunStatus = 'running' | 'interrupted' | 'paused' | 'completed' | 'cancelled' | 'error';
export type ToolReplay = 'safe' | 'never';
export type ToolCheckpointState = 'intent' | 'completed' | 'failed' | 'interrupted';
export type CheckpointApproval = 'waiting' | 'approved' | 'rejected' | 'expired';

export interface ToolCheckpoint {
  name: string;
  args: Record<string, unknown>;
  replay: ToolReplay;
  state: ToolCheckpointState;
  approval?: CheckpointApproval;
  isError?: boolean;
  error?: string;
}

export interface RunCheckpoint {
  version: 1;
  runId: string;
  submissionId: string;
  input: ComposerDraft;
  model: string;
  providerId?: string;
  status: RunStatus;
  startedAt: string;
  updatedAt: string;
  modelTurns: number;
  toolCalls: Record<string, ToolCheckpoint>;
}

export interface SubmissionReceipt {
  submissionId: string;
  runId: string;
  fingerprint: string;
}

export interface CheckpointParams {
  runId: string;
  submissionId: string;
  input: ComposerDraft;
  model: string;
  providerId?: string;
  now?: string;
}

const MAX_INPUT_BYTES = 1024 * 1024;
// JSON escaping can expand one legal 1 MiB write_file content string sixfold.
const MAX_ARGS_BYTES = MAX_INPUT_BYTES * 6 + 64 * 1024;
const MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024;
const MAX_TOOL_CALLS = 256;
const MAX_RECEIPTS = 64;
const RUN_STATUSES: readonly RunStatus[] = ['running', 'interrupted', 'paused', 'completed', 'cancelled', 'error'];
const TOOL_STATES: readonly ToolCheckpointState[] = ['intent', 'completed', 'failed', 'interrupted'];
const APPROVAL_STATES: readonly CheckpointApproval[] = ['waiting', 'approved', 'rejected', 'expired'];
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor', 'apikey', 'api_key', 'authorization', 'token', 'accesstoken', 'access_token', 'refreshtoken', 'refresh_token', 'password', 'secret', 'credentials', 'cookie', 'cookies']);

/** Checkpoints describe durable boundaries; they never restart a provider stream or replay a tool. */
export function createCheckpoint(params: CheckpointParams): RunCheckpoint {
  const now = params.now ?? new Date().toISOString();
  return validateCheckpoint({
    version: 1, runId: params.runId, submissionId: params.submissionId,
    input: params.input, model: params.model,
    ...(params.providerId !== undefined ? { providerId: params.providerId } : {}),
    status: 'running', startedAt: now, updatedAt: now, modelTurns: 0, toolCalls: {},
  });
}

export function recordToolIntent(checkpoint: RunCheckpoint, id: string, name: string, args: Record<string, unknown>, replay: ToolReplay): RunCheckpoint {
  const next = validateCheckpoint(checkpoint);
  assertRunning(next);
  identifier(id, 'tool call ID', true);
  const tool = validateTool({ name, args, replay, state: 'intent' });
  const prior = next.toolCalls[id];
  if (prior) {
    if (prior.name !== name || prior.replay !== replay || stableJson(prior.args) !== stableJson(tool.args)) throw new Error('工具调用 ID 已存在且参数或策略不一致');
    return next;
  }
  if (Object.keys(next.toolCalls).length >= MAX_TOOL_CALLS) throw new Error('运行中的工具调用超过 256 个');
  next.toolCalls[id] = tool;
  touch(next);
  return validateCheckpoint(next);
}

export function recordToolOutcome(checkpoint: RunCheckpoint, id: string, isError: boolean, error?: string): RunCheckpoint {
  const next = validateCheckpoint(checkpoint);
  assertRunning(next);
  const tool = requireTool(next, id);
  if (typeof isError !== 'boolean') throw new Error('工具结果状态无效');
  const diagnostic = error === undefined ? undefined : boundedText(error, '工具错误', 2048);
  if (tool.state === 'completed' || tool.state === 'failed') {
    if (tool.isError !== isError || tool.error !== diagnostic) throw new Error('工具结果与已保存结果不一致');
    return next;
  }
  if (tool.state !== 'intent') throw new Error('中断的工具调用不能被旧结果重新完成');
  if (tool.approval === 'waiting' || tool.approval === 'expired') throw new Error('审批尚未完成，不能保存工具执行结果');
  if (tool.approval === 'rejected' && !isError) throw new Error('已拒绝工具不能保存为成功');
  tool.state = isError ? 'failed' : 'completed';
  tool.isError = isError;
  if (diagnostic !== undefined) tool.error = diagnostic;
  touch(next);
  return next;
}

export function recordApproval(checkpoint: RunCheckpoint, callId: string, status: CheckpointApproval): RunCheckpoint {
  const next = validateCheckpoint(checkpoint);
  assertRunning(next);
  if (!APPROVAL_STATES.includes(status)) throw new Error('审批状态无效');
  const tool = requireTool(next, callId);
  if (tool.state !== 'intent') throw new Error('已结束的工具调用不能重新审批');
  if (tool.approval === status) return next;
  if (tool.approval !== undefined && tool.approval !== 'waiting') throw new Error('已决定或失效的审批不能重新授予权限');
  tool.approval = status;
  touch(next);
  return next;
}

/** A crash leaves external effects unknown. Even a saved approval is expired rather than reused. */
export function recoverCheckpoint(checkpoint: RunCheckpoint, now?: string): RunCheckpoint {
  const next = validateCheckpoint(checkpoint);
  if (next.status === 'running' || next.status === 'paused') next.status = 'interrupted';
  for (const tool of Object.values(next.toolCalls)) {
    if (tool.state === 'intent') tool.state = 'interrupted';
    if (tool.approval === 'waiting' || tool.approval === 'approved') tool.approval = 'expired';
  }
  touch(next, now);
  return next;
}

export function finishCheckpoint(checkpoint: RunCheckpoint, status: Exclude<RunStatus, 'running'>, now?: string): RunCheckpoint {
  const next = validateCheckpoint(checkpoint);
  if (!RUN_STATUSES.includes(status) || status === ('running' as RunStatus)) throw new Error('运行结束状态无效');
  if (['completed', 'cancelled', 'error'].includes(next.status) && next.status !== status) throw new Error('已结束的运行不能被旧事件改变状态');
  if (status === 'completed' && Object.values(next.toolCalls).some((tool) => tool.state === 'intent')) throw new Error('存在未完成工具，不能将运行标为完成');
  next.status = status;
  for (const tool of Object.values(next.toolCalls)) {
    if (tool.state === 'intent') tool.state = 'interrupted';
    if (tool.state === 'interrupted' && (tool.approval === 'waiting' || tool.approval === 'approved')) tool.approval = 'expired';
  }
  touch(next, now);
  return next;
}

export function isResumable(status: RunStatus): boolean {
  return status === 'interrupted' || status === 'paused' || status === 'error';
}

export function hasUnknownEffects(checkpoint: RunCheckpoint): boolean {
  return Object.values(validateCheckpoint(checkpoint).toolCalls).some((tool) => tool.replay === 'never' && (tool.state === 'intent' || tool.state === 'interrupted'));
}

/** Strict storage validation: unrecognized metadata and credential fields are never restored. */
export function validateCheckpoint(value: unknown): RunCheckpoint {
  const item = record(value, '运行 checkpoint');
  knownKeys(item, ['version', 'runId', 'submissionId', 'input', 'model', 'providerId', 'status', 'startedAt', 'updatedAt', 'modelTurns', 'toolCalls']);
  if (item.version !== 1) throw new Error('不支持的 checkpoint 版本');
  const runId = identifier(item.runId, 'run ID');
  const submissionId = identifier(item.submissionId, 'submission ID');
  const input = validateInput(item.input);
  const model = boundedText(item.model, '模型', 200, false);
  const providerId = item.providerId === undefined ? undefined : identifier(item.providerId, 'provider ID');
  if (!RUN_STATUSES.includes(item.status as RunStatus)) throw new Error('运行状态无效');
  const startedAt = timestamp(item.startedAt);
  const updatedAt = timestamp(item.updatedAt);
  if (updatedAt < startedAt) throw new Error('checkpoint 更新时间早于开始时间');
  if (!Number.isSafeInteger(item.modelTurns) || Number(item.modelTurns) < 0 || Number(item.modelTurns) > 10_000) throw new Error('模型轮数无效');
  const calls = record(item.toolCalls, '工具 checkpoint');
  if (Object.keys(calls).length > MAX_TOOL_CALLS) throw new Error('运行中的工具调用超过 256 个');
  const toolCalls: Record<string, ToolCheckpoint> = {};
  let storedBytes = Buffer.byteLength(JSON.stringify(input));
  for (const [id, tool] of Object.entries(calls)) {
    identifier(id, 'tool call ID', true);
    const validated = validateTool(tool);
    storedBytes += Buffer.byteLength(JSON.stringify(validated)) + Buffer.byteLength(id);
    if (storedBytes > MAX_CHECKPOINT_BYTES) throw new Error('checkpoint 超过 8 MiB');
    toolCalls[id] = validated;
  }
  if (item.status === 'completed' && Object.values(toolCalls).some((tool) => tool.state === 'intent')) throw new Error('已完成 checkpoint 包含待执行工具');
  const result: RunCheckpoint = {
    version: 1, runId, submissionId, input, model,
    ...(providerId !== undefined ? { providerId } : {}),
    status: item.status as RunStatus, startedAt, updatedAt, modelTurns: Number(item.modelTurns), toolCalls,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_CHECKPOINT_BYTES) throw new Error('checkpoint 超过 8 MiB');
  return result;
}

/** Hash only serializable input and capability metadata. Credential fields must not be supplied. */
export function submissionFingerprint(input: ComposerDraft, capabilities: Readonly<Record<string, unknown>>): string {
  const payload = { input: validateInput(input), capabilities: jsonRecord(capabilities, MAX_CHECKPOINT_BYTES) };
  return createHash('sha256').update(stableJson(payload)).digest('hex');
}

/** Admission deduplication is not exactly-once execution of filesystem or shell effects. */
export function admitSubmission(receipts: readonly SubmissionReceipt[], receipt: SubmissionReceipt): { receipts: SubmissionReceipt[]; runId: string; duplicate: boolean } {
  const existing = validateSubmissionReceipts(receipts);
  const incoming = validateReceipt(receipt);
  const prior = existing.find((item) => item.submissionId === incoming.submissionId);
  if (prior) {
    if (prior.fingerprint !== incoming.fingerprint) throw new Error('submission ID 已被不同的输入或配置使用');
    return { receipts: existing, runId: prior.runId, duplicate: true };
  }
  return { receipts: [...existing, incoming].slice(-MAX_RECEIPTS), runId: incoming.runId, duplicate: false };
}

export function validateSubmissionReceipts(value: unknown): SubmissionReceipt[] {
  if (!Array.isArray(value) || value.length > MAX_RECEIPTS) throw new Error('提交记录格式无效或超过 64 条');
  const ids = new Set<string>();
  return value.map((item) => {
    const receipt = validateReceipt(item);
    if (ids.has(receipt.submissionId)) throw new Error('提交记录包含重复 submission ID');
    ids.add(receipt.submissionId);
    return receipt;
  });
}

function validateInput(value: unknown): ComposerDraft {
  const item = record(value, '输入');
  knownKeys(item, ['text', 'command', 'attachments', 'skillIds']);
  const text = boundedText(item.text, '输入文本', MAX_INPUT_BYTES);
  if (item.command !== undefined && item.command !== 'plan' && item.command !== 'websearch') throw new Error('输入命令无效');
  return {
    text,
    ...(item.command !== undefined ? { command: item.command } : {}),
    ...(item.attachments !== undefined ? { attachments: stringList(item.attachments, 8, 4096, '附件路径') } : {}),
    ...(item.skillIds !== undefined ? { skillIds: stringList(item.skillIds, 6, 200, '技能 ID') } : {}),
  };
}

function validateTool(value: unknown): ToolCheckpoint {
  const item = record(value, '工具 checkpoint');
  knownKeys(item, ['name', 'args', 'replay', 'state', 'approval', 'isError', 'error']);
  const name = identifier(item.name, '工具名称');
  const args = jsonRecord(item.args, MAX_ARGS_BYTES);
  if (item.replay !== 'safe' && item.replay !== 'never') throw new Error('工具重放策略无效');
  if (!TOOL_STATES.includes(item.state as ToolCheckpointState)) throw new Error('工具状态无效');
  if (item.approval !== undefined && !APPROVAL_STATES.includes(item.approval as CheckpointApproval)) throw new Error('审批状态无效');
  if (item.isError !== undefined && typeof item.isError !== 'boolean') throw new Error('工具错误状态无效');
  if (item.state === 'completed' && item.isError !== false || item.state === 'failed' && item.isError !== true) throw new Error('工具结果与完成状态不一致');
  if ((item.state === 'intent' || item.state === 'interrupted') && item.isError !== undefined) throw new Error('未知工具结果不能声明成功或失败');
  if (item.state === 'completed' && (item.approval === 'waiting' || item.approval === 'rejected')) throw new Error('未批准工具被标为成功');
  const error = item.error === undefined ? undefined : boundedText(item.error, '工具错误', 2048);
  return {
    name, args, replay: item.replay, state: item.state as ToolCheckpointState,
    ...(item.approval !== undefined ? { approval: item.approval as CheckpointApproval } : {}),
    ...(item.isError !== undefined ? { isError: item.isError as boolean } : {}),
    ...(error !== undefined ? { error } : {}),
  };
}

function validateReceipt(value: unknown): SubmissionReceipt {
  const item = record(value, '提交记录');
  knownKeys(item, ['submissionId', 'runId', 'fingerprint']);
  if (typeof item.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(item.fingerprint)) throw new Error('提交指纹无效');
  return { submissionId: identifier(item.submissionId, 'submission ID'), runId: identifier(item.runId, 'run ID'), fingerprint: item.fingerprint };
}

function requireTool(checkpoint: RunCheckpoint, id: string): ToolCheckpoint {
  identifier(id, 'tool call ID', true);
  const tool = checkpoint.toolCalls[id];
  if (!tool) throw new Error('工具调用没有已保存的 intent');
  return tool;
}

function assertRunning(checkpoint: RunCheckpoint) {
  if (checkpoint.status !== 'running') throw new Error('非运行中的 checkpoint 不能接受工具事件');
}

function touch(checkpoint: RunCheckpoint, now?: string) {
  const current = timestamp(now ?? new Date().toISOString());
  checkpoint.updatedAt = current > checkpoint.updatedAt ? current : checkpoint.updatedAt;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error(`${label}必须是普通 JSON 对象`);
  return value as Record<string, unknown>;
}

function knownKeys(value: Record<string, unknown>, permitted: string[]) {
  for (const key of Object.keys(value)) if (!permitted.includes(key)) throw new Error('checkpoint 包含不支持的字段');
}

function identifier(value: unknown, label: string, composite = false): string {
  const text = boundedText(value, label, 200, false);
  // Pi Responses joins call_id and output item ID with a pipe; other identifiers remain strict.
  if (!(composite ? /^[A-Za-z0-9][A-Za-z0-9._:|-]*$/ : /^[A-Za-z0-9][A-Za-z0-9._:-]*$/).test(text) || FORBIDDEN_KEYS.has(text.toLowerCase())) throw new Error(`${label}无效`);
  return text;
}

function boundedText(value: unknown, label: string, bytes: number, allowEmpty = true): string {
  if (typeof value !== 'string' || !allowEmpty && value.length === 0 || value.includes('\0') || Buffer.byteLength(value) > bytes) throw new Error(`${label}格式无效或超过长度上限`);
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('checkpoint 时间格式无效');
  return value;
}

function stringList(value: unknown, count: number, bytes: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > count) throw new Error(`${label}数量无效`);
  const strings = value.map((item) => boundedText(item, label, bytes, false));
  if (new Set(strings).size !== strings.length) throw new Error(`${label}重复`);
  return strings;
}

function jsonRecord(value: unknown, maxBytes: number): Record<string, unknown> {
  const source = record(value, 'JSON 参数');
  let nodes = 0;
  let bytes = 0;
  const account = (amount: number) => {
    bytes += amount;
    if (bytes > maxBytes) throw new Error('JSON 参数超过大小上限');
  };
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > 10_000 || depth > 20) throw new Error('JSON 参数结构超出上限');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) {
      account(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    if (typeof item === 'string') {
      const text = boundedText(item, 'JSON 文本', MAX_INPUT_BYTES);
      account(Buffer.byteLength(JSON.stringify(text)));
      return text;
    }
    if (Array.isArray(item)) {
      account(2 + Math.max(0, item.length - 1));
      return item.map((part) => visit(part, depth + 1));
    }
    const object = record(item, 'JSON 参数');
    const copy: Record<string, unknown> = {};
    account(2);
    let entries = 0;
    for (const [key, part] of Object.entries(object)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase()) || key.includes('\0') || Buffer.byteLength(key) > 200) throw new Error('JSON 参数包含凭据或不安全字段');
      if (part !== undefined) {
        account(Buffer.byteLength(JSON.stringify(key)) + 1 + (entries++ > 0 ? 1 : 0));
        copy[key] = visit(part, depth + 1);
      }
    }
    return copy;
  };
  const result = visit(source, 0) as Record<string, unknown>;
  if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) throw new Error('JSON 参数超过大小上限');
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
