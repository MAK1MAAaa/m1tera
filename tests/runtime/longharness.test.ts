import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LONGHARNESS_MANIFEST_SHA256, LONGHARNESS_REVISION, LONGHARNESS_SUITES,
  buildLongHarnessPrompt, loadLongHarnessCases, parseLongHarnessManifest, scoreLongHarness,
} from '../../benchmarks/longharness.js';

const tasks = ['constraint-solving-search', 'outlier-memo-detection', 'program-execution-tracing', 'equivalent-program-pair-search'];
const directories: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function directory() { const value = await mkdtemp(path.join(os.tmpdir(), 'm1tera-longharness-test-')); directories.push(value); return value; }
function manifest() {
  return tasks.flatMap((task) => Array.from({ length: 50 }, (_, index) => ({ task, index, context_bytes: 100,
    context_sha256: 'a'.repeat(64), context_path: `tasks/${task}/contexts/sample-${String(index).padStart(5, '0')}.md`,
    answer_path: `tasks/${task}/answers/sample-${String(index).padStart(5, '0')}.json` })));
}
function lines(rows: unknown[]) { return rows.map((row) => JSON.stringify(row)).join('\n'); }

describe('LongHarness fixed-release loading guards', () => {
  it('publishes four separately selectable official task suites with conservative default limits', () => {
    expect(LONGHARNESS_SUITES.map((item) => item.id)).toEqual(['longharness-constraint', 'longharness-memos', 'longharness-tracing', 'longharness-pairs']);
    expect(LONGHARNESS_SUITES.every((item) => item.total === 50 && item.defaultLimit === 2)).toBe(true);
    expect(LONGHARNESS_REVISION).toBe('95c54a1646cc486f6702308a1e820cb361960fd4');
  });

  it('validates the official 200-row metadata structure without exposing answers', () => {
    const parsed = parseLongHarnessManifest(lines(manifest()));
    expect(parsed).toHaveLength(200);
    expect(parsed[0]).toMatchObject({ index: 0, task: tasks[0], context_path: 'tasks/constraint-solving-search/contexts/sample-00000.md' });
    expect(JSON.stringify(parsed)).not.toContain('matches');
  });

  it.each(['../answers/sample-00000.json', '/private/key', 'tasks/constraint-solving-search/contexts/../../secret', 'https://other.example/context'])('rejects unsafe or unexpected manifest context paths: %s', (value) => {
    const rows = manifest(); rows[0].context_path = value;
    expect(() => parseLongHarnessManifest(lines(rows))).toThrow('路径');
  });

  it.each([
    ['duplicate ID', (rows: ReturnType<typeof manifest>) => { rows[1] = rows[0]; }, '重复'],
    ['missing row', (rows: ReturnType<typeof manifest>) => { rows.pop(); }, '200'],
    ['unknown task', (rows: ReturnType<typeof manifest>) => { rows[0].task = 'not-a-task'; }, '结构'],
    ['out-of-range index', (rows: ReturnType<typeof manifest>) => { rows[0].index = 50; }, '结构'],
    ['excess context size', (rows: ReturnType<typeof manifest>) => { rows[0].context_bytes = 9 * 1024 * 1024; }, '结构'],
    ['invalid digest', (rows: ReturnType<typeof manifest>) => { rows[0].context_sha256 = 'not-a-digest'; }, '结构'],
    ['answer path mismatch', (rows: ReturnType<typeof manifest>) => { rows[0].answer_path = 'tasks/constraint-solving-search/answers/sample-00001.json'; }, '路径'],
  ])('rejects %s metadata before task downloads', (_name, change, message) => {
    const rows = manifest(); change(rows);
    expect(() => parseLongHarnessManifest(lines(rows))).toThrow(message);
  });

  it.each([0, -1, 51, 1.5, NaN])('rejects invalid limit %s before contacting a public source', async (limit) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-tracing', limit, { cacheDir: '/unused' })).rejects.toThrow('1 至 50');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an unsupported suite without downloading data', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('unknown' as 'longharness-tracing', 1, { cacheDir: '/unused' })).rejects.toThrow('1 至 50');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not begin a cancelled download or create a fallback fixture result', async () => {
    const controller = new AbortController(); controller.abort();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-memos', 1, { cacheDir: '/unused', signal: controller.signal })).rejects.toThrow('取消');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops on a failed public source response with no synthetic data', async () => {
    const fetch = vi.fn<(input: string) => Promise<Response>>(async () => new Response('not available', { status: 503 })); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-tracing', 1, { cacheDir: await directory() })).rejects.toThrow('下载失败');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String(fetch.mock.calls[0]?.[0] ?? '')).not.toContain('answers');
  });

  it('checks downloaded manifest bytes against the pinned SHA before trusting JSON', async () => {
    const fetch = vi.fn(async () => new Response(lines(manifest()))); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-constraint', 1, { cacheDir: await directory() })).rejects.toThrow('下载校验');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses corrupted cached metadata instead of using it or silently replacing it', async () => {
    const cacheDir = await directory();
    const release = path.join(cacheDir, `longharness-${LONGHARNESS_REVISION}`);
    await mkdir(release); await writeFile(path.join(release, LONGHARNESS_MANIFEST_SHA256), lines(manifest()));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-pairs', 1, { cacheDir })).rejects.toThrow('缓存校验');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a symlinked release cache before opening any files', async () => {
    const cacheDir = await directory(); const target = await directory();
    await symlink(target, path.join(cacheDir, `longharness-${LONGHARNESS_REVISION}`), 'dir');
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-pairs', 1, { cacheDir })).rejects.toThrow('符号链接');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('refuses a symlinked cached digest instead of following it outside the release', async () => {
    const cacheDir = await directory(); const target = path.join(await directory(), 'public-fixture');
    const release = path.join(cacheDir, `longharness-${LONGHARNESS_REVISION}`);
    await mkdir(release); await writeFile(target, 'outside fixture');
    await symlink(target, path.join(release, LONGHARNESS_MANIFEST_SHA256));
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLongHarnessCases('longharness-pairs', 1, { cacheDir })).rejects.toThrow('安全读取');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('limits untrusted streamed metadata rather than buffering arbitrary response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('a'.repeat(128 * 1024 + 1))));
    await expect(loadLongHarnessCases('longharness-tracing', 1, { cacheDir: await directory() })).rejects.toThrow('大小限制');
  });
});

describe('LongHarness public task prompt contract', () => {
  it('supplements the real tracing context shape with both answer and eight-cell evidence requirements', () => {
    const query = '### Final Query\n\nGive me the output of the final query without executing it!\n\n```python\nimport json\nout = {"total": 4}\nprint(json.dumps(out))\n```';
    const context = `### 001\n\nSYNTHETIC_CONTEXT_RECORD_NOT_A_GOLD_KEY\n\n${query}\n`;
    const prompt = buildLongHarnessPrompt('program-execution-tracing', context);
    expect(prompt.startsWith(query)).toBe(true);
    expect(prompt).toContain('without executing it');
    expect(prompt).toContain('exactly two keys: "answer" and "evidence"');
    expect(prompt).toContain('"answer" must be a JSON object containing the final value of the query variable "out"');
    expect(prompt).toContain('Do not JSON-encode that object into a string or use quoted printed stdout as "answer"');
    expect(prompt).toContain('eight distinct integer cell IDs');
    expect(prompt).toContain('semantically equivalent earlier function whose recorded call has the required input');
    expect(prompt).toContain('Both the final output object and the complete supporting-cell set are required');
    expect(prompt).not.toContain('SYNTHETIC_CONTEXT_RECORD_NOT_A_GOLD_KEY');
  });

  it('applies the same contract to different tracing queries without adding sample-dependent answers or evidence', () => {
    const first = buildLongHarnessPrompt('program-execution-tracing', '### Final Query\n```python\nprint({"total": 4})\n```');
    const second = buildLongHarnessPrompt('program-execution-tracing', '### Final Query\n```python\nprint({"path": ["B", "C"]})\n```');
    const contract = first.slice(first.indexOf('### Public task output contract'));
    expect(second.slice(second.indexOf('### Public task output contract'))).toBe(contract);
    expect(contract).not.toContain('"total"');
    expect(contract).not.toContain('"path"');
    expect(contract).not.toMatch(/\[\s*\d+(?:\s*,\s*\d+)+\s*\]/);
  });

  it.each([
    ['constraint-solving-search', '# Community Records\nCONTEXT\n\n### Final Query\nReturn a JSON object with key matches and all qualifying IDs, sorted lexicographically.\n', '### Final Query\nReturn a JSON object with key matches and all qualifying IDs, sorted lexicographically.'],
    ['equivalent-program-pair-search', '### 001\nCODE\n\n### Final Query\nReturn every disjoint equivalent pair as an array of integer pairs, sorted numerically.\n', '### Final Query\nReturn every disjoint equivalent pair as an array of integer pairs, sorted numerically.'],
    ['outlier-memo-detection', 'Exactly 15 memos conflict with the other records.\nReturn only Final Answer: [M-001, M-002, M-003]\n\nMemo packet:\nM-001\nSYNTHETIC_RECORD', 'Exactly 15 memos conflict with the other records.\nReturn only Final Answer: [M-001, M-002, M-003]'],
  ])('preserves the complete existing %s prompt byte for byte', (task, context, originalPrompt) => {
    expect(buildLongHarnessPrompt(task, context)).toBe(originalPrompt);
  });

  it('fails when tracing or memo task instructions are absent instead of using the context as an incomplete task', () => {
    expect(() => buildLongHarnessPrompt('program-execution-tracing', '### 001\nOnly a computation record')).toThrow('任务说明缺失');
    expect(() => buildLongHarnessPrompt('outlier-memo-detection', 'M-001\nOnly a memo')).toThrow('任务说明缺失');
  });
});

describe('LongHarness exact rules and released response formats', () => {
  const constraint = { matches: ['P-001', 'P-002'] };
  const memos = { memo_ids: ['M-001', 'M-003'] };
  const pairs = { expected_pairs: [[2, 3], [7, 9]] };
  const tracing = { answer: { list: [1, 2], counts: { A: 0, B: 1 } }, evidence: [1, 8] };

  it.each([
    ['constraint-solving-search', '{"matches":["P-002","P-001"]}', constraint],
    ['constraint-solving-search', '{"matches":["P-001","P-002","P-001"]}', constraint],
    ['outlier-memo-detection', '["M-003","M-001"]', memos],
    ['outlier-memo-detection', 'Final Answer: [M-003, M-001]', memos],
    ['outlier-memo-detection', 'Final Answer: ["M-001", "M-003"]', memos],
    ['equivalent-program-pair-search', '[[9,7],[3,2]]', pairs],
    ['program-execution-tracing', '{"answer":{"counts":{"B":1,"A":0},"list":[1,2]},"evidence":[8,1]}', tracing],
  ])('matches official exact semantics for %s response %s', (task, text, gold) => {
    expect(scoreLongHarness(task, text, gold)).toMatchObject({ passed: true, answerExact: true, formatValid: true });
  });

  it.each([
    ['constraint-solving-search', '{"matches":["P-001"]}', constraint],
    ['constraint-solving-search', '{"matches":["P-001","P-002","P-003"]}', constraint],
    ['constraint-solving-search', '{"matches":["p-001","P-002"]}', constraint],
    ['outlier-memo-detection', '["M-001","M-003","M-003"]', memos],
    ['outlier-memo-detection', '["M-001"]', memos],
    ['equivalent-program-pair-search', '[[2,3]]', pairs],
    ['equivalent-program-pair-search', '[[2,3],[7,9],[7,9]]', pairs],
    ['program-execution-tracing', '{"answer":{"counts":{"A":0,"B":1},"list":[2,1]},"evidence":[1,8]}', tracing],
    ['program-execution-tracing', '{"answer":{"counts":{"A":0,"B":1},"list":[1,2]},"evidence":[1,8,8]}', tracing],
    ['program-execution-tracing', '{"answer":{"counts":{"A":0,"B":1},"list":[1,2]},"evidence":[1]}', tracing],
  ])('does not turn partial, extra or wrong values into exact success for %s', (task, text, gold) => {
    expect(scoreLongHarness(task, text, gold).passed).toBe(false);
  });

  it.each(['[[2,2],[7,9]]', '[[2,"3"],[7,9]]', '[[2,3.1],[7,9]]', '[[2,true],[7,9]]', '[[2,3,4],[7,9]]', '{"pairs":[[2,3],[7,9]]}'])('rejects malformed pair schema %s', (text) => {
    expect(scoreLongHarness('equivalent-program-pair-search', text, pairs)).toMatchObject({ passed: false, formatValid: false });
  });

  it('exposes answer-only tracing success without hiding missing or wrong evidence', () => {
    expect(scoreLongHarness('program-execution-tracing', JSON.stringify({ answer: tracing.answer, evidence: [2, 9] }), tracing))
      .toMatchObject({ passed: false, answerExact: true, evidenceExact: false, formatValid: true });
  });

  it('requires the disclosed tracing answer object and keeps encoded-string scoring strict even with correct evidence', () => {
    const gold = { answer: { total: 4, path: ['A', 'B'] }, evidence: [1, 2, 3, 4, 5, 6, 7, 8] };
    const object = JSON.stringify({ answer: gold.answer, evidence: gold.evidence });
    const printedString = JSON.stringify({ answer: JSON.stringify(gold.answer), evidence: gold.evidence });
    expect(scoreLongHarness('program-execution-tracing', object, gold)).toMatchObject({ passed: true, answerExact: true, evidenceExact: true, formatValid: true });
    expect(scoreLongHarness('program-execution-tracing', printedString, gold)).toMatchObject({ passed: false, answerExact: false, evidenceExact: true, formatValid: false });
  });

  it('accepts one complete JSON fence and rejects extra explanatory text or extra responses', () => {
    expect(scoreLongHarness('constraint-solving-search', '```json\n{"matches":["P-001","P-002"]}\n```', constraint).passed).toBe(true);
    expect(scoreLongHarness('constraint-solving-search', 'Answer: {"matches":["P-001","P-002"]}', constraint).formatValid).toBe(false);
    expect(scoreLongHarness('constraint-solving-search', '{"matches":["P-001","P-002"]}\n{"matches":[]}', constraint).formatValid).toBe(false);
  });

  it('never parses arbitrary Python expressions or surrounding prose in released memo syntax', () => {
    expect(scoreLongHarness('outlier-memo-detection', 'Final Answer: [M-001, __import__("os")]', memos).formatValid).toBe(false);
    expect(scoreLongHarness('outlier-memo-detection', 'I found them. Final Answer: [M-001, M-003]', memos).formatValid).toBe(false);
  });

  it.each([
    ['constraint-solving-search', '{"matches":[1,2]}', constraint],
    ['outlier-memo-detection', '[1,3]', memos],
    ['program-execution-tracing', '{"answer":{"list":[1,2],"counts":{"A":0,"B":1}},"evidence":["1","8"]}', tracing],
  ])('does not coerce response types for %s', (task, text, gold) => {
    expect(scoreLongHarness(task, text, gold)).toMatchObject({ passed: false, formatValid: false });
  });

  it('returns a diagnostic for invalid gold or unknown task instead of inventing a valid score', () => {
    expect(scoreLongHarness('unknown', '[]', memos)).toMatchObject({ passed: false, formatValid: false, error: '答案键或任务类型无效。' });
    expect(scoreLongHarness('outlier-memo-detection', '[]', null)).toMatchObject({ passed: false, formatValid: false });
  });
});
