import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export const LONGHARNESS_SUITES = [
  { id: 'longharness-constraint', name: 'LongHarness 条件检索', total: 50, defaultLimit: 2, description: '160 人资料中的完整条件匹配集合；只读上下文检索轨。' },
  { id: 'longharness-memos', name: 'LongHarness 矛盾备忘录', total: 50, defaultLimit: 2, description: '700 份备忘录中的完整矛盾集合；只读上下文检索轨。' },
  { id: 'longharness-tracing', name: 'LongHarness 程序追踪', total: 50, defaultLimit: 2, description: '8 步依赖计算的最终结果与证据；只读上下文检索轨。' },
  { id: 'longharness-pairs', name: 'LongHarness 等价程序对', total: 50, defaultLimit: 2, description: '200 段程序中的完整等价配对集合；只读上下文检索轨。' },
] as const;
export type LongHarnessSuiteId = typeof LONGHARNESS_SUITES[number]['id'];

const TASKS: Record<LongHarnessSuiteId, string> = {
  'longharness-constraint': 'constraint-solving-search',
  'longharness-memos': 'outlier-memo-detection',
  'longharness-tracing': 'program-execution-tracing',
  'longharness-pairs': 'equivalent-program-pair-search',
};
export const LONGHARNESS_REVISION = '95c54a1646cc486f6702308a1e820cb361960fd4';
export const LONGHARNESS_MANIFEST_SHA256 = '28b7f2418982db028427f35fd79a119acf83b4a7c254b2ee69c9162e0c01df9a';
export const LONGHARNESS_CHECKSUMS_SHA256 = 'e0566948242e72918c760aa42e39c1bbbc38e59f5dbe2f416665da4e77b6f822';
const SOURCE = `https://huggingface.co/datasets/StringNLP/longharness/resolve/${LONGHARNESS_REVISION}/`;
const MANIFEST_LIMIT = 128 * 1024;
const CONTEXT_LIMIT = 8 * 1024 * 1024;
const GOLD_LIMIT = 32 * 1024;
const TRACING_INSTRUCTIONS_PATH = 'tasks/program-execution-tracing/README.md';
const TRACING_INSTRUCTIONS_SHA256 = '5e132a34f8793ce627acf02d0193d782de6d2c25af17489ab25b4fbf7c98991f';
const EVALUATION_PROTOCOL_PATH = 'README.md';
const EVALUATION_PROTOCOL_SHA256 = 'f5e0145805d15bcd6ecabdf1b0e957f6200ca8bf7fd73f5fe7da682e2192aefd';

export interface LongHarnessSource {
  revision: string;
  upstream: string;
  license: string;
  sourceFileHashes: Record<string, string>;
  selectedIds: string[];
  sampling: string;
  subsetSha256: string;
  adapterProtocol: 'longharness-task-contract-v3';
  promptSha256: Record<string, string>;
}
export interface LongHarnessCase {
  id: string;
  prompt: string;
  files: Array<{ path: string; text: string }>;
  gold: unknown;
  task: string;
}
interface ManifestRow {
  task: string;
  index: number;
  context_path: string;
  answer_path: string;
  context_bytes: number;
  context_sha256: string;
}

function sha256(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function abort(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('LongHarness 下载已取消。'); }
function sampleName(index: number): string { return `sample-${String(index).padStart(5, '0')}`; }

/** Structure validation remains separate from download integrity, so neither substitutes for the other. */
export function parseLongHarnessManifest(text: string): ManifestRow[] {
  const tasks = new Set(Object.values(TASKS));
  const keys = new Set<string>();
  const rows: ManifestRow[] = [];
  for (const line of text.split('\n').filter((line) => line.trim())) {
    const value: unknown = JSON.parse(line);
    if (!record(value) || typeof value.task !== 'string' || !tasks.has(value.task) || !Number.isSafeInteger(value.index) || (value.index as number) < 0 || (value.index as number) >= 50
      || !Number.isSafeInteger(value.context_bytes) || (value.context_bytes as number) < 1 || (value.context_bytes as number) > CONTEXT_LIMIT
      || typeof value.context_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.context_sha256)) throw new Error('LongHarness manifest 结构无效。');
    const name = sampleName(value.index as number);
    if (value.context_path !== `tasks/${value.task}/contexts/${name}.md` || value.answer_path !== `tasks/${value.task}/answers/${name}.json`) throw new Error('LongHarness manifest 路径无效。');
    const key = `${value.task}:${value.index}`;
    if (keys.has(key)) throw new Error('LongHarness manifest 包含重复题目。');
    keys.add(key);
    rows.push(value as unknown as ManifestRow);
  }
  if (rows.length !== 200 || [...tasks].some((task) => rows.filter((row) => row.task === task).length !== 50)) throw new Error('LongHarness manifest 不包含完整 200 题。');
  return rows;
}

function parseChecksums(text: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of text.split('\n').filter((line) => line.trim())) {
    const parsed = /^([a-f0-9]{64}) {2}([a-zA-Z0-9_./-]+)$/.exec(line);
    if (!parsed || parsed[2].split('/').some((part) => part === '..' || part === '') || parsed[2].startsWith('/') || result.has(parsed[2])) throw new Error('LongHarness checksum 结构无效。');
    result.set(parsed[2], parsed[1]);
  }
  return result;
}

async function cacheRoot(cacheDir: string): Promise<string> {
  await mkdir(cacheDir, { recursive: true, mode: 0o700 });
  if (!(await lstat(cacheDir)).isDirectory() || (await lstat(cacheDir)).isSymbolicLink()) throw new Error('LongHarness 缓存目录必须是普通目录。');
  const parent = await realpath(cacheDir);
  const directory = path.join(parent, `longharness-${LONGHARNESS_REVISION}`);
  await mkdir(directory, { recursive: false, mode: 0o700 }).catch((error: unknown) => {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  });
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('LongHarness 缓存目录不能是符号链接。');
  return directory;
}

async function cachedBytes(filename: string, limit: number): Promise<Buffer | null> {
  let file;
  try { file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw new Error('LongHarness 缓存文件不能安全读取。');
  }
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size > limit || (await lstat(filename)).isSymbolicLink()) throw new Error('LongHarness 缓存文件类型或大小无效。');
    const bytes = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    if (offset !== info.size) throw new Error('LongHarness 缓存文件在读取期间改变。');
    return bytes.subarray(0, offset);
  } finally { await file.close(); }
}

async function fetchBytes(relativePath: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
  abort(signal);
  const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000);
  const response = await fetch(`${SOURCE}${relativePath}`, { signal: combined });
  if (!response.ok || !response.body) throw new Error('LongHarness 官方数据下载失败；没有可报告的成绩。');
  const announced = response.headers.get('content-length');
  if (announced && Number(announced) > limit) { await response.body.cancel(); throw new Error('LongHarness 数据超过大小限制。'); }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      abort(signal);
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new Error('LongHarness 数据超过大小限制。');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

async function verifiedFile(directory: string, relativePath: string, expectedHash: string, limit: number, signal?: AbortSignal): Promise<Buffer> {
  abort(signal);
  // Cache names contain only content digests. Upstream paths never become local paths.
  const filename = path.join(directory, expectedHash);
  let bytes = await cachedBytes(filename, limit);
  if (bytes && sha256(bytes) !== expectedHash) throw new Error('LongHarness 缓存校验失败；没有可报告的成绩。');
  if (bytes) return bytes;
  bytes = await fetchBytes(relativePath, limit, signal);
  if (sha256(bytes) !== expectedHash) throw new Error('LongHarness 下载校验失败；没有可报告的成绩。');
  abort(signal);
  if ((await lstat(directory)).isSymbolicLink() || await realpath(directory) !== directory) throw new Error('LongHarness 缓存目录已改变。');
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try { await file.writeFile(bytes); } finally { await file.close(); }
    abort(signal);
    await rename(temporary, filename);
  } finally { await unlink(temporary).catch(() => undefined); }
  return bytes;
}

function decode(bytes: Buffer): string {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('LongHarness 数据不是有效 UTF-8。'); }
}

export function buildLongHarnessPrompt(task: string, context: string): string {
  const query = context.lastIndexOf('### Final Query');
  const packet = context.indexOf('Memo packet:');
  const instruction = task === 'outlier-memo-detection' ? packet >= 0 ? context.slice(0, packet) : '' : query >= 0 ? context.slice(query) : '';
  if (!instruction.trim()) throw new Error('LongHarness 原题任务说明缺失。');
  if (task !== TASKS['longharness-tracing']) return instruction.trim();
  // The pinned public task and root READMEs define answer as an object, plus eight
  // supporting cells. Their complete examples remain audit-only, outside this prompt.
  return `${instruction.trim()}\n\n### Public task output contract\nReturn only one JSON object with exactly two keys: "answer" and "evidence". "answer" must be a JSON object containing the final value of the query variable "out", with its original field and value types. Do not JSON-encode that object into a string or use quoted printed stdout as "answer". "evidence" must be an array of eight distinct integer cell IDs from the earlier computation records, supporting the eight query steps. For each step, identify the semantically equivalent earlier function whose recorded call has the required input. Both the final output object and the complete supporting-cell set are required. Do not execute the query, include explanations, or return a task/index/prediction envelope.`;
}

export async function loadLongHarnessCases(suite: LongHarnessSuiteId, limit: number, options: { cacheDir: string; signal?: AbortSignal }): Promise<{ source: LongHarnessSource; cases: LongHarnessCase[] }> {
  if (!Object.hasOwn(TASKS, suite) || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('LongHarness 评测支持每套 1 至 50 题。');
  abort(options.signal);
  const directory = await cacheRoot(options.cacheDir);
  const manifest = await verifiedFile(directory, 'manifest.jsonl', LONGHARNESS_MANIFEST_SHA256, MANIFEST_LIMIT, options.signal);
  const checksumsBytes = await verifiedFile(directory, 'DATA_CHECKSUMS.sha256', LONGHARNESS_CHECKSUMS_SHA256, MANIFEST_LIMIT, options.signal);
  const rows = parseLongHarnessManifest(decode(manifest));
  const checksums = parseChecksums(decode(checksumsBytes));
  const selected = rows.filter((row) => row.task === TASKS[suite]).sort((a, b) => a.index - b.index).slice(0, limit);
  const sourceFileHashes: Record<string, string> = { 'manifest.jsonl': LONGHARNESS_MANIFEST_SHA256, 'DATA_CHECKSUMS.sha256': LONGHARNESS_CHECKSUMS_SHA256 };
  if (suite === 'longharness-tracing') {
    // Keep the official instructions outside the distributed application, like the data.
    await verifiedFile(directory, TRACING_INSTRUCTIONS_PATH, TRACING_INSTRUCTIONS_SHA256, GOLD_LIMIT, options.signal);
    // The root README contains answer examples for other tasks. Validate it for
    // source audit only; never append its bytes or example values to a model prompt.
    await verifiedFile(directory, EVALUATION_PROTOCOL_PATH, EVALUATION_PROTOCOL_SHA256, GOLD_LIMIT, options.signal);
    sourceFileHashes[TRACING_INSTRUCTIONS_PATH] = TRACING_INSTRUCTIONS_SHA256;
    sourceFileHashes[EVALUATION_PROTOCOL_PATH] = EVALUATION_PROTOCOL_SHA256;
  }
  const cases: LongHarnessCase[] = [];
  for (const row of selected) {
    abort(options.signal);
    const goldHash = checksums.get(row.answer_path);
    if (!goldHash || checksums.get(row.context_path) !== row.context_sha256) throw new Error('LongHarness 文件 checksum 不完整或不一致。');
    const bytes = await verifiedFile(directory, row.context_path, row.context_sha256, CONTEXT_LIMIT, options.signal);
    if (bytes.length !== row.context_bytes) throw new Error('LongHarness 上下文字节数不一致。');
    const goldBytes = await verifiedFile(directory, row.answer_path, goldHash, GOLD_LIMIT, options.signal);
    const context = decode(bytes);
    const gold: unknown = JSON.parse(decode(goldBytes));
    if (!record(gold) || gold.task !== row.task || gold.schema_version !== 1 || !validGold(row.task, gold)) throw new Error('LongHarness 答案结构无效。');
    sourceFileHashes[row.context_path] = row.context_sha256;
    sourceFileHashes[row.answer_path] = goldHash;
    cases.push({ id: `${row.task}_${String(row.index).padStart(5, '0')}`, task: row.task, prompt: buildLongHarnessPrompt(row.task, context), files: [{ path: 'context.md', text: context }], gold });
  }
  return { source: { revision: LONGHARNESS_REVISION, upstream: `https://huggingface.co/datasets/StringNLP/longharness/tree/${LONGHARNESS_REVISION}`,
    license: '未声明；仅下载用于评测，不分发数据', sourceFileHashes, selectedIds: cases.map((item) => item.id),
    adapterProtocol: 'longharness-task-contract-v3', promptSha256: Object.fromEntries(cases.map((item) => [item.id, sha256(item.prompt)])),
    sampling: `Official sample indices 0..${limit - 1}; fixed prefix of ${TASKS[suite]} (50 instances); read-only context access, not the paper's full shell-enabled configuration`,
    subsetSha256: sha256(JSON.stringify(selected.map((row) => ({ task: row.task, index: row.index, context_sha256: row.context_sha256, answer_sha256: checksums.get(row.answer_path) })))) }, cases };
}

function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === 'string'); }
function integers(value: unknown): value is number[] { return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item)); }
function pairList(value: unknown): value is number[][] { return Array.isArray(value) && value.every((pair) => integers(pair) && pair.length === 2 && pair[0] !== pair[1]); }
function validGold(task: string, gold: Record<string, unknown>): boolean {
  if (task === TASKS['longharness-constraint']) return strings(gold.matches);
  if (task === TASKS['longharness-memos']) return strings(gold.memo_ids);
  if (task === TASKS['longharness-pairs']) return pairList(gold.expected_pairs);
  if (task === TASKS['longharness-tracing']) return record(gold.answer) && integers(gold.evidence);
  return false;
}
function sameSet(left: readonly (string | number)[], right: readonly (string | number)[]): boolean {
  const a = new Set(left); const b = new Set(right);
  return a.size === b.size && [...a].every((item) => b.has(item));
}
function sameJSON(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((item, index) => sameJSON(item, right[index]));
  if (record(left) && record(right)) return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => Object.hasOwn(right, key) && sameJSON(value, right[key]));
  return left === right;
}

function parsePrediction(text: string, task: string): { parsed: boolean; value?: unknown } {
  let candidate = text.trim();
  const fence = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(candidate);
  if (fence) candidate = fence[1].trim();
  if (task === TASKS['longharness-memos']) {
    const final = /^Final Answer:\s*(\[[\s\S]*\])$/i.exec(candidate);
    if (final) {
      candidate = final[1];
      // The released memo instructions use bare M-### identifiers, not JSON strings.
      if (/^\[\s*(?:M-\d{3}(?:\s*,\s*M-\d{3})*)?\s*\]$/.test(candidate)) candidate = candidate.replace(/M-\d{3}/g, (id) => JSON.stringify(id));
    }
  }
  try { return { parsed: true, value: JSON.parse(candidate) as unknown }; }
  catch { return { parsed: false }; }
}

export interface LongHarnessScore { passed: boolean; answerExact: boolean; evidenceExact?: boolean; formatValid: boolean; error?: string }
export function scoreLongHarness(task: string, text: string, gold: unknown): LongHarnessScore {
  if (!record(gold) || !validGold(task, gold)) return { passed: false, answerExact: false, formatValid: false, error: '答案键或任务类型无效。' };
  const parsed = parsePrediction(text, task);
  if (!parsed.parsed) return { passed: false, answerExact: false, formatValid: false, error: '作答不是原题要求的 JSON 或 Final Answer 格式。' };
  const value = parsed.value;
  let formatValid = false;
  let answerExact = false;
  let evidenceExact: boolean | undefined;
  if (task === TASKS['longharness-constraint']) {
    formatValid = record(value) && strings(value.matches);
    if (formatValid) answerExact = sameSet((value as { matches: string[] }).matches, gold.matches as string[]);
  } else if (task === TASKS['longharness-memos']) {
    formatValid = strings(value);
    if (formatValid) answerExact = new Set(value as string[]).size === (value as string[]).length && sameSet(value as string[], gold.memo_ids as string[]);
  } else if (task === TASKS['longharness-pairs']) {
    formatValid = pairList(value);
    const canonical = (pairs: number[][]) => pairs.map((pair) => [...pair].sort((a, b) => a - b)).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (formatValid) answerExact = sameJSON(canonical(value as number[][]), canonical(gold.expected_pairs as number[][]));
  } else {
    formatValid = record(value) && record(value.answer) && integers(value.evidence);
    answerExact = record(value) && sameJSON(value.answer, gold.answer);
    evidenceExact = record(value) && integers(value.evidence) && new Set(value.evidence).size === value.evidence.length && sameSet(value.evidence, gold.evidence as number[]);
  }
  const passed = answerExact && (evidenceExact ?? true) && formatValid;
  return { passed, answerExact, ...(evidenceExact !== undefined ? { evidenceExact } : {}), formatValid,
    ...(!passed ? { error: formatValid ? '作答未满足完整实例的 exact 规则。' : '作答字段不符合原题输出结构。' } : {}) };
}
