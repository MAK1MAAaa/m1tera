import { describe, expect, it } from 'vitest';
import {
  admitSubmission, createCheckpoint, finishCheckpoint, hasUnknownEffects, isResumable,
  recordApproval, recordToolIntent, recordToolOutcome, recoverCheckpoint,
  submissionFingerprint, validateCheckpoint, validateSubmissionReceipts,
} from '../../runtime/checkpoints.js';
import type { RunCheckpoint, SubmissionReceipt } from '../../runtime/checkpoints.js';

const time = '2026-10-13T01:00:00.000Z';
function checkpoint(): RunCheckpoint {
  return createCheckpoint({ runId: 'run-1', submissionId: 'input-1', input: { text: '整理工作区', attachments: ['hello.txt'], skillIds: ['writing'] }, model: 'org/model', providerId: 'custom-local', now: time });
}

function receipt(submissionId: string, runId: string, text = 'hello'): SubmissionReceipt {
  return { submissionId, runId, fingerprint: submissionFingerprint({ text }, { model: 'fixture', workspace: '/workspace', enabledTools: [] }) };
}

describe('durable run checkpoint reducers', () => {
  it('preserves Pi Responses composite call IDs through completion and recovery', () => {
    const id = 'call_fixture|fc_fixture';
    const intent = recordToolIntent(checkpoint(), id, 'read_file', { path: 'hello.txt' }, 'safe');
    expect(validateCheckpoint(intent).toolCalls[id].state).toBe('intent');
    expect(recordToolOutcome(intent, id, false).toolCalls[id].state).toBe('completed');
    expect(recoverCheckpoint(intent).toolCalls[id].state).toBe('interrupted');
    expect(() => createCheckpoint({ runId: 'run|unsafe', submissionId: 'input-1', input: { text: 'hello' }, model: 'fixture' })).toThrow();
  });
  it('isolates stored inputs and arguments from caller mutation', () => {
    const original = checkpoint();
    const args = { path: 'hello.txt' };
    const next = recordToolIntent(original, 'call-1', 'read_file', args, 'safe');
    args.path = 'other.txt';
    next.input.attachments!.push('other.txt');
    expect(original.toolCalls).toEqual({});
    expect(original.input.attachments).toEqual(['hello.txt']);
    expect(next.toolCalls['call-1'].args).toEqual({ path: 'hello.txt' });
  });

  it('records completed and failed tool outcomes without storing output blobs', () => {
    const intent = recordToolIntent(checkpoint(), 'call-1', 'read_file', { path: 'missing.txt' }, 'safe');
    const failed = recordToolOutcome(intent, 'call-1', true, 'File missing');
    expect(failed.toolCalls['call-1']).toMatchObject({ state: 'failed', isError: true, error: 'File missing' });
    expect(recordToolOutcome(failed, 'call-1', true, 'File missing')).toEqual(failed);
    expect(() => recordToolOutcome(failed, 'call-1', false)).toThrow('不一致');
    const second = recordToolIntent(failed, 'call-2', 'read_file', { path: 'exists.txt' }, 'safe');
    const completed = recordToolOutcome(second, 'call-2', false);
    expect(finishCheckpoint(completed, 'completed').status).toBe('completed');
  });

  it('requires a stored intent and settled approval before accepting an outcome', () => {
    expect(() => recordToolOutcome(checkpoint(), 'missing', false)).toThrow('intent');
    const intent = recordToolIntent(checkpoint(), 'call-1', 'write_file', { path: 'hello.txt', content: 'hello' }, 'never');
    const waiting = recordApproval(intent, 'call-1', 'waiting');
    expect(() => recordToolOutcome(waiting, 'call-1', false)).toThrow('审批');
    const rejected = recordApproval(waiting, 'call-1', 'rejected');
    expect(() => recordToolOutcome(rejected, 'call-1', false)).toThrow('拒绝');
    expect(recordToolOutcome(rejected, 'call-1', true, '用户拒绝').toolCalls['call-1'].state).toBe('failed');
    expect(() => recordApproval(rejected, 'call-1', 'approved')).toThrow('重新授予');
  });

  it('deduplicates identical tool intents and rejects changed arguments, names or policy', () => {
    const intent = recordToolIntent(checkpoint(), 'call-1', 'read_file', { path: 'hello.txt', extra: { a: 1, b: 2 } }, 'safe');
    expect(recordToolIntent(intent, 'call-1', 'read_file', { extra: { b: 2, a: 1 }, path: 'hello.txt' }, 'safe')).toEqual(intent);
    expect(() => recordToolIntent(intent, 'call-1', 'read_file', { path: 'other.txt' }, 'safe')).toThrow('不一致');
    expect(() => recordToolIntent(intent, 'call-1', 'write_file', { path: 'hello.txt' }, 'safe')).toThrow('不一致');
    expect(() => recordToolIntent(intent, 'call-1', 'read_file', intent.toolCalls['call-1'].args, 'never')).toThrow('不一致');
  });

  it.each(['waiting', 'approved'] as const)('expires %s approval and marks unknown write as interrupted on reopen', (approval) => {
    const intent = recordToolIntent(checkpoint(), 'write-1', 'write_file', { path: 'hello.txt', content: 'first' }, 'never');
    const original = recordApproval(intent, 'write-1', approval);
    const recoveredAt = new Date(Date.parse(original.updatedAt) + 3_600_000).toISOString();
    const reopened = recoverCheckpoint(JSON.parse(JSON.stringify(original)), recoveredAt);
    expect(reopened.status).toBe('interrupted');
    expect(reopened.toolCalls['write-1']).toMatchObject({ state: 'interrupted', approval: 'expired' });
    expect(reopened.updatedAt).toBe(recoveredAt);
    expect(hasUnknownEffects(reopened)).toBe(true);
    expect(original.status).toBe('running');
    expect(() => recordToolOutcome(reopened, 'write-1', false)).toThrow('非运行');
  });

  it('keeps settled outcomes and never reruns even a safe read during recovery', () => {
    let original = recordToolIntent(checkpoint(), 'read-done', 'read_file', { path: 'hello.txt' }, 'safe');
    original = recordToolOutcome(original, 'read-done', false);
    original = recordToolIntent(original, 'read-pending', 'read_file', { path: 'other.txt' }, 'safe');
    const reopened = recoverCheckpoint(original);
    expect(reopened.toolCalls['read-done']).toMatchObject({ state: 'completed', isError: false });
    expect(reopened.toolCalls['read-pending'].state).toBe('interrupted');
    expect(hasUnknownEffects(reopened)).toBe(false);
  });

  it('finishes cancellation conservatively and does not revive terminal runs', () => {
    let original = recordToolIntent(checkpoint(), 'shell-1', 'run_command', { command: 'touch hello.txt' }, 'never');
    original = recordApproval(original, 'shell-1', 'approved');
    expect(() => finishCheckpoint(original, 'completed')).toThrow('未完成工具');
    const cancelled = finishCheckpoint(original, 'cancelled');
    expect(cancelled.toolCalls['shell-1']).toMatchObject({ state: 'interrupted', approval: 'expired' });
    expect(recoverCheckpoint(cancelled).status).toBe('cancelled');
    expect(() => finishCheckpoint(cancelled, 'completed')).toThrow('旧事件');
    expect(() => recordToolIntent(cancelled, 'later', 'read_file', { path: '.' }, 'safe')).toThrow('非运行');
  });

  it('recognizes explicit resumable states without declaring automatic replay', () => {
    expect(isResumable('paused')).toBe(true);
    expect(isResumable('interrupted')).toBe(true);
    expect(isResumable('error')).toBe(true);
    expect(isResumable('running')).toBe(false);
    expect(isResumable('completed')).toBe(false);
    expect(isResumable('cancelled')).toBe(false);
    expect(recoverCheckpoint(finishCheckpoint(checkpoint(), 'paused')).status).toBe('interrupted');
    expect(recoverCheckpoint(finishCheckpoint(checkpoint(), 'error')).status).toBe('error');
  });

  it('fails closed for malformed storage and unsupported credential metadata', () => {
    const original = checkpoint();
    for (const changed of [
      { ...original, version: 2 }, { ...original, status: 'pending' },
      { ...original, startedAt: 'yesterday' }, { ...original, updatedAt: '2026-10-12T00:00:00.000Z' },
      { ...original, runId: '__proto__' }, { ...original, modelTurns: -1 },
      { ...original, apiKey: 'must-not-persist' }, { ...original, input: { text: 'hi', password: 'must-not-persist' } },
      { ...original, toolCalls: { orphan: { name: 'read_file', args: {}, replay: 'safe', state: 'completed' } } },
      { ...original, toolCalls: JSON.parse('{"__proto__":{"name":"read_file","args":{},"replay":"safe","state":"intent"}}') },
    ]) expect(() => validateCheckpoint(changed)).toThrow();
  });

  it('bounds inputs, diagnostics, nested parameters and call count', () => {
    expect(() => createCheckpoint({ runId: 'run-1', submissionId: 'input-1', input: { text: 'x'.repeat(1024 * 1024 + 1) }, model: 'model' })).toThrow('长度');
    expect(() => createCheckpoint({ runId: 'run-1', submissionId: 'input-1', input: { text: 'hi', attachments: Array.from({ length: 9 }, (_, index) => `file-${index}`) }, model: 'model' })).toThrow('数量');
    const intent = recordToolIntent(checkpoint(), 'read-1', 'read_file', { path: 'hello.txt' }, 'safe');
    expect(() => recordToolOutcome(intent, 'read-1', true, 'x'.repeat(2049))).toThrow('长度');
    expect(() => recordToolIntent(checkpoint(), 'read-1', 'read_file', { path: 'x', authorization: 'secret' }, 'safe')).toThrow('凭据');
    expect(() => recordToolIntent(checkpoint(), 'read-1', 'read_file', { nested: { apiKey: 'secret' } }, 'safe')).toThrow('凭据');
    const deep = Array.from({ length: 22 }).reduce<unknown>((inner) => ({ nested: inner }), {});
    expect(() => recordToolIntent(checkpoint(), 'read-1', 'read_file', { deep }, 'safe')).toThrow('结构');
    const calls = Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`call-${index}`, { name: 'read_file', args: {}, replay: 'safe', state: 'intent' }]));
    expect(() => validateCheckpoint({ ...checkpoint(), toolCalls: calls })).toThrow('256');
  });

  it('allows a one MiB file body and ordinary text discussing passwords', () => {
    const next = recordToolIntent(checkpoint(), 'write-1', 'write_file', { path: 'example.txt', content: '"'.repeat(1024 * 1024) }, 'never');
    expect((next.toolCalls['write-1'].args.content as string).length).toBe(1024 * 1024);
    expect(recordToolIntent(checkpoint(), 'write-2', 'write_file', { path: 'example.txt', content: 'Explain apiKey, password and token fields.' }, 'never').toolCalls['write-2'].state).toBe('intent');
  });
});

describe('submission admission receipts', () => {
  it('uses stable nested key order while retaining array order and all capability changes', () => {
    const input = { text: 'hello', attachments: ['a.txt', 'b.txt'] };
    const first = submissionFingerprint(input, { model: 'one', limits: { turns: 12, tokens: 1000 }, optional: undefined });
    expect(submissionFingerprint(input, { limits: { tokens: 1000, turns: 12 }, model: 'one' })).toBe(first);
    expect(submissionFingerprint({ ...input, attachments: ['b.txt', 'a.txt'] }, { model: 'one', limits: { turns: 12, tokens: 1000 } })).not.toBe(first);
    expect(submissionFingerprint(input, { model: 'two', limits: { turns: 12, tokens: 1000 } })).not.toBe(first);
    expect(submissionFingerprint(input, { model: 'one', limits: { turns: 12, tokens: 1001 } })).not.toBe(first);
    expect(() => submissionFingerprint(input, { apiKey: 'never hash secrets' })).toThrow('凭据');
  });

  it('returns the first accepted run ID on duplicate submission rather than admitting a second run', () => {
    const first = admitSubmission([], receipt('input-1', 'run-1'));
    const duplicate = admitSubmission(first.receipts, receipt('input-1', 'run-2'));
    expect(first.duplicate).toBe(false);
    expect(duplicate).toEqual({ receipts: first.receipts, runId: 'run-1', duplicate: true });
    expect(() => admitSubmission(first.receipts, receipt('input-1', 'run-3', 'changed input'))).toThrow('不同的输入或配置');
  });

  it('retains only the latest 64 receipts, without mutating the caller list', () => {
    const original = Array.from({ length: 64 }, (_, index) => receipt(`input-${index}`, `run-${index}`));
    const next = admitSubmission(original, receipt('input-64', 'run-64'));
    expect(next.receipts).toHaveLength(64);
    expect(next.receipts[0].submissionId).toBe('input-1');
    expect(next.receipts.at(-1)!.submissionId).toBe('input-64');
    expect(original[0].submissionId).toBe('input-0');
  });

  it('rejects corrupted receipt IDs, fingerprints, duplicate IDs and unbounded storage', () => {
    const first = receipt('input-1', 'run-1');
    expect(() => validateSubmissionReceipts([first, first])).toThrow('重复');
    expect(() => validateSubmissionReceipts([{ ...first, fingerprint: 'bad' }])).toThrow('指纹');
    expect(() => validateSubmissionReceipts([{ ...first, apiKey: 'secret' }])).toThrow('字段');
    expect(() => validateSubmissionReceipts(Array.from({ length: 65 }, (_, index) => receipt(`input-${index}`, `run-${index}`)))).toThrow('64');
  });
});
