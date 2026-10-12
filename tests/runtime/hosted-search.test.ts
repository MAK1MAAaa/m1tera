import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeHostedSearchFetch, safeSearchSource } from '../../runtime/hosted-web-search.js';
import type { HostedSearchEvent, SearchSource } from '../../runtime/hosted-web-search.js';
import { RuntimeService } from '../../runtime/service.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { RequestMap, RuntimeEvent, RuntimeRequest, Settings } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); vi.restoreAllMocks(); });

function frame(type: string, data: Record<string, unknown>, newline = '\n') {
  return `event: ${type}${newline}data: ${JSON.stringify({ type, ...data })}${newline}${newline}`;
}

function bytesResponse(chunks: Uint8Array[]) {
  return new Response(new ReadableStream<Uint8Array>({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

async function observe(chunks: Uint8Array[]) {
  const searches: HostedSearchEvent[] = [];
  const sources: SearchSource[] = [];
  const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(bytesResponse(chunks));
  const wrapped = observeHostedSearchFetch((event) => searches.push(event), (source) => sources.push(source), fetcher);
  const response = await wrapped('https://example.com/responses');
  return { bytes: Buffer.from(await response.arrayBuffer()), searches, sources };
}

describe('hosted search SSE observer', () => {
  it('rejects executable, malformed, credential-bearing and oversized source URLs', () => {
    expect(safeSearchSource({ url: 'https://example.com/article', title: 'x'.repeat(220) })).toEqual({ url: 'https://example.com/article', title: 'x'.repeat(200) });
    expect(safeSearchSource({ url: 'https://example.com' })).toEqual({ title: 'example.com', url: 'https://example.com/' });
    for (const url of ['javascript:alert(1)', 'data:text/html,x', 'file:///tmp/private', 'https://user:password@example.com', 'broken', `https://example.com/${'x'.repeat(2050)}`]) expect(safeSearchSource({ url })).toBeUndefined();
    expect(safeSearchSource(null)).toBeUndefined();
    expect(safeSearchSource({ title: 'missing URL' })).toBeUndefined();
  });

  it('preserves exact SSE bytes across split UTF-8 and CRLF, with deduplicated search and citations', async () => {
    const source = { url: 'https://example.com/paper', title: '原始论文' };
    const search = { type: 'web_search_call', id: 'ws_1', status: 'in_progress' };
    const completed = { ...search, status: 'completed', action: { type: 'search', sources: [source, source] } };
    const message = { type: 'message', id: 'msg_1', content: [{ type: 'output_text', text: '有来源的答案', annotations: [{ type: 'url_citation', ...source }] }] };
    const text = frame('response.output_item.added', { item: search }, '\r\n')
      + frame('response.output_item.done', { item: completed }, '\r\n')
      + frame('response.output_text.annotation.added', { annotation: { type: 'url_citation', url_citation: source } }, '\r\n')
      + frame('response.output_item.done', { item: message }, '\r\n')
      + frame('response.completed', { response: { output: [completed, message] } }, '\r\n')
      + 'data: [DONE]\r\n\r\n';
    const expected = Buffer.from(text);
    // A one-byte stream splits every multibyte codepoint and every CRLF boundary.
    const observed = await observe([...expected].map((byte) => Uint8Array.of(byte)));
    expect(observed.bytes).toEqual(expected);
    expect(observed.searches).toEqual([{ id: 'ws_1', status: 'started' }, { id: 'ws_1', status: 'finished', isError: false }]);
    expect(observed.sources).toEqual([source]);
  });

  it('marks failed search completion, ignores unsafe citations, and caps source metadata at 12 entries', async () => {
    const sources = Array.from({ length: 15 }, (_, index) => ({ title: `Source ${index}`, url: `https://example.com/${index}` }));
    const text = frame('response.output_item.done', { item: { type: 'web_search_call', id: 'ws_failed', status: 'failed', action: { sources } } })
      + frame('response.output_text.annotation.added', { annotation: { type: 'url_citation', url: 'javascript:alert(1)', title: 'unsafe' } });
    const observed = await observe([Buffer.from(text)]);
    expect(observed.searches).toEqual([{ id: 'ws_failed', status: 'started' }, { id: 'ws_failed', status: 'finished', isError: true }]);
    expect(observed.sources).toEqual(sources.slice(0, 12));
  });

  it('recovers after an oversized or malformed frame while passing all original bytes through', async () => {
    const oversized = `data: ${JSON.stringify({ type: 'unknown', filler: 'x'.repeat(1024 * 1024 + 20) })}`;
    const after = '\n\n' + 'data: not-json\n\n' + frame('response.output_item.done', { item: { type: 'web_search_call', id: 'ws_after', status: 'completed' } });
    const observed = await observe([Buffer.from(oversized), Buffer.from(after)]);
    expect(observed.bytes).toEqual(Buffer.from(oversized + after));
    expect(observed.searches).toEqual([{ id: 'ws_after', status: 'started' }, { id: 'ws_after', status: 'finished', isError: false }]);
  });

  it('propagates downstream cancellation to the original response body and preserves the request signal', async () => {
    const cancelled = vi.fn();
    const searches: HostedSearchEvent[] = [];
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(Buffer.from(frame('response.output_item.added', { item: { type: 'web_search_call', id: 'ws_cancel', status: 'in_progress' } }))); },
      cancel: cancelled,
    }), { headers: { 'content-type': 'text/event-stream' } });
    const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
    const signal = new AbortController().signal;
    const wrapped = await observeHostedSearchFetch((event) => searches.push(event), () => {}, fetcher)('https://example.com/responses', { signal });
    const reader = wrapped.body!.getReader();
    await reader.read();
    await reader.cancel('user stopped');
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0][1]?.signal).toBe(signal);
    expect(searches).toEqual([{ id: 'ws_cancel', status: 'started' }]);
  });

  it('leaves non-SSE and rejected responses untouched', async () => {
    for (const response of [new Response('plain', { headers: { 'content-type': 'text/plain' } }), new Response('denied', { status: 403, headers: { 'content-type': 'text/event-stream' } })]) {
      const fetcher = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response);
      const onSearch = vi.fn();
      const wrapped = await observeHostedSearchFetch(onSearch, () => {}, fetcher)('https://example.com/responses');
      expect(wrapped).toBe(response);
      expect(onSearch).not.toHaveBeenCalled();
    }
  });
});

interface RequestBody { tools?: { type: string }[]; tool_choice?: unknown; include?: string[]; input?: unknown[] }

function send(response: ServerResponse, type: string, data: Record<string, unknown>) { response.write(frame(type, data)); }

function responseAnswer(response: ServerResponse, withSearch: boolean) {
  const source = { title: 'Verified source', url: 'https://example.com/reference' };
  const search = { type: 'web_search_call', id: 'ws_native', status: 'completed', action: { type: 'search', sources: [source] } };
  const annotations = withSearch ? [{ type: 'url_citation', ...source, start_index: 0, end_index: 6 }] : [];
  const message = { type: 'message', id: 'msg_native', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '原生检索答案', annotations }] };
  send(response, 'response.created', { response: { id: 'resp_native', status: 'in_progress' } });
  if (withSearch) {
    send(response, 'response.output_item.added', { output_index: 0, item: { ...search, status: 'in_progress' } });
    send(response, 'response.output_item.done', { output_index: 0, item: search });
  }
  send(response, 'response.output_item.added', { output_index: withSearch ? 1 : 0, item: { ...message, content: [] } });
  send(response, 'response.output_text.delta', { output_index: withSearch ? 1 : 0, content_index: 0, delta: '原生检索答案' });
  if (withSearch) send(response, 'response.output_text.annotation.added', { output_index: 1, content_index: 0, annotation_index: 0, annotation: annotations[0] });
  send(response, 'response.output_item.done', { output_index: withSearch ? 1 : 0, item: message });
  send(response, 'response.completed', { response: { id: 'resp_native', status: 'completed', output: withSearch ? [search, message] : [message], usage: { input_tokens: 211, output_tokens: 10, total_tokens: 221, input_tokens_details: { cached_tokens: 12 } } } });
  response.end();
}

async function result<M extends keyof RequestMap>(service: RuntimeService, method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
  const response = await service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
  expect(response.error).toBeUndefined();
  return response.result as RequestMap[M]['result'];
}

async function runtimeFixture(respond: (response: ServerResponse, index: number) => void) {
  const bodies: RequestBody[] = [];
  const backend = createServer(async (request, response) => {
    let body = '';
    for await (const data of request) body += data;
    bodies.push(JSON.parse(body) as RequestBody);
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    respond(response, bodies.length - 1);
  });
  await new Promise<void>((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const address = backend.address();
  if (!address || typeof address === 'string') throw new Error('test server unavailable');
  cleanup.push(async () => { backend.closeAllConnections(); await new Promise<void>((resolve) => backend.close(() => resolve())); });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-hosted-search-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: directory, emit: (event) => events.push(event) });
  cleanup.push(() => service.shutdown());
  // Force the official hosted branch against a loopback SSE fixture; no OpenAI account or network is used.
  vi.spyOn(service as unknown as { hostedSearch: (settings: Settings) => boolean }, 'hostedSearch').mockReturnValue(true);
  await result(service, 'settings.set', { settings: { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'responses', model: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, contextWindow: 256_000 }, apiKey: 'local-fixture-only' });
  const session = await result(service, 'sessions.create', {});
  return { service, session, events, bodies };
}

describe('hosted search runtime integration', () => {
  it('injects native search only for its run, observes sources and events, and reports its 128k context limit', async () => {
    const { service, session, events, bodies } = await runtimeFixture((response, index) => responseAnswer(response, index === 0));
    const preview = await result(service, 'context.preview', { sessionId: session.id, text: '检索当前资料', command: 'websearch' });
    expect(preview.contextWindow).toBe(128_000);
    expect(preview.toolCount).toBe(1);
    await result(service, 'run.start', { sessionId: session.id, text: '检索当前资料', command: 'websearch' });
    await service.waitForIdle();
    expect(bodies[0].tools).toContainEqual({ type: 'web_search', search_context_size: 'low' });
    expect(bodies[0].tool_choice).toEqual({ type: 'web_search' });
    expect(bodies[0].include).toContain('web_search_call.action.sources');
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool.started', toolCallId: 'ws_native', toolName: 'web_search' }));
    expect(events).toContainEqual(expect.objectContaining({ type: 'tool.finished', toolCallId: 'ws_native', isError: false }));
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'completed' });
    const loaded = await result(service, 'sessions.load', { sessionId: session.id });
    expect(loaded.messages.findLast((message) => message.role === 'assistant')?.sources).toEqual([{ title: 'Verified source', url: 'https://example.com/reference' }]);
    const usage = events.findLast((event) => event.type === 'context' && event.usage !== null);
    expect(usage).toMatchObject({ estimate: { contextWindow: 128_000 }, usage: { totalInput: 211, cacheRead: 12 } });

    await result(service, 'run.start', { sessionId: session.id, text: '下一轮普通聊天' });
    await service.waitForIdle();
    expect(bodies[1].tools?.some((tool) => tool.type === 'web_search') ?? false).toBe(false);
    expect(bodies[1].tool_choice).not.toEqual({ type: 'web_search' });
    expect(bodies[1].include ?? []).not.toContain('web_search_call.action.sources');
    expect((await result(service, 'context.preview', { sessionId: session.id })).contextWindow).toBe(256_000);
  });

  it('reports failure when the endpoint answers without an actual native search event', async () => {
    const { service, session, events } = await runtimeFixture((response) => responseAnswer(response, false));
    await result(service, 'run.start', { sessionId: session.id, text: '要求联网检索', command: 'websearch' });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'error', error: expect.stringContaining('未完成') });
    expect(events.some((event) => event.type === 'tool.finished' && !event.isError)).toBe(false);
  });

  it('cancels a streaming native search without announcing a completed search', async () => {
    const { service, session, events } = await runtimeFixture((response) => {
      send(response, 'response.created', { response: { id: 'resp_native', status: 'in_progress' } });
      send(response, 'response.output_item.added', { output_index: 0, item: { type: 'web_search_call', id: 'ws_pending', status: 'in_progress' } });
    });
    await result(service, 'run.start', { sessionId: session.id, text: '开始长时间检索', command: 'websearch' });
    await vi.waitFor(() => expect(events.some((event) => event.type === 'tool.started')).toBe(true));
    await result(service, 'run.cancel', { sessionId: session.id });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'cancelled' });
    expect(events.some((event) => event.type === 'tool.finished' && !event.isError)).toBe(false);
  });
});
