import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const LETTA_CONTEXT_SUITE = {
  id: 'letta-context' as const,
  name: 'Letta Context-Bench 文件检索',
  total: 100,
  defaultLimit: 3,
  description: '固定 filesystem-cloud 语料，跨 10 个完整文件检索与推理；采用官方 0 / 0.5 / 1 rubric，非 Filesystem v2 榜单。',
};

const REVISION = 'a96a3b63b206feef23af9237a1a64a93d1f52aef';
const SOURCE_PATH = 'libs/evals/harbor_adapters/contextbench/vendor';
const RAW_BASE = `https://raw.githubusercontent.com/langchain-ai/deepagents/${REVISION}/${SOURCE_PATH}/`;
const SOURCE_HASHES: Readonly<Record<string, string>> = Object.freeze({
  'filesystem_cloud.jsonl': 'f809bd45f7a22cb3bd4f3423bd9c4de8d40cc8bcbc2d1eddcd793ecb33f2a932',
  'rubric.txt': '9c124fc9cc34841d1bc0c601d13a96246986ca4caaa7730eb3abbd6e8761b385',
  LICENSE: '1639ff41bb09c4c10f97d8f1043d980670ca6ed25682bf09286a26c070549bc4',
  'files/addresses.txt': '71b2686aa482bee96e7b77554a8f68a639d77a81a883ac78c35baaee717b4705',
  'files/bank_accounts.txt': '230667663fb1b1d700e8136c0f5f7a65966a07e33776236675f4b8d49fde7cc0',
  'files/credit_cards.txt': '68451664f3dea44eb023d8719d9bdac48fdebc863b3784d7a285b113f22fb48e',
  'files/employments.txt': '77301b100025de3c534743376f4b148f514d0c69958d768637c91dc193f12544',
  'files/insurance_policies.txt': '9e601fa52a4624a1169bdd33b1e09f059a82f38caa1887e61e96302ad60ba122',
  'files/internet_accounts.txt': '009a948d6ca659281a5840b4a0d137474dd1eba44a0c04a395b0095223dc60a6',
  'files/medical_records.txt': '7feabab89682a87c6ac5e2a94f66ab375c7151ea33fab451b2ce6db3964f95b6',
  'files/people.txt': 'ec633879861d9c1b49c492b1d9c5656bcb1f22cebd54a3a2afcafab51c39ab97',
  'files/pets.txt': '49a8b9a01e32e94c71c3a1ac32d23d03fe1282938bd741a2b0bb48ec09cf3338',
  'files/vehicles.txt': 'c7ee984009861a10eabbce9ec0699bca4017a330b01740680ed6c8d9766c8e17',
});
const CORPUS_PATHS = Object.keys(SOURCE_HASHES).filter((name) => name.startsWith('files/'));
const ASSET_BYTE_LIMIT = 8 * 1024 * 1024;

export interface LettaContextFile { path: string; text: string }
export interface LettaContextCase { id: string; prompt: string; files: LettaContextFile[]; gold: unknown }
export interface LettaContextSource {
  revision: string;
  upstream: string;
  license: string;
  sourceFileHashes: Record<string, string>;
  selectedIds: string[];
  sampling: string;
  subsetSha256: string;
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > LETTA_CONTEXT_SUITE.total) {
    throw new RangeError('Letta Context-Bench 题数必须为 1 到 100 的整数。');
  }
}
function sha256(bytes: Uint8Array | string): string { return createHash('sha256').update(bytes).digest('hex'); }
function abortIfNeeded(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function privateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Letta 缓存目录不能为符号链接。');
}

async function boundedResponse(response: Response, signal?: AbortSignal): Promise<Buffer> {
  const declared = response.headers.get('content-length');
  if (declared && Number(declared) > ASSET_BYTE_LIMIT) throw new Error('Letta 数据文件超过大小限制。');
  if (!response.body) throw new Error('Letta 数据下载没有响应正文。');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      abortIfNeeded(signal);
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > ASSET_BYTE_LIMIT) throw new Error('Letta 数据文件超过大小限制。');
      chunks.push(part.value);
    }
    abortIfNeeded(signal);
    return Buffer.concat(chunks, bytes);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

async function loadAsset(root: string, asset: string, signal?: AbortSignal): Promise<string> {
  const expected = SOURCE_HASHES[asset];
  if (!expected) throw new Error('Letta 数据文件未在固定清单中。');
  abortIfNeeded(signal);
  const filename = path.join(root, asset);
  let bytes: Buffer | undefined;
  try {
    const stat = await lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Letta 缓存数据文件不能为符号链接。');
    if (stat.size > ASSET_BYTE_LIMIT) throw new Error('Letta 缓存文件超过大小限制。');
    const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { bytes = await file.readFile({ signal }); } finally { await file.close(); }
  } catch (error) {
    if (!hasCode(error, 'ENOENT')) throw error;
  }
  if (!bytes) {
    const response = await fetch(`${RAW_BASE}${asset}`, { signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Letta 数据下载失败（HTTP ${response.status}）。`);
    bytes = await boundedResponse(response, signal);
    if (sha256(bytes) !== expected) throw new Error('Letta 数据 SHA256 不匹配；未使用替代数据。');
    abortIfNeeded(signal);
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx', signal });
      abortIfNeeded(signal);
      await rename(temporary, filename);
    } finally { await rm(temporary, { force: true }); }
  }
  abortIfNeeded(signal);
  if (bytes.byteLength > ASSET_BYTE_LIMIT || sha256(bytes) !== expected) {
    // A corrupt cache is an error, rather than a silent dataset-version change or redownload.
    throw new Error('Letta 数据 SHA256 不匹配；未使用替代数据。');
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** Separates the official answer and route hints from everything the agent can read. */
export function parseLettaContextRecords(jsonl: string, files: LettaContextFile[], limit: number): LettaContextCase[] {
  validateLimit(limit);
  const records = jsonl.split('\n').filter((line) => line.trim() !== '');
  if (records.length !== LETTA_CONTEXT_SUITE.total) throw new Error('Letta 固定数据集必须包含 100 题。');
  const expectedFiles = CORPUS_PATHS.map((name) => name.slice('files/'.length));
  if (files.length !== expectedFiles.length || new Set(files.map((file) => file.path)).size !== files.length
    || files.some((file) => !expectedFiles.includes(file.path) || typeof file.text !== 'string')) {
    throw new Error('Letta 每题必须获得全部 10 个固定语料文件。');
  }
  return records.slice(0, limit).map((line, index) => {
    const record: unknown = JSON.parse(line);
    if (!record || typeof record !== 'object' || !('input' in record) || typeof record.input !== 'string'
      || !('ground_truth' in record) || typeof record.ground_truth !== 'string') {
      throw new Error('Letta 题目格式不合法。');
    }
    return { id: `cb-cloud-${index}`, prompt: record.input, files: files.map((file) => ({ ...file })), gold: record.ground_truth };
  });
}

export async function loadLettaContextCases(limit: number, options: { cacheDir: string; signal?: AbortSignal }): Promise<{
  source: LettaContextSource;
  cases: LettaContextCase[];
}> {
  validateLimit(limit);
  abortIfNeeded(options.signal);
  await privateDirectory(path.resolve(options.cacheDir));
  const cacheBase = await realpath(options.cacheDir);
  const suiteRoot = path.join(cacheBase, 'letta-context');
  await privateDirectory(suiteRoot);
  const root = path.join(suiteRoot, REVISION);
  await privateDirectory(root);
  await privateDirectory(path.join(root, 'files'));
  // Validate the dataset first; a corrupt or cancelled download never starts agent evaluation.
  const dataset = await loadAsset(root, 'filesystem_cloud.jsonl', options.signal);
  const [rubric, license, ...corpus] = await Promise.all([
    loadAsset(root, 'rubric.txt', options.signal),
    loadAsset(root, 'LICENSE', options.signal),
    ...CORPUS_PATHS.map((name) => loadAsset(root, name, options.signal)),
  ]);
  abortIfNeeded(options.signal);
  if (rubric !== LETTA_RUBRIC || !license.includes('Apache License')) throw new Error('Letta 评分协议或许可证不匹配。');
  const files = CORPUS_PATHS.map((name, index) => ({ path: name.slice('files/'.length), text: corpus[index] }));
  const cases = parseLettaContextRecords(dataset, files, limit);
  const selectedIds = cases.map((item) => item.id);
  const sourceFileHashes = { ...SOURCE_HASHES };
  return {
    source: {
      revision: REVISION,
      upstream: `https://github.com/langchain-ai/deepagents/tree/${REVISION}/${SOURCE_PATH}`,
      license: 'Apache-2.0; Letta letta-evals filesystem-cloud, preserved vendored LICENSE; not Filesystem v2',
      sourceFileHashes,
      selectedIds,
      sampling: `Fixed zero-based prefix ${limit}/100 of Letta filesystem-cloud; full 10-file corpus per task; one trial per task; no required_files / verification_query supplied to agent`,
      subsetSha256: sha256(JSON.stringify({ revision: REVISION, selectedIds, sourceFileHashes })),
    },
    cases,
  };
}

// Apache-2.0, from Letta letta-evals. Preserved license: licenses/Letta-Context-Apache-2.0.txt.
// Source: letta-leaderboard/filesystem-agent/rubric.txt, vendored at the pinned REVISION.
// Canonical rubric bytes and the complete downloaded LICENSE are checked above.
const LETTA_RUBRIC = `You are evaluating an AI agent's response to a data analysis question about synthetic people records stored in text files.

Question: {input}
Expected Answer: {ground_truth}
Agent's Submission: {submission}

## Task
The agent was asked to find specific information by reading and cross-referencing multiple text files (people.txt, pets.txt, vehicles.txt, bank_accounts.txt, credit_cards.txt, employments.txt, addresses.txt, insurance_policies.txt, internet_accounts.txt, medical_records.txt).

## Scoring

Rate the response **0.0**, **0.5**, or **1.0**:

### Score 1.0 — Correct
The agent's final answer matches the expected answer. Apply these equivalence rules:
- **Numeric formats are equivalent**: "$145,315.33" = "145315.33" = "$145315.33" = "145,315.33"
- **Number words are equivalent**: "2 dogs" = "two dogs" = "2"
- **Name matching is case-insensitive**: "john smith" = "John Smith"
- **Minor phrasing differences are OK**: "Risk manager" = "The job title is Risk manager" = "Their job title is risk manager"
- **Units can be implicit**: "4" = "4 vehicles" = "4 cars" (when the question asks about vehicles)
- If the expected answer is a person's name, accept the name anywhere in the response as correct

### Score 0.0 — Wrong
The agent gives a different answer than expected:
- Different name, different number, different value
- Agent says it cannot find the answer but the expected answer exists
- Agent provides a partial answer that misses the key value
- Agent gives multiple answers when only one is expected, and the correct one is not clearly identified as the final answer

### Score 0.5 — Refusal only
The agent explicitly refuses to answer (e.g., "I cannot help with that", "I don't have access") without attempting the task. This is ONLY for clear refusals, not for failed attempts.

## Important
- Focus on the FINAL answer the agent provides, not intermediate reasoning
- If the agent shows work and arrives at the correct answer, score 1.0 even if intermediate steps had errors
- If the agent shows work but arrives at a wrong answer, score 0.0 regardless of reasoning quality
- Do NOT give partial credit (0.25, 0.75, etc.) — only 0.0, 0.5, or 1.0

Provide only the numerical score (e.g., "1.0").
`;

export function makeLettaJudgePrompt(question: string, prediction: string, gold: unknown): string {
  if (typeof gold !== 'string') throw new TypeError('Letta gold 必须为独立的答案字符串。');
  const values: Record<string, string> = { input: question, ground_truth: gold, submission: prediction };
  // The sole protocol adaptation is JSON output; the official grading criteria stay verbatim.
  return LETTA_RUBRIC.replace('Provide only the numerical score (e.g., "1.0").',
    'Return only a JSON object with numeric "reward" (0.0, 0.5, or 1.0) and a string "rationale". Do not wrap it in Markdown.')
    .replace(/\{(input|ground_truth|submission)\}/g, (_match, key: string) => values[key]);
}

export function parseLettaReward(text: string): 0 | 0.5 | 1 | null {
  try {
    const value: unknown = JSON.parse(text.trim());
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('reward' in value)
      || Object.keys(value).some((key) => key !== 'reward' && key !== 'rationale')
      || ('rationale' in value && typeof value.rationale !== 'string')) return null;
    return value.reward === 0 || value.reward === 0.5 || value.reward === 1 ? value.reward : null;
  } catch { return null; }
}
