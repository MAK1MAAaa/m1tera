import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RuntimeService } from '../../runtime/service.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { CustomProvider, ModelOption, RequestMap, RuntimeEvent, RuntimeRequest, Settings } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });

interface EndpointRequest { url: string; authorization?: string; model?: string }
async function endpoint(catalog: (authorization?: string) => unknown[] | Promise<unknown[]> = () => [{ id: 'shared-chat' }], status: () => number = () => 200) {
  const requests: EndpointRequest[] = [];
  const server = createServer(async (request, response) => {
    const authorization = request.headers.authorization;
    const url = request.url ?? '';
    if (url === '/v1/models') {
      requests.push({ url, authorization });
      response.writeHead(status(), { 'content-type': 'application/json' }).end(JSON.stringify({ data: await catalog(authorization) }));
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text) as { model: string };
    requests.push({ url, authorization, model: body.model });
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const [delta, finish] of [[{ role: 'assistant', content: 'fixture answer' }, null], [{}, 'stop']] as const) {
      response.write(`data: ${JSON.stringify({ id: 'provider-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    }
    response.end('data: [DONE]\n\n');
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('loopback endpoint unavailable');
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, requests };
}

async function runtime() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-providers-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: directory, emit: (event) => events.push(event) });
  cleanup.push(() => service.shutdown());
  return { directory, service, events };
}

function provider(id: string, baseUrl: string, enabled = true): CustomProvider {
  return { id, name: id, baseUrl, apiFormat: 'chat-completions', models: [{ id: 'shared-chat', enabled, source: 'manual' }] };
}

function settings(providers: CustomProvider[], selected = providers[0].id, model = 'shared-chat'): Settings {
  const current = providers.find((item) => item.id === selected)!;
  return { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: current.apiFormat, baseUrl: current.baseUrl, model, providerId: current.id, chatgptModels: [], customProviders: providers };
}

async function rpc<M extends keyof RequestMap>(service: RuntimeService, method: M, params: RequestMap[M]['params']) {
  return service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
}

async function result<M extends keyof RequestMap>(service: RuntimeService, method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
  const response = await rpc(service, method, params);
  expect(response.error).toBeUndefined();
  return response.result as RequestMap[M]['result'];
}

describe('managed provider runtime integration', () => {
  it('isolates keys and discovered limits for two providers sharing an endpoint and model ID', async () => {
    const backend = await endpoint((authorization) => [{ id: 'shared-chat', context_window: authorization === 'Bearer provider-alpha-only-key' ? 4096 : 8192 }]);
    const { service, directory, events } = await runtime();
    const profiles = [provider('alpha', backend.baseUrl), provider('beta', backend.baseUrl)];
    const alpha = settings(profiles, 'alpha');
    const beta = settings(profiles, 'beta');
    const configured = await result(service, 'settings.set', { settings: alpha, providerApiKeys: { alpha: 'provider-alpha-only-key', beta: 'provider-beta-only-key' } });
    expect(configured.providerStatus).toEqual([{ id: 'alpha', hasApiKey: true }, { id: 'beta', hasApiKey: true }]);
    await result(service, 'models.discover', { providerId: 'alpha' });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 4096 });
    const session = await result(service, 'sessions.create', {});
    await result(service, 'run.start', { sessionId: session.id, text: 'alpha turn' });
    await service.waitForIdle();
    await result(service, 'settings.set', { settings: beta });
    await result(service, 'models.discover', { providerId: 'beta' });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 8192 });
    await result(service, 'run.start', { sessionId: session.id, text: 'beta turn' });
    await service.waitForIdle();
    await result(service, 'settings.set', { settings: alpha });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 4096 });
    expect(backend.requests.filter((item) => item.url === '/v1/chat/completions')).toEqual([
      { url: '/v1/chat/completions', authorization: 'Bearer provider-alpha-only-key', model: 'shared-chat' },
      { url: '/v1/chat/completions', authorization: 'Bearer provider-beta-only-key', model: 'shared-chat' },
    ]);
    const publicData = JSON.stringify([configured, await result(service, 'settings.get', {}), events]) + await readFile(path.join(directory, 'settings.json'), 'utf8');
    expect(publicData).not.toContain('provider-alpha-only-key');
    expect(publicData).not.toContain('provider-beta-only-key');
  });

  it('never reuses a stored key for an unsaved or saved base URL change', async () => {
    const original = await endpoint();
    const changed = await endpoint();
    const { service } = await runtime();
    await result(service, 'settings.set', { settings: settings([provider('alpha', original.baseUrl)]), providerApiKeys: { alpha: 'provider-alpha-only-key' } });
    expect((await result(service, 'models.discover', { providerId: 'alpha', baseUrl: changed.baseUrl })).fetched).toBe(true);
    expect(changed.requests).toEqual([{ url: '/v1/models', authorization: undefined }]);
    const updated = await result(service, 'settings.set', { settings: settings([provider('alpha', changed.baseUrl)]) });
    expect(updated.hasApiKey).toBe(false);
    expect(updated.providerStatus).toEqual([{ id: 'alpha', hasApiKey: false }]);
    await result(service, 'models.discover', { providerId: 'alpha' });
    expect(changed.requests[1]).toEqual({ url: '/v1/models', authorization: undefined });
    expect(original.requests).toHaveLength(0);
  });

  it('clears a previously discovered context limit when a refreshed catalog omits it', async () => {
    let data: unknown[] = [{ id: 'shared-chat', context_window: 16000 }];
    const backend = await endpoint(() => data);
    const { service } = await runtime();
    await result(service, 'settings.set', { settings: settings([provider('alpha', backend.baseUrl)]) });
    await result(service, 'models.discover', { providerId: 'alpha' });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 16000 });
    data = [{ id: 'shared-chat' }];
    await result(service, 'models.discover', { providerId: 'alpha' });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: null });
  });

  it('downgrades stale active metadata after failed refreshes without reviving retired or missing models', async () => {
    let status = 200;
    const key = 'catalog-refresh-fixture-only-key';
    const backend = await endpoint(() => status === 200 ? [
      { id: 'shared-chat', name: 'Shared Active', context_window: 16000 },
      { id: 'retired-chat', name: 'Retired Chat', status: 'retired' },
    ] : [{ id: 'private-error-body-model', name: `provider-private-error ${key}` }], () => status);
    const { service } = await runtime();
    const profile = provider('alpha', backend.baseUrl);
    profile.models = ['shared-chat', 'retired-chat', 'missing-chat'].map((id) => ({ id, enabled: true, source: 'endpoint' }));
    await result(service, 'settings.set', { settings: settings([profile]), providerApiKeys: { alpha: key } });
    const verified = await result(service, 'models.list', {});
    expect(verified.find((item) => item.id === 'shared-chat')).toMatchObject({ availability: 'available', contextWindow: 16000 });
    expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 16000 });
    for (status of [401, 500]) {
      const stale = await result(service, 'models.list', {});
      expect(stale.find((item) => item.id === 'shared-chat')).toMatchObject({ name: 'Shared Active', availability: 'unverified', catalogWarning: expect.any(String) });
      for (const id of ['retired-chat', 'missing-chat']) expect(stale.find((item) => item.id === id)).toMatchObject({ enabled: false, availability: 'unavailable', catalogWarning: expect.any(String) });
      expect(await result(service, 'context.preview', {})).toMatchObject({ contextWindow: 16000 });
      expect(JSON.stringify(stale)).not.toMatch(/private-error-body-model|provider-private-error|catalog-refresh-fixture-only-key/);
    }
  });

  it('promotes an unsaved provider catalog only with the same credential while the official model stays selected', async () => {
    const backend = await endpoint(() => [
      { id: 'shared-chat', name: 'Shared Draft', context_window: 16000 },
      { id: 'unchecked-chat', name: 'Unchecked Draft', context_window: 8192 },
    ]);
    const { service, directory } = await runtime();
    const initial = await result(service, 'settings.get', {});
    const id = crypto.randomUUID();
    const originalKey = 'draft-provider-fixture-only-key';
    const changedKey = 'changed-draft-provider-fixture-only-key';
    const discovered = await result(service, 'models.discover', { providerId: id, baseUrl: backend.baseUrl, apiKey: originalKey });
    expect(discovered.fetched).toBe(true);
    expect(discovered.models).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'shared-chat', name: 'Shared Draft', contextWindow: 16000 }),
      expect.objectContaining({ id: 'unchecked-chat', name: 'Unchecked Draft', contextWindow: 8192 }),
    ]));
    const profile = { ...provider(id, backend.baseUrl), models: [] };
    const saved = await result(service, 'settings.set', { settings: { ...initial.settings, customProviders: [profile] }, providerApiKeys: { [id]: originalKey } });
    expect(saved.settings).toMatchObject({ connection: 'chatgpt', providerId: 'chatgpt', model: DEFAULT_SETTINGS.model });
    const listed = await result(service, 'models.list', {});
    expect(listed.filter((item) => item.providerId === id)).toEqual([
      expect.objectContaining({ id: 'shared-chat', name: 'Shared Draft', contextWindow: 16000, availability: 'available', enabled: false }),
      expect.objectContaining({ id: 'unchecked-chat', name: 'Unchecked Draft', contextWindow: 8192, availability: 'available', enabled: false }),
    ]);
    expect(backend.requests).toEqual([{ url: '/v1/models', authorization: `Bearer ${originalKey}` }]);
    const changed = await result(service, 'settings.set', { settings: saved.settings, providerApiKeys: { [id]: changedKey } });
    const afterChange = await result(service, 'models.list', {});
    expect(afterChange.filter((item) => item.providerId === id)).toEqual([]);
    expect(backend.requests).toHaveLength(1);
    const publicData = JSON.stringify([discovered, saved, listed, changed, afterChange]) + await readFile(path.join(directory, 'settings.json'), 'utf8');
    expect(publicData).not.toContain(originalKey);
    expect(publicData).not.toContain(changedKey);
    expect(publicData).not.toMatch(/credentialFingerprint|draftCatalogs/);
  });

  it('retains a key across API format changes at the same URL and explicitly clears only the requested provider', async () => {
    const backend = await endpoint();
    const { service } = await runtime();
    const profiles = [provider('alpha', backend.baseUrl), provider('beta', backend.baseUrl)];
    await result(service, 'settings.set', { settings: settings(profiles), providerApiKeys: { alpha: 'provider-alpha-only-key', beta: 'provider-beta-only-key' } });
    const changed = profiles.map((item) => item.id === 'alpha' ? { ...item, apiFormat: 'responses' as const } : item);
    expect(await result(service, 'settings.set', { settings: settings(changed) })).toMatchObject({ hasApiKey: true });
    await result(service, 'models.discover', { providerId: 'alpha', apiKey: '' });
    expect(backend.requests[0].authorization).toBeUndefined();
    const cleared = await result(service, 'settings.set', { settings: settings(changed), providerApiKeys: { alpha: '' } });
    expect(cleared.providerStatus).toEqual([{ id: 'alpha', hasApiKey: false }, { id: 'beta', hasApiKey: true }]);
    const beta = await result(service, 'settings.set', { settings: settings(changed, 'beta') });
    expect(beta.hasApiKey).toBe(true);
    await result(service, 'models.discover', { providerId: 'beta' });
    expect(backend.requests[1].authorization).toBe('Bearer provider-beta-only-key');
  });

  it('requires an explicit enabled configuration before a discovered model can run', async () => {
    const backend = await endpoint(() => [{ id: 'shared-chat' }, { id: 'discovered-chat', context_window: 16000 }]);
    const { service } = await runtime();
    const profile = provider('alpha', backend.baseUrl);
    await result(service, 'settings.set', { settings: settings([profile]) });
    const discovered = await result(service, 'models.list', {});
    expect(discovered.find((item) => item.id === 'discovered-chat')).toMatchObject({ providerId: 'alpha', enabled: false, availability: 'available' });
    const session = await result(service, 'sessions.create', {});
    await result(service, 'settings.set', { settings: settings([profile], 'alpha', 'discovered-chat') });
    expect((await rpc(service, 'run.start', { sessionId: session.id, text: 'must not run yet' })).error?.code).toBe('MODEL_DISABLED');
    expect((await rpc(service, 'context.baseline', { live: true })).error?.code).toBe('MODEL_DISABLED');
    expect(backend.requests.filter((item) => item.model)).toHaveLength(0);
    expect((await result(service, 'sessions.load', { sessionId: session.id })).messages).toHaveLength(0);
    profile.models.push({ id: 'discovered-chat', enabled: true, source: 'endpoint' });
    await result(service, 'settings.set', { settings: settings([profile], 'alpha', 'discovered-chat') });
    await result(service, 'run.start', { sessionId: session.id, text: 'explicitly enabled' });
    await service.waitForIdle();
    expect(backend.requests.find((item) => item.model)?.model).toBe('discovered-chat');
  });

  it('blocks retired and vanished endpoint models even when saved as enabled', async () => {
    let data: unknown[] = [{ id: 'shared-chat', status: 'retired' }];
    const backend = await endpoint(() => data);
    const { service } = await runtime();
    const profile = provider('alpha', backend.baseUrl);
    profile.models[0].source = 'endpoint';
    await result(service, 'settings.set', { settings: settings([profile]) });
    const session = await result(service, 'sessions.create', {});
    const retired = await result(service, 'models.list', {});
    expect(retired.find((item) => item.providerId === 'alpha')).toMatchObject({ id: 'shared-chat', enabled: false, availability: 'unavailable' });
    expect((await rpc(service, 'run.start', { sessionId: session.id, text: 'retired model' })).error?.code).toBe('MODEL_UNAVAILABLE');
    data = [];
    await result(service, 'models.discover', { providerId: 'alpha' });
    const removed = await result(service, 'models.list', {});
    expect(removed.find((item) => item.providerId === 'alpha')).toMatchObject({ id: 'shared-chat', enabled: false, availability: 'unavailable' });
    expect((await rpc(service, 'run.start', { sessionId: session.id, text: 'removed model' })).error?.code).toBe('MODEL_UNAVAILABLE');
    expect(backend.requests.every((item) => item.url === '/v1/models')).toBe(true);
  });

  it('restores provider profiles and enabled flags without restoring credentials', async () => {
    const backend = await endpoint();
    const { service, directory } = await runtime();
    const profiles = [provider('alpha', backend.baseUrl), provider('beta', backend.baseUrl, false)];
    const saved = await result(service, 'settings.set', { settings: settings(profiles), providerApiKeys: { alpha: 'provider-alpha-only-key', beta: 'provider-beta-only-key' } });
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: directory, emit: () => {} });
    cleanup.push(() => restored.shutdown());
    const loaded = await result(restored, 'settings.get', {});
    expect(loaded.settings).toEqual(saved.settings);
    expect(loaded.hasApiKey).toBe(false);
    expect(loaded.providerStatus).toEqual([{ id: 'alpha', hasApiKey: false }, { id: 'beta', hasApiKey: false }]);
    const options = await result(restored, 'models.list', {});
    expect((options as ModelOption[]).find((item) => item.providerId === 'beta')).toMatchObject({ id: 'shared-chat', enabled: false });
    await result(restored, 'models.discover', { providerId: 'alpha' });
    expect(backend.requests.every((item) => item.authorization === undefined)).toBe(true);
  });

  it('persists active provider removal, clears its key and refuses sends until another model is selected', async () => {
    const backend = await endpoint();
    const { service, directory } = await runtime();
    const profiles = [provider('alpha', backend.baseUrl), provider('beta', backend.baseUrl)];
    const active = settings(profiles);
    await result(service, 'settings.set', { settings: active, providerApiKeys: { alpha: 'provider-alpha-only-key', beta: 'provider-beta-only-key' } });
    const removed = await result(service, 'settings.set', { settings: { ...active, customProviders: [profiles[1]] } });
    expect(removed.settings).toMatchObject({ providerId: 'alpha', model: 'shared-chat', customProviders: [profiles[1]] });
    expect(removed.hasApiKey).toBe(false);
    expect(removed.providerStatus).toEqual([{ id: 'beta', hasApiKey: true }]);
    expect(JSON.parse(await readFile(path.join(directory, 'settings.json'), 'utf8'))).toMatchObject({ providerId: 'alpha', customProviders: [profiles[1]] });
    const session = await result(service, 'sessions.create', {});
    expect((await rpc(service, 'run.start', { sessionId: session.id, text: 'deleted active profile' })).error?.code).toBe('MODEL_DISABLED');
    expect(backend.requests).toHaveLength(0);
    await result(service, 'settings.set', { settings: settings([profiles[1]]) });
    await result(service, 'run.start', { sessionId: session.id, text: 'select remaining profile' });
    await service.waitForIdle();
    expect(backend.requests.find((item) => item.model)?.authorization).toBe('Bearer provider-beta-only-key');
  });

  it('does not let a stale catalog overwrite the current one after credentials change away and back', async () => {
    let release: () => void = () => {};
    const held = new Promise<unknown[]>((resolve) => { release = () => resolve([{ id: 'shared-chat', status: 'retired' }]); });
    let calls = 0;
    const backend = await endpoint(() => ++calls === 1 ? held : [{ id: 'shared-chat' }]);
    const { service } = await runtime();
    const configured = settings([provider('alpha', backend.baseUrl)]);
    await result(service, 'settings.set', { settings: configured, providerApiKeys: { alpha: 'provider-alpha-only-key' } });
    const stale = result(service, 'models.discover', { providerId: 'alpha' });
    try {
      await vi.waitFor(() => expect(backend.requests).toHaveLength(1));
      await result(service, 'settings.set', { settings: configured, providerApiKeys: { alpha: 'provider-beta-only-key' } });
      await result(service, 'settings.set', { settings: configured, providerApiKeys: { alpha: 'provider-alpha-only-key' } });
      const fresh = await result(service, 'models.discover', { providerId: 'alpha' });
      expect(fresh.models[0].availability).toBe('available');
    } finally {
      release();
      await stale;
    }
    const session = await result(service, 'sessions.create', {});
    await result(service, 'run.start', { sessionId: session.id, text: 'use the current catalog' });
    await service.waitForIdle();
    expect(backend.requests.find((item) => item.model)?.authorization).toBe('Bearer provider-alpha-only-key');
  });
});
