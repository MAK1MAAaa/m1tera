import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatGPTAuth } from '../../runtime/chatgpt-auth.js';

afterEach(() => { vi.restoreAllMocks(); });

function fixture(connected = true) {
  const auth = new ChatGPTAuth('/unused-chatgpt-discovery-test', () => undefined);
  const state = { connected, loginPending: false };
  vi.spyOn(auth, 'status').mockImplementation(() => ({ ...state }));
  const getAuth = vi.spyOn(auth, 'getAuth').mockResolvedValue({ apiKey: 'fixture-oauth-access-token' });
  return { auth, state, getAuth };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}

describe('ChatGPT account model discovery', () => {
  it('keeps only an unverified explicit default before sign-in and makes no credential or network requests', async () => {
    const { auth, getAuth } = fixture(false);
    const fetcher = vi.fn<typeof globalThis.fetch>();
    expect(auth.listModels()).toEqual([expect.objectContaining({ id: 'gpt-6.1-sol', source: 'catalog', availability: 'unverified' })]);
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result).toMatchObject({ fetched: false, warning: expect.any(String) });
    expect(result.models).toHaveLength(1);
    expect(getAuth).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the OAuth model shape, preserves server order and registers the same credential for redaction', async () => {
    const { auth } = fixture();
    const credential = vi.fn();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: [
      { slug: 'remote-new', display_name: '远端新模型', visibility: 'list', context_window: 96_000, reasoning: true },
      { slug: 'gpt-6.1-sol', display_name: '账户中的 Sol', visibility: 'list' },
      { slug: 'remote-new', display_name: '重复条目', visibility: 'list' },
      { slug: 'hidden-model', visibility: 'hidden' },
      { slug: 'missing-visibility' },
      { slug: '', visibility: 'list' },
      { slug: 'x'.repeat(201), visibility: 'list' },
      { slug: 'line\nbreak', visibility: 'list' },
    ] }));
    const result = await auth.discoverModels(credential, fetcher);
    expect(result.fetched).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.models.map((model) => model.id)).toEqual(['remote-new', 'gpt-6.1-sol']);
    expect(result.models[0]).toMatchObject({ name: '远端新模型', contextWindow: 96_000, reasoning: true, source: 'endpoint', availability: 'available' });
    expect(credential).toHaveBeenCalledExactlyOnceWith('fixture-oauth-access-token');
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('https://api.openai.com/v1/models', expect.objectContaining({
      method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
      headers: { Authorization: 'Bearer fixture-oauth-access-token', accept: 'application/json' },
    }));
    expect(JSON.stringify(result)).not.toContain('fixture-oauth-access-token');
    expect(auth.getContextWindow('remote-new')).toBe(96_000);
    expect(auth.getModel('remote-new')).toMatchObject({ id: 'remote-new', name: '远端新模型', provider: 'openai', api: 'openai-responses', input: ['text'] });
  });

  it('runs a new account slug through Responses without inventing a measured context capacity', async () => {
    const { auth } = fixture();
    const exact = auth.getModel('gpt-6.1-sol');
    const exactLimit = exact.contextWindow;
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: [
      { slug: 'new-unregistered-slug', display_name: 'New model', visibility: 'list', context_window: '200000' },
      { slug: 'gpt-6.1-sol', visibility: 'list' },
      { slug: 'long-display', display_name: 'x'.repeat(201), visibility: 'list' },
    ] }));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(auth.getModel('new-unregistered-slug')).toMatchObject({ id: 'new-unregistered-slug', api: 'openai-responses', contextWindow: 128_000, reasoning: false });
    expect(auth.getContextWindow('new-unregistered-slug')).toBeNull();
    expect(result.models[0].contextWindow).toBeUndefined();
    expect(auth.getContextWindow('gpt-6.1-sol')).toBe(exactLimit);
    expect(auth.getModel('gpt-6.1-sol').input).toEqual(exact.input);
    expect(result.models[2].name).toBe('long-display');
    expect(() => auth.getModel('never-configured')).toThrow('未包含模型 never-configured');
  });

  it('excludes explicit lifecycle and media restrictions without treating an old creation date as a shutdown', async () => {
    const { auth } = fixture();
    const restrictions = [
      { status: 'deprecated' }, { lifecycle_status: 'retired' }, { lifecycleStatus: 'removed' },
      { lifecycle: 'shutdown' }, { state: 'disabled' }, { status: 'inactive' }, { status: 'unavailable' },
      { deprecated: true }, { retired: true }, { disabled: true }, { available: false },
      { shutdown_date: '2000-01-01' }, { shutdown_date: '2999-01-01' }, { deprecated_at: '2000-01-01' },
      { retired_at: '2000-01-01T00:00:00+08:00' },
      { input: ['image'] }, { modalities: { output: ['audio'] } }, { capabilities: { input: ['audio'] } },
    ];
    const models = restrictions.map((fields, index) => ({ slug: `restricted-${index}`, visibility: 'list', ...fields }));
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: [
      ...models,
      { slug: 'older-created', visibility: 'list', created: 1, deprecated: false, shutdown_date: 'invalid' },
      { slug: 'future-deprecation', visibility: 'list', deprecated_at: '2999-01-01' },
      { slug: 'mixed-media', visibility: 'list', modalities: { input: ['text', 'image'], output: ['text'] } },
      { slug: 'invalid-calendar-date', visibility: 'list', shutdown_date: '2000-02-31' },
    ] }));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result.models.map((model) => model.id)).toEqual(['older-created', 'future-deprecation', 'mixed-media', 'invalid-calendar-date']);
  });

  it.each([{ data: [{ id: 'ordinary-api-model' }] }, { models: 'bad shape' }, null])('rejects a non-OAuth catalog response: %j', async (body) => {
    const { auth } = fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response(body));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result).toMatchObject({ fetched: false, warning: expect.any(String) });
    expect(result.models).toEqual([expect.objectContaining({ id: 'gpt-6.1-sol', availability: 'unverified' })]);
  });

  it('keeps an authoritative empty account catalog empty, including after a failed refresh', async () => {
    const { auth } = fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ models: [] }))
      .mockRejectedValueOnce(new Error('temporary failure'));
    expect(await auth.discoverModels(undefined, fetcher)).toEqual({ models: [], fetched: true });
    expect(auth.listModels()).toEqual([]);
    expect(await auth.discoverModels(undefined, fetcher)).toMatchObject({ models: [], fetched: false });
    expect(auth.listModels()).toEqual([]);
  });

  it('marks the last successful inventory unverified on failure and never reveals the upstream body or credential', async () => {
    const { auth, getAuth } = fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({ models: [{ slug: 'cached-only', visibility: 'list' }] }))
      .mockResolvedValueOnce(response({ error: 'private-provider-body fixture-oauth-access-token' }, 403));
    await auth.discoverModels(undefined, fetcher);
    const failed = await auth.discoverModels(undefined, fetcher);
    expect(failed).toMatchObject({ fetched: false, models: [{ id: 'cached-only', availability: 'unverified' }] });
    expect(auth.listModels()[0].availability).toBe('unverified');
    expect(JSON.stringify(failed)).not.toContain('private-provider-body');
    expect(JSON.stringify(failed)).not.toContain('fixture-oauth-access-token');
    getAuth.mockRejectedValueOnce(new Error('sensitive-auth-error fixture-oauth-access-token'));
    expect(JSON.stringify(await auth.discoverModels(undefined, fetcher))).not.toContain('sensitive-auth-error');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects a model response over the byte limit, with or without content-length', async () => {
    const { auth } = fixture();
    const large = new Response('short', { headers: { 'content-length': String(1024 * 1024 + 1) } });
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(large)
      .mockResolvedValueOnce(response({ models: [], padding: 'x'.repeat(1024 * 1024) }));
    expect((await auth.discoverModels(undefined, fetcher)).fetched).toBe(false);
    expect((await auth.discoverModels(undefined, fetcher)).fetched).toBe(false);
    expect(auth.listModels()).toHaveLength(1);
  });

  it('keeps the complete bounded directory so a later model remains selectable', async () => {
    const { auth } = fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: Array.from({ length: 260 }, (_, index) => ({ slug: `ordered-${index}`, visibility: 'list' })) }));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result.fetched).toBe(true);
    expect(result.models.map((model) => model.id)).toEqual(Array.from({ length: 260 }, (_, index) => `ordered-${index}`));
    expect(result.warning).toBeUndefined();
    expect(auth.listModels()).toHaveLength(260);
    expect(auth.getModel('ordered-256')).toMatchObject({ id: 'ordered-256', api: 'openai-responses' });
  });

  it('keeps discovered names and context limits within settings validation bounds', async () => {
    const { auth } = fixture();
    const capacities = [1, 127, 10_000_001, Number.MAX_SAFE_INTEGER, 128, 10_000_000];
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: capacities.map((capacity, index) => ({
      slug: `capacity-${index}`, display_name: '名'.repeat(160), visibility: 'list', context_window: capacity,
    })) }));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result.models.every((model) => model.name.length === 100)).toBe(true);
    for (let index = 0; index < 4; index++) {
      expect(result.models[index].contextWindow).toBeUndefined();
      expect(auth.getContextWindow(`capacity-${index}`)).toBeNull();
    }
    expect(auth.getContextWindow('capacity-4')).toBe(128);
    expect(auth.getContextWindow('capacity-5')).toBe(10_000_000);
  });

  it('does not expose a credential reflected by upstream model IDs or display names', async () => {
    const { auth } = fixture();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response({ models: [
      { slug: 'fixture-oauth-access-token', visibility: 'list' },
      { slug: 'safe-id', display_name: 'fixture-oauth-access-token', visibility: 'list' },
    ] }));
    const result = await auth.discoverModels(undefined, fetcher);
    expect(result.models).toEqual([expect.objectContaining({ id: 'safe-id', name: 'safe-id' })]);
    expect(JSON.stringify(result)).not.toContain('fixture-oauth-access-token');
  });

  it('bounds discovery with a four-second abort signal', async () => {
    const { auth } = fixture();
    const timeout = new AbortController();
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal);
    const started = deferred<void>();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      started.resolve();
    }));
    const pending = auth.discoverModels(undefined, fetcher);
    await started.promise;
    timeout.abort();
    expect(await pending).toMatchObject({ fetched: false, models: [{ id: 'gpt-6.1-sol', availability: 'unverified' }] });
    expect(timeoutSpy).toHaveBeenCalledWith(4000);
  });

  it.each(['cancel', 'logout'] as const)('prevents a pending discovery from repopulating the catalog after %s', async (action) => {
    const { auth, state } = fixture();
    const pendingResponse = deferred<Response>();
    const started = deferred<void>();
    const fetcher = vi.fn<typeof globalThis.fetch>().mockImplementation(() => {
      started.resolve();
      return pendingResponse.promise;
    });
    const pending = auth.discoverModels(undefined, fetcher);
    await started.promise;
    if (action === 'logout') { state.connected = false; await auth.logout(); }
    else auth.cancel();
    pendingResponse.resolve(response({ models: [{ slug: 'previous-account-model', visibility: 'list' }] }));
    expect(await pending).toMatchObject({ fetched: false });
    expect(auth.listModels().map((model) => model.id)).toEqual(['gpt-6.1-sol']);
    expect(() => auth.getModel('previous-account-model')).toThrow();
  });

  it('does not let an older cancelled response downgrade a newer successful account catalog', async () => {
    const { auth } = fixture();
    const old = deferred<Response>();
    const started = deferred<void>();
    const fetcher = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(() => { started.resolve(); return old.promise; })
      .mockResolvedValueOnce(response({ models: [{ slug: 'new-account-model', visibility: 'list' }] }));
    const pending = auth.discoverModels(undefined, fetcher);
    await started.promise;
    auth.cancel();
    expect((await auth.discoverModels(undefined, fetcher)).fetched).toBe(true);
    old.resolve(response({ models: [{ slug: 'old-account-model', visibility: 'list' }] }));
    await pending;
    expect(auth.listModels()).toEqual([expect.objectContaining({ id: 'new-account-model', availability: 'available' })]);
    expect(() => auth.getModel('old-account-model')).toThrow();
  });

  it('stops a cancelled credential resolution before redaction registration or network access', async () => {
    const { auth, getAuth } = fixture();
    const credential = deferred<{ apiKey: string }>();
    getAuth.mockReturnValueOnce(credential.promise);
    const register = vi.fn();
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const pending = auth.discoverModels(register, fetcher);
    auth.cancel();
    credential.resolve({ apiKey: 'old-access-token' });
    expect((await pending).fetched).toBe(false);
    expect(register).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
