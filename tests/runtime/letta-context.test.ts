import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  LETTA_CONTEXT_SUITE, loadLettaContextCases, makeLettaJudgePrompt, parseLettaContextRecords, parseLettaReward,
} from '../../benchmarks/letta-context.js';
import type { LettaContextFile } from '../../benchmarks/letta-context.js';

const REVISION = 'a96a3b63b206feef23af9237a1a64a93d1f52aef';
const directories: string[] = [];
const filenames = ['addresses', 'bank_accounts', 'credit_cards', 'employments', 'insurance_policies',
  'internet_accounts', 'medical_records', 'people', 'pets', 'vehicles'].map((name) => `${name}.txt`);
const files: LettaContextFile[] = filenames.map((name) => ({ path: name, text: `Synthetic ${name} contents` }));
function syntheticDataset() {
  return Array.from({ length: 100 }, (_, index) => JSON.stringify({
    input: `Synthetic cross-file question ${index}?`, ground_truth: `hidden-answer-${index}`,
    agent_args: { extra: { required_files: ['hint-secret'], verification_query: 'hidden-route-query' } },
  })).join('\n');
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-letta-context-'));
  directories.push(directory);
  return { directory, cache: path.join(directory, 'letta-context', REVISION) };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('Letta filesystem-cloud data isolation', () => {
  it('projects original questions and the full ten-file corpus while hiding gold and retrieval hints', () => {
    const cases = parseLettaContextRecords(syntheticDataset(), files, 3);
    expect(cases.map((item) => item.id)).toEqual(['cb-cloud-0', 'cb-cloud-1', 'cb-cloud-2']);
    expect(cases[0].gold).toBe('hidden-answer-0');
    const visible = JSON.stringify(cases.map(({ prompt, files }) => ({ prompt, files })));
    expect(visible).not.toMatch(/hidden-answer|hint-secret|hidden-route-query|required_files|verification_query/);
    expect(cases[0].files.map((file) => file.path)).toEqual(filenames);
    expect(cases[0].files).toHaveLength(10);
    cases[0].files[0].text = 'changed';
    expect(cases[1].files[0].text).toBe(files[0].text);
    expect(files[0].text).toBe('Synthetic addresses.txt contents');
  });

  it('treats an arbitrary route hint as hidden metadata rather than rewriting the official question', () => {
    const rows = syntheticDataset().split('\n');
    rows[0] = JSON.stringify({ input: 'Literal {ground_truth} stays part of the question.', ground_truth: 'secret',
      agent_args: { extra: { required_files: ['../escape'], verification_query: 'SELECT secret' } } });
    const [result] = parseLettaContextRecords(rows.join('\n'), files, 1);
    expect(result.prompt).toBe('Literal {ground_truth} stays part of the question.');
    expect(Object.keys(result).sort()).toEqual(['files', 'gold', 'id', 'prompt']);
  });

  it.each([0, -1, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid limit %s before downloading', async (limit) => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { directory } = await fixture();
    expect(() => parseLettaContextRecords(syntheticDataset(), files, limit)).toThrow('题数');
    await expect(loadLettaContextCases(limit, { cacheDir: directory })).rejects.toThrow('题数');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects incomplete data and missing, duplicate or traversing corpus paths', () => {
    expect(() => parseLettaContextRecords(syntheticDataset().split('\n').slice(1).join('\n'), files, 1)).toThrow('100');
    expect(() => parseLettaContextRecords(syntheticDataset(), files.slice(1), 1)).toThrow('10');
    expect(() => parseLettaContextRecords(syntheticDataset(), [files[0], ...files.slice(0, 9)], 1)).toThrow('10');
    expect(() => parseLettaContextRecords(syntheticDataset(), [{ path: '../secret', text: 'private' }, ...files.slice(1)], 1)).toThrow('10');
    const rows = syntheticDataset().split('\n'); rows[0] = JSON.stringify({ input: 'Question', ground_truth: { answer: 'secret' } });
    expect(() => parseLettaContextRecords(rows.join('\n'), files, 1)).toThrow('格式');
  });
});

describe('canonical Letta rubric and strict rewards', () => {
  it('uses official final-answer and refusal rules with JSON output, and leaves untrusted placeholders uninterpreted', () => {
    const prompt = makeLettaJudgePrompt('Question {submission}', 'Answer {ground_truth} $&', 'expected-answer');
    expect(prompt).toContain('Question: Question {submission}');
    expect(prompt).toContain('Agent\'s Submission: Answer {ground_truth} $&');
    expect(prompt).toContain('Expected Answer: expected-answer');
    expect(prompt).toContain('This is ONLY for clear refusals, not for failed attempts.');
    expect(prompt).toContain('Focus on the FINAL answer');
    expect(prompt).toContain('Do NOT give partial credit (0.25, 0.75, etc.)');
    expect(prompt).toContain('numeric "reward" (0.0, 0.5, or 1.0)');
    expect(() => makeLettaJudgePrompt('Question', 'Answer', { ground_truth: 'wrong object' })).toThrow('字符串');
  });

  it.each([0, 0.5, 1] as const)('accepts numeric reward %s without mapping refusal to a successful task', (reward) => {
    expect(parseLettaReward(JSON.stringify({ reward, rationale: 'rubric' }))).toBe(reward);
    expect(parseLettaReward(` \n${JSON.stringify({ reward })}\n `)).toBe(reward);
  });

  it.each(['1.0', 'A', 'reward=1', '{"reward":"1"}', '{"reward":true}', '{"reward":0.25}',
    '{"reward":0.75}', '{"reward":-1}', '{"reward":2}', '{"score":1}', '{"reward":null}',
    '{"reward":1,"rationale":false}', '{"reward":1,"extra":1}', '```json\n{"reward":1}\n```',
    '{"reward":1} trailing', '[{"reward":1}]', 'null'])('keeps invalid grader output unknown: %s', (text) => {
    expect(parseLettaReward(text)).toBeNull();
  });
});

describe('fixed revision download and protected external cache', () => {
  it('rejects SHA mismatches from a synthetic download without writing a cache or starting another request', async () => {
    const fetch = vi.fn(async () => new Response(syntheticDataset())); vi.stubGlobal('fetch', fetch);
    const { directory, cache } = await fixture();
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('SHA256');
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`/deepagents/${REVISION}/`);
    expect(await readdir(cache)).toEqual(['files']);
  });

  it('does not silently redownload or substitute a corrupted cache', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { directory, cache } = await fixture();
    await mkdir(cache, { recursive: true });
    await writeFile(path.join(cache, 'filesystem_cloud.jsonl'), 'corrupted-source');
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('SHA256');
    expect(fetch).not.toHaveBeenCalled();
    expect(await readFile(path.join(cache, 'filesystem_cloud.jsonl'), 'utf8')).toBe('corrupted-source');
  });

  it('keeps download failures explicit and refuses oversized response bodies', async () => {
    const { directory } = await fixture();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('HTTP 404');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('small', { headers: { 'content-length': String(9 * 1024 * 1024) } })));
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('大小限制');
  });

  it('cancels before download and during response delivery without accepting stale data', async () => {
    const { directory, cache } = await fixture();
    const before = new AbortController(); before.abort();
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadLettaContextCases(1, { cacheDir: directory, signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).not.toHaveBeenCalled();
    const during = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { during.abort(); return new Response(syntheticDataset()); }));
    await expect(loadLettaContextCases(1, { cacheDir: directory, signal: during.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(await readdir(cache)).toEqual(['files']);
  });

  it('refuses symlinked cached data and suite folders', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const { directory, cache } = await fixture();
    await mkdir(cache, { recursive: true });
    const outside = path.join(directory, 'outside');
    await writeFile(outside, 'private data');
    await symlink(outside, path.join(cache, 'filesystem_cloud.jsonl'));
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('符号链接');
    expect(fetch).not.toHaveBeenCalled();
    await rm(path.join(directory, 'letta-context'), { recursive: true });
    const externalFolder = path.join(directory, 'outside-folder'); await mkdir(externalFolder);
    await symlink(externalFolder, path.join(directory, 'letta-context'));
    await expect(loadLettaContextCases(1, { cacheDir: directory })).rejects.toThrow('符号链接');
    expect(await readdir(externalFolder)).toEqual([]);
  });

  it('describes the fixed cloud dataset separately from the current Filesystem v2 leaderboard', () => {
    expect(LETTA_CONTEXT_SUITE).toMatchObject({ id: 'letta-context', total: 100, defaultLimit: 3 });
    expect(LETTA_CONTEXT_SUITE.description).toContain('非 Filesystem v2');
  });
});
