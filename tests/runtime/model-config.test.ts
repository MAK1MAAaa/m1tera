import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { discoverCompatibleModels, normalizeModelSettings } from '../../runtime/model-config.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { ConfiguredModel, CustomProvider, Settings } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const task of cleanup.splice(0).reverse()) await task(); });

function model(id: string, enabled = true): ConfiguredModel { return { id, enabled, source: 'manual' }; }
function provider(id = 'local', extra: Partial<CustomProvider> = {}): CustomProvider {
  return { id, name: 'Local', baseUrl: 'https://models.example/v1', apiFormat: 'chat-completions', models: [model('custom-chat')], ...extra };
}
function managed(extra: Partial<Settings> = {}): Settings {
  return { ...DEFAULT_SETTINGS, connection: 'compatible', model: 'custom-chat', apiFormat: 'chat-completions', baseUrl: 'https://models.example/v1', providerId: 'local', chatgptModels: [model(DEFAULT_SETTINGS.model)], customProviders: [provider()], ...extra };
}
function response(value: unknown): Response { return new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } }); }
function fetchWith(value: unknown) { return vi.fn<typeof fetch>().mockResolvedValue(response(value)); }

describe('model settings migration and validation', () => {
  it('migrates official defaults without enabling a cached catalog or an arbitrary saved model', () => {
    expect(normalizeModelSettings(DEFAULT_SETTINGS)).toMatchObject({ providerId: 'chatgpt', chatgptModels: [model(DEFAULT_SETTINGS.model)], customProviders: [] });
    expect(normalizeModelSettings({ ...DEFAULT_SETTINGS, model: 'old-cached-model' }).chatgptModels).toEqual([model(DEFAULT_SETTINGS.model), model('old-cached-model', false)]);
  });

  it('migrates the flat compatible endpoint and strips unknown credential fields', () => {
    const input = { ...DEFAULT_SETTINGS, connection: 'compatible', baseUrl: 'HTTPS://models.example/v1///', apiFormat: 'chat-completions', model: 'private-chat', contextWindow: 16000, apiKey: 'do-not-save' } as Settings;
    const normalized = normalizeModelSettings(input);
    expect(normalized).toMatchObject({ baseUrl: 'https://models.example/v1', providerId: 'custom-default', customProviders: [{ id: 'custom-default', name: '自定义接口', baseUrl: 'https://models.example/v1', apiFormat: 'chat-completions', models: [{ id: 'private-chat', enabled: true, source: 'manual', contextWindow: 16000 }] }] });
    expect(JSON.stringify(normalized)).not.toContain('do-not-save');
    expect(input.baseUrl).toBe('HTTPS://models.example/v1///');
  });

  it('preserves previous profiles and disabled models for an old flat client', () => {
    const previous = managed({ customProviders: [provider('local', { models: [model('custom-chat', false)] }), provider('second', { baseUrl: 'https://second.example/v1' })], chatgptModels: [model(DEFAULT_SETTINGS.model, false)] });
    const legacy = { ...DEFAULT_SETTINGS, connection: 'compatible', baseUrl: 'https://changed.example/v1/', apiFormat: 'responses', model: 'new-model' } as Settings;
    const result = normalizeModelSettings(legacy, previous);
    expect(result.providerId).toBe('local');
    expect(result.customProviders?.[0]).toMatchObject({ baseUrl: 'https://changed.example/v1', apiFormat: 'responses', models: [model('custom-chat', false), model('new-model')] });
    expect(result.customProviders?.[1]).toEqual(previous.customProviders?.[1]);
    expect(result.chatgptModels).toEqual([model(DEFAULT_SETTINGS.model, false)]);
    expect(previous.customProviders?.[0].baseUrl).toBe('https://models.example/v1');
  });

  it('preserves explicit enabled flags and endpoint sources without recreating disabled selections', () => {
    const settings = managed({ customProviders: [provider('local', { models: [{ id: 'custom-chat', enabled: false, source: 'endpoint', contextWindow: 32000 }] })], chatgptModels: [] });
    expect(normalizeModelSettings(settings)).toEqual(settings);
  });

  it('lets the flat connection choose official mode without overwriting custom profiles', () => {
    const input = managed({ connection: 'chatgpt', model: DEFAULT_SETTINGS.model });
    const normalized = normalizeModelSettings(input);
    expect(normalized.providerId).toBe('chatgpt');
    expect(normalized.customProviders).toEqual(input.customProviders);
  });

  it('rejects an explicitly selected profile that disagrees with the flat endpoint', () => {
    for (const patch of [{ providerId: 'chatgpt' }, { baseUrl: 'https://other.example/v1' }, { apiFormat: 'responses' as const }]) expect(() => normalizeModelSettings(managed(patch))).toThrow('不一致');
  });

  it('keeps a deleted active provider as an orphan selection without recreating its profile', () => {
    const remaining = provider('second', { baseUrl: 'https://second.example/v1' });
    const input = managed({ customProviders: [remaining] });
    const normalized = normalizeModelSettings(input, managed());
    expect(normalized.providerId).toBe('local');
    expect(normalized.model).toBe('custom-chat');
    expect(normalized.customProviders).toEqual([remaining]);
    expect(normalizeModelSettings({ ...input, customProviders: [] }).customProviders).toEqual([]);
  });

  it('validates duplicate provider and model IDs after trimming, including the reserved official ID', () => {
    for (const entries of [[provider('same'), provider(' same ')], ...['chatgpt', '__proto__', 'constructor', 'prototype', 'provider/id', '-provider', '提供商'].map((id) => [provider(id)])]) expect(() => normalizeModelSettings(managed({ customProviders: entries }))).toThrow();
    for (const entries of [[model('same'), model(' same ')], [model('a\0b')]]) expect(() => normalizeModelSettings(managed({ customProviders: [provider('local', { models: entries })] }))).toThrow();
    expect(() => normalizeModelSettings(managed({ chatgptModels: [model('same'), model('same')] }))).toThrow();
    expect(() => normalizeModelSettings(managed({ customProviders: [provider('a\0b')] }))).toThrow();
    expect(normalizeModelSettings(managed({ customProviders: [provider('local', { models: [model('gateway/model:latest')] })] })).customProviders?.[0].models[0].id).toBe('gateway/model:latest');
  });

  it('enforces list, ID, name, boolean, source and context bounds', () => {
    expect(() => normalizeModelSettings(managed({ customProviders: Array.from({ length: 13 }, (_, index) => provider(`p${index}`)) }))).toThrow();
    expect(() => normalizeModelSettings(managed({ chatgptModels: Array.from({ length: 257 }, (_, index) => model(`m${index}`)) }))).toThrow();
    for (const entry of [{ ...model('x'.repeat(201)) }, { ...model('id'), name: 'x'.repeat(101) }, { ...model('id'), enabled: 'true' }, { ...model('id'), source: 'catalog' }, { ...model('id'), contextWindow: 127 }, { ...model('id'), contextWindow: 10_000_001 }, { ...model('id'), contextWindow: 128.5 }, { ...model('id'), contextWindow: '32000' }]) expect(() => normalizeModelSettings(managed({ chatgptModels: [entry as ConfiguredModel] }))).toThrow();
    expect(normalizeModelSettings(managed({ chatgptModels: [{ id: 'x'.repeat(200), name: 'x'.repeat(100), enabled: false, contextWindow: 10_000_000 }, { id: 'minimum', enabled: true, contextWindow: 128 }] })).chatgptModels).toHaveLength(2);
    expect(() => normalizeModelSettings(managed({ customProviders: [provider('local', { name: 'x'.repeat(101) })] }))).toThrow();
  });

  it('rejects non-http, credential-bearing and parameter-bearing endpoint URLs', () => {
    for (const url of ['ftp://models.example/v1', 'file:///tmp/models', 'https://user:secret@models.example/v1', 'https://@models.example/v1', 'https://models.example/v1?key=secret', 'https://models.example/v1?', 'https://models.example/v1#secret', 'https://models.example/v1#', 'broken', 'https://models.example/\0v1']) {
      expect(() => normalizeModelSettings({ ...DEFAULT_SETTINGS, baseUrl: url })).toThrow();
      expect(() => normalizeModelSettings(managed({ customProviders: [provider('local', { baseUrl: url })] }))).toThrow();
    }
  });
});

describe('compatible endpoint discovery', () => {
  it('requests only the normalized endpoint with bearer auth and forbids redirects', async () => {
    const fetcher = fetchWith({ data: [{ id: 'my-chat', name: 'Custom Chat', context_window: 128000, reasoning: true }] });
    expect(await discoverCompatibleModels('https://models.example/v1///', 'fixture-only-secret', fetcher)).toEqual({ fetched: true, models: [{ id: 'my-chat', name: 'Custom Chat', source: 'endpoint', availability: 'available', contextWindow: 128000, reasoning: true }] });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0]).toEqual(['https://models.example/v1/models', { method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer fixture-only-secret' }, redirect: 'error', signal: expect.any(AbortSignal) }]);
  });

  it('marks inactive and scheduled shutdown models unavailable without guessing from created dates', async () => {
    const entries = [{ id: 'deprecated-model', status: 'deprecated' }, { id: 'retired-model', lifecycle_status: 'retired' }, { id: 'nested-model', lifecycle: { state: 'disabled' } }, { id: 'flag-model', shutdown: true }, { id: 'past-model', shutdown_date: '2000-01-01' }, { id: 'retired-date-model', retired_at: '2000-01-01T00:00:00Z' }, { id: 'disabled-model', enabled: false }, { id: 'future-model', shutdown_date: '2999-01-01' }, { id: 'future-retired-model', retired_at: '2999-01-01T00:00:00Z' }, { id: 'old-created-model', created: 1 }, { id: 'null-date-model', shutdown_date: null }];
    const result = await discoverCompatibleModels('https://models.example', undefined, fetchWith({ data: entries }));
    expect(result.fetched).toBe(true);
    expect(result.models.filter((item) => item.availability === 'unavailable').map((item) => item.id)).toEqual(entries.slice(0, 8).map((item) => item.id));
    expect(result.models.filter((item) => item.availability === 'available').map((item) => item.id)).toEqual(entries.slice(8).map((item) => item.id));
    expect(result.models[0].unavailableReason).toBeTruthy();
    expect(result.models[7].unavailableReason).toContain('计划');
    const malformedDate = await discoverCompatibleModels('https://models.example', undefined, fetchWith({ data: [{ id: 'invalid-date-model', shutdown_date: '2000-02-31' }] }));
    expect(malformedDate.models[0].availability).toBe('available');
  });

  it('excludes known media-only APIs and explicit non-text capabilities while retaining unknown model names', async () => {
    const entries = [{ id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'tts-1' }, { id: 'dall-e-3' }, { id: 'gpt-image-1' }, { id: 'gpt-4o-audio-preview' }, { id: 'gpt-4o-mini-transcribe' }, { id: 'embedding-custom', capabilities: ['embeddings'] }, { id: 'photo-custom', modality: 'image' }, { id: 'speech-custom', output_modalities: ['audio'] }, { id: 'vector-custom', capabilities: { embedding: true } }, { id: 'vision-chat', modalities: ['text', 'image'] }, { id: 'custom-chat', capabilities: { text_generation: true, image: true } }, { id: 'unknown-internal-v42' }];
    const result = await discoverCompatibleModels('https://models.example', undefined, fetchWith({ data: entries }));
    expect(result.models.map((item) => item.id)).toEqual(['vision-chat', 'custom-chat', 'unknown-internal-v42']);
  });

  it('accepts an empty successful catalog and deduplicates only valid model records', async () => {
    expect(await discoverCompatibleModels('https://models.example', undefined, fetchWith({ data: [] }))).toEqual({ models: [], fetched: true });
    const result = await discoverCompatibleModels('https://models.example', undefined, fetchWith({ data: [null, {}, { id: 'a\0b' }, { id: 'x'.repeat(201) }, { id: 'custom-chat', context_window: 12 }, { id: 'custom-chat' }, { id: 'another-chat', context_window: 128 }] }));
    expect(result.models).toEqual([{ id: 'custom-chat', name: 'custom-chat', source: 'endpoint', availability: 'available' }, { id: 'another-chat', name: 'another-chat', contextWindow: 128, source: 'endpoint', availability: 'available' }]);
  });

  it('returns generic errors without response bodies, URLs, exceptions or reflected credentials', async () => {
    const secret = 'fixture-only-secret';
    const fetchers = [vi.fn<typeof fetch>().mockRejectedValue(new Error(`failed with ${secret}`)), vi.fn<typeof fetch>().mockResolvedValue(new Response(`private-provider-body ${secret}`, { status: 401 })), vi.fn<typeof fetch>().mockResolvedValue(new Response(`invalid-json ${secret}`)), fetchWith({ models: [{ id: 'wrong-shape' }], private: secret }), vi.fn<typeof fetch>().mockResolvedValue(new Response(secret, { status: 302, headers: { location: `https://other.example/${secret}` } }))];
    for (const fetcher of fetchers) {
      const result = await discoverCompatibleModels('https://models.example/private-url', secret, fetcher);
      expect(result).toMatchObject({ models: [], fetched: false, warning: expect.any(String) });
      expect(JSON.stringify(result)).not.toMatch(/fixture-only-secret|private-provider-body|private-url|other\.example/);
    }
    const reflected = await discoverCompatibleModels('https://models.example', secret, fetchWith({ data: [{ id: secret }, { id: 'safe-chat', name: secret }] }));
    expect(reflected.models).toEqual([{ id: 'safe-chat', name: 'safe-chat', source: 'endpoint', availability: 'available' }]);
  });

  it('does not call fetch for an invalid URL or send an absent credential', async () => {
    const fetcher = fetchWith({ data: [] });
    expect((await discoverCompatibleModels('https://user:secret@models.example', 'secret', fetcher)).fetched).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
    await discoverCompatibleModels('http://127.0.0.1:1234/v1', undefined, fetcher);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ accept: 'application/json' });
  });

  it('rejects response bodies beyond one MiB both with and without a declared size', async () => {
    for (const headers of [{}, { 'content-length': String(1024 * 1024 + 1) }]) {
      const cancel = vi.fn();
      const large = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); }, cancel }), { headers });
      expect((await discoverCompatibleModels('https://models.example', undefined, vi.fn<typeof fetch>().mockResolvedValue(large))).fetched).toBe(false);
      expect(cancel).toHaveBeenCalledOnce();
    }
  });

  it('bounds both a stalled request and a stalled response body to four seconds', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(() => {}));
    const result = discoverCompatibleModels('https://models.example', 'fixture-only-secret', fetcher);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await result).toMatchObject({ models: [], fetched: false });
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    const stalled = discoverCompatibleModels('https://models.example', undefined, vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start() {} }))));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await stalled).toMatchObject({ models: [], fetched: false });
  });

  it('never forwards authorization to a loopback redirect target', async () => {
    const requests: { url: string; authorization: string | undefined }[] = [];
    const server = createServer((request, output: ServerResponse) => {
      requests.push({ url: request.url ?? '', authorization: request.headers.authorization });
      if (request.url === '/v1/models') output.writeHead(302, { location: '/redirect-target' }).end();
      else output.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('loopback fixture unavailable');
    expect((await discoverCompatibleModels(`http://127.0.0.1:${address.port}/v1`, 'loopback-fixture-only')).fetched).toBe(false);
    expect(requests).toEqual([{ url: '/v1/models', authorization: 'Bearer loopback-fixture-only' }]);
  });
});
