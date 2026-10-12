import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { RuntimeService } from '../../runtime/service.js';
import { startJsonlRuntime } from '../../runtime/index.js';
import { createTools, executeCommand } from '../../runtime/tools.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import { ChatGPTAuth } from '../../runtime/chatgpt-auth.js';
import { AssistantMessageEventStream } from '@earendil-works/pi-ai';
import type { AssistantMessage, Model, SimpleStreamOptions } from '@earendil-works/pi-ai';
import type { ModelOption, RuntimeEnvelope, RuntimeEvent, RuntimeRequest, Session, SessionCategory, Settings, ToolName, Workspace } from '../../shared/protocol.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); vi.restoreAllMocks(); });

type Body = { messages: { role: string; content?: string; tool_calls?: unknown[] }[]; input?: { role?: string; type?: string; output?: string }[]; tools?: { function: { name: string }; name?: string }[]; model: string };

async function fixture(respond?: (body: Body, response: ServerResponse, index: number) => void) {
  const bodies: Body[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let content = '';
    for await (const chunk of request) content += chunk;
    const body = JSON.parse(content) as Body;
    bodies.push(body);
    response.statusCode = 200;
    response.setHeader('content-type', 'text/event-stream');
    response.setHeader('cache-control', 'no-cache');
    if (respond) respond(body, response, bodies.length - 1);
    else answer(response, '收到', { prompt_tokens: 24, completion_tokens: 2, total_tokens: 26, prompt_tokens_details: { cached_tokens: 6 } });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server address unavailable');
  cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, bodies };
}

function chunk(response: ServerResponse, delta: unknown, finish: string | null = null) {
  response.write(`data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}

function answer(response: ServerResponse, text: string, usage?: unknown) {
  chunk(response, { role: 'assistant', content: text });
  chunk(response, {}, 'stop');
  if (usage) response.write(`data: ${JSON.stringify({ choices: [], usage })}\n\n`);
  response.end('data: [DONE]\n\n');
}

function toolCall(response: ServerResponse, name: string, args: unknown, id = 'tool-1') {
  chunk(response, { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  chunk(response, {}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

function responseEvent(response: ServerResponse, type: string, data: Record<string, unknown>) {
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
}

function responseAnswer(response: ServerResponse, tool?: { name: string; args: unknown }, inputTokens = 20) {
  const item = tool
    ? { type: 'function_call', id: 'fc_fixture', call_id: 'call_fixture', name: tool.name, arguments: JSON.stringify(tool.args), status: 'completed' }
    : { type: 'message', id: 'msg_fixture', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Responses 完成', annotations: [] }] };
  responseEvent(response, 'response.created', { response: { id: 'resp_fixture', status: 'in_progress' } });
  responseEvent(response, 'response.output_item.added', { output_index: 0, item: { ...item, ...(tool ? { arguments: '' } : { content: [] }) } });
  if (tool) responseEvent(response, 'response.function_call_arguments.delta', { output_index: 0, delta: JSON.stringify(tool.args) });
  else responseEvent(response, 'response.output_text.delta', { output_index: 0, content_index: 0, delta: 'Responses 完成' });
  responseEvent(response, 'response.output_item.done', { output_index: 0, item });
  responseEvent(response, 'response.completed', { response: { id: 'resp_fixture', status: 'completed', output: [item], usage: { input_tokens: inputTokens, output_tokens: 2, total_tokens: inputTokens + 2, input_tokens_details: { cached_tokens: 5 } } } });
  response.end();
}

async function waitUntil(predicate: () => boolean, timeout = 5000) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeout) throw new Error('Timed out waiting for runtime event');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function createRuntime(baseUrl: string, extra: Partial<Settings> = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-runtime-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(workspace);
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: (event) => events.push(event) });
  cleanup.push(() => service.shutdown());
  const settings: Settings = { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'chat-completions', baseUrl, model: 'fixture', workspace, ...extra };
  if (settings.connection === 'chatgpt' && settings.chatgptModels === undefined) settings.chatgptModels = [{ id: settings.model, enabled: true, source: 'manual' }];
  const response = await request(service, 'settings.set', { settings, apiKey: 'test-memory-only-secret' });
  expect(response.error).toBeUndefined();
  const session = (await request(service, 'sessions.create', {})).result as Session;
  return { service, directory, workspace, events, session };
}

async function request(service: RuntimeService, method: RuntimeRequest['method'], params: unknown) {
  return service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
}

async function configure(service: RuntimeService, session: Session, enabledTools: ToolName[], workspace: string) {
  expect((await request(service, 'sessions.configure', { sessionId: session.id, enabledTools, workspace })).error).toBeUndefined();
}

describe('runtime requests and context', () => {
  it('lists only the explicit official default as unverified without account credentials', async () => {
    const backend = await fixture();
    const { service } = await createRuntime(backend.baseUrl, { connection: 'chatgpt', model: DEFAULT_SETTINGS.model });
    const response = await request(service, 'models.list', {});
    expect(response.error).toBeUndefined();
    const options = response.result as ModelOption[];
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: DEFAULT_SETTINGS.model, providerId: 'chatgpt', enabled: true, availability: 'unverified' });
    expect(backend.bodies).toHaveLength(0);
  });

  it('fetches an authenticated compatible model catalog while preserving a configured model and hiding failed response bodies', async () => {
    const requests: { url?: string; key?: string }[] = [];
    let fail = false;
    const server = createServer((incoming, response) => {
      requests.push({ url: incoming.url, key: incoming.headers.authorization });
      response.writeHead(fail ? 403 : 200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(fail ? { error: 'provider-private-error test-memory-only-secret' } : { data: [{ id: 'fixture' }, { id: 'local-small', name: 'Local Small', context_window: 8192, reasoning: false }, { id: '' }, { name: 'missing-id' }] }));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    cleanup.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('address missing');
    const { service } = await createRuntime(`http://127.0.0.1:${address.port}/v1`);
    const listed = (await request(service, 'models.list', {})).result as ModelOption[];
    expect(listed.filter((item) => item.providerId === 'custom-default')).toEqual([
      { id: 'fixture', name: 'fixture', source: 'endpoint', providerId: 'custom-default', providerName: '自定义接口', enabled: true, availability: 'available' },
      { id: 'local-small', name: 'Local Small', contextWindow: 8192, reasoning: false, source: 'endpoint', providerId: 'custom-default', providerName: '自定义接口', enabled: false, availability: 'available' },
    ]);
    expect(requests[0]).toEqual({ url: '/v1/models', key: 'Bearer test-memory-only-secret' });
    fail = true;
    const failed = await request(service, 'models.list', {});
    expect(failed.error).toBeUndefined();
    expect((failed.result as ModelOption[]).filter((item) => item.providerId === 'custom-default')).toEqual(listed.filter((item) => item.providerId === 'custom-default').map((item) => ({ ...item, availability: 'unverified', catalogWarning: expect.any(String) })));
    expect(JSON.stringify(failed)).not.toContain('provider-private-error');
    expect(JSON.stringify(failed)).not.toContain('test-memory-only-secret');
    const settings = ((await request(service, 'settings.get', {})).result as { settings: Settings }).settings;
    const selected: Settings = { ...settings, model: 'local-small', customProviders: settings.customProviders?.map((provider) => provider.id === settings.providerId ? { ...provider, models: [...provider.models, { id: 'local-small', enabled: true, source: 'endpoint' }] } : provider) };
    expect((await request(service, 'settings.set', { settings: selected })).error).toBeUndefined();
    expect((await request(service, 'context.preview', {})).result).toMatchObject({ contextWindow: 8192 });
    fail = false;
    expect((await request(service, 'models.discover', { providerId: selected.providerId })).error).toBeUndefined();
    expect((await request(service, 'context.preview', {})).result).toMatchObject({ contextWindow: 8192 });
    await request(service, 'settings.set', { settings: { ...selected, systemPrompt: 'Changed prompt' } });
    expect((await request(service, 'context.preview', {})).result).toMatchObject({ contextWindow: 8192 });
    await request(service, 'settings.set', { settings: selected, apiKey: 'different-account-test-key' });
    expect((await request(service, 'context.preview', {})).result).toMatchObject({ contextWindow: null });
  });

  it('persists workspaces, categories, pin and manual session titles without adding organization metadata to model input', async () => {
    const backend = await fixture();
    const { service, workspace, directory } = await createRuntime(backend.baseUrl, { systemPrompt: '' });
    const concurrent = await Promise.all([
      request(service, 'workspaces.create', { path: workspace, name: 'WORKSPACE_METADATA_SENTINEL' }),
      request(service, 'workspaces.create', { path: path.join(workspace, '.'), name: 'Duplicate' }),
      request(service, 'categories.create', { name: 'CATEGORY_METADATA_SENTINEL' }),
    ]);
    expect(concurrent.every((response) => !response.error)).toBe(true);
    const createdWorkspace = concurrent[0].result as Workspace;
    expect((concurrent[1].result as Workspace).id).toBe(createdWorkspace.id);
    const category = concurrent[2].result as SessionCategory;
    const session = (await request(service, 'sessions.create', { workspaceId: createdWorkspace.id, categoryId: category.id })).result as Session;
    expect(session).toMatchObject({ enabledTools: [], workspaceId: createdWorkspace.id, workspace: createdWorkspace.path, categoryId: category.id, pinned: false, approvalMode: 'ask' });
    expect((await request(service, 'sessions.update', { sessionId: session.id, title: '新会话', pinned: true })).error).toBeUndefined();
    await request(service, 'run.start', { sessionId: session.id, text: '第一轮用户消息' });
    await service.waitForIdle();
    const loaded = (await request(service, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(loaded.title).toBe('新会话');
    expect(loaded.pinned).toBe(true);
    expect(JSON.stringify(backend.bodies)).not.toContain('WORKSPACE_METADATA_SENTINEL');
    expect(JSON.stringify(backend.bodies)).not.toContain('CATEGORY_METADATA_SENTINEL');
    expect(JSON.stringify(backend.bodies)).not.toContain(createdWorkspace.id);
    expect(JSON.stringify(backend.bodies)).not.toContain(category.id);
    expect(JSON.stringify(backend.bodies)).not.toContain(workspace);
    expect(JSON.stringify(backend.bodies)).not.toContain(createdWorkspace.path);
    expect(((await request(service, 'sessions.list', {})).result as Session[])[0].id).toBe(session.id);
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: () => {} });
    cleanup.push(() => restored.shutdown());
    expect((await request(restored, 'organization.get', {})).result).toEqual({ workspaces: [createdWorkspace], categories: [category] });
    expect((await request(restored, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ title: '新会话', pinned: true, workspaceId: createdWorkspace.id, categoryId: category.id });
    expect((await request(restored, 'sessions.update', { sessionId: session.id, categoryId: null, workspaceId: null })).result).toMatchObject({ workspace: '' });
    const moved = (await request(restored, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(moved.categoryId).toBeUndefined();
    expect(moved.workspaceId).toBeUndefined();
  });

  it('rejects invalid workspace paths, empty names and unknown organization references without partial updates', async () => {
    const backend = await fixture();
    const { service, session, workspace } = await createRuntime(backend.baseUrl);
    const file = path.join(workspace, 'not-directory.txt');
    await writeFile(file, 'file');
    expect((await request(service, 'workspaces.create', { path: file })).error?.code).toBe('INVALID_WORKSPACE');
    expect((await request(service, 'categories.create', { name: '   ' })).error?.code).toBe('INVALID_PARAMS');
    expect((await request(service, 'sessions.create', { workspaceId: 'unknown' })).error?.code).toBe('NOT_FOUND');
    expect((await request(service, 'sessions.update', { sessionId: session.id, title: 'Should not persist', categoryId: 'unknown' })).error?.code).toBe('NOT_FOUND');
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ title: '新会话' });
    expect((await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['read_file'], approvalMode: 'invalid' })).error?.code).toBe('INVALID_PARAMS');
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ enabledTools: [], approvalMode: 'ask' });
  });

  it('loads legacy session JSON without new metadata and keeps legacy configure/create requests valid', async () => {
    const backend = await fixture();
    const { service, session, directory, workspace } = await createRuntime(backend.baseUrl);
    expect(session).toMatchObject({ workspace: '', enabledTools: [], approvalMode: 'ask' });
    await service.shutdown();
    const filename = path.join(directory, 'appdata', 'sessions', `${session.id}.json`);
    const stored = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>;
    stored.workspace = workspace;
    for (const name of ['pinned', 'categoryId', 'workspaceId', 'approvalMode', 'titleSource']) delete stored[name];
    await writeFile(filename, JSON.stringify(stored));
    const restored = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: () => {} });
    cleanup.push(() => restored.shutdown());
    expect((await request(restored, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ approvalMode: 'ask', pinned: false, workspace });
    expect((await request(restored, 'organization.get', {})).result).toEqual({ workspaces: [], categories: [] });
    expect((await request(restored, 'sessions.create', {})).result).toMatchObject({ enabledTools: [], approvalMode: 'ask', workspace: '' });
    expect((await request(restored, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['read_file'] })).result).toMatchObject({ approvalMode: 'ask', enabledTools: ['read_file'] });
  });

  it('sends the same ChatGPT credential that was registered for redaction instead of resolving another token', async () => {
    const checkedToken = 'oauth-checked-access-token';
    const refreshedToken = 'oauth-unregistered-refresh-token';
    const received: (SimpleStreamOptions | undefined)[] = [];
    vi.spyOn(ChatGPTAuth.prototype, 'status').mockReturnValue({ connected: true, loginPending: false });
    vi.spyOn(ChatGPTAuth.prototype, 'getAuth').mockResolvedValue({ apiKey: checkedToken });
    vi.spyOn(ChatGPTAuth.prototype, 'getModel').mockReturnValue({ id: 'fixture', name: 'fixture', api: 'openai-responses', provider: 'openai', baseUrl: 'https://api.openai.com/v1', reasoning: false, input: ['text'], contextWindow: 128000, maxTokens: 4096, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as Model<'openai-responses'>);
    vi.spyOn(ChatGPTAuth.prototype, 'getStreamFn').mockReturnValue((model, _context, options) => {
      received.push(options);
      // Models resolves a new credential when no explicit token is passed at the refresh threshold.
      const token = options?.apiKey ?? refreshedToken;
      const error: AssistantMessage = { role: 'assistant', content: [], api: model.api, provider: model.provider, model: model.id, stopReason: 'error', errorMessage: `Provider rejected ${token}`, timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = new AssistantMessageEventStream();
      stream.push({ type: 'error', reason: 'error', error });
      stream.end(error);
      return stream;
    });
    const backend = await fixture();
    const { service, session, events, directory } = await createRuntime(backend.baseUrl, { connection: 'chatgpt', model: 'fixture', apiFormat: 'responses' });
    await request(service, 'run.start', { sessionId: session.id, text: '测试认证' });
    await service.waitForIdle();
    expect(received[0]?.apiKey).toBe(checkedToken);
    expect(JSON.stringify(events)).not.toContain(checkedToken);
    expect(JSON.stringify(events)).not.toContain(refreshedToken);
    const saved = await readFile(path.join(directory, 'appdata', 'sessions', `${session.id}.json`), 'utf8');
    expect(saved).not.toContain(checkedToken);
    expect(saved).not.toContain(refreshedToken);
  });

  it('reports incomplete usage with output-only counts as unknown input rather than zero', async () => {
    const backend = await fixture((_body, response) => answer(response, '仅报告输出', { completion_tokens: 2, total_tokens: 2 }));
    const { service, session, events } = await createRuntime(backend.baseUrl);
    await request(service, 'run.start', { sessionId: session.id, text: '这条消息具有输入 token' });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'context')).toMatchObject({ usage: null });
  });

  it('exposes 0/4/20-tool baseline estimates and live measurements without executing tools or writing sessions', async () => {
    const backend = await fixture((_body, response) => toolCall(response, 'write_file', { path: 'baseline-must-not-write.txt', content: 'forbidden' }));
    const { service, session, workspace, events, directory } = await createRuntime(backend.baseUrl);
    const estimated = await request(service, 'context.baseline', { live: false });
    expect(estimated.error).toBeUndefined();
    expect(estimated.result).toMatchObject({ mode: 'estimate', cases: [{ toolCount: 0, usage: null }, { toolCount: 4, usage: null }, { toolCount: 20, usage: null }] });
    expect(backend.bodies).toHaveLength(0);
    const measured = await request(service, 'context.baseline', { live: true });
    expect(measured.error).toBeUndefined();
    expect(measured.result).toMatchObject({ mode: 'live', cases: [{ toolCount: 0 }, { toolCount: 4 }, { toolCount: 20 }] });
    expect(backend.bodies).toHaveLength(3);
    const savedReport = await readFile(path.join(directory, 'appdata', 'context-baseline.json'), 'utf8');
    expect(JSON.parse(savedReport)).toEqual(measured.result);
    expect(savedReport).not.toContain('test-memory-only-secret');
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ messages: [] });
    await expect(readFile(path.join(workspace, 'baseline-must-not-write.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects concurrent live baselines and aborts a pending measurement on shutdown', async () => {
    const backend = await fixture((_body, response) => { chunk(response, { role: 'assistant', content: '等待' }); });
    const { service } = await createRuntime(backend.baseUrl);
    const measurement = request(service, 'context.baseline', { live: true });
    await waitUntil(() => backend.bodies.length > 0);
    expect((await request(service, 'context.baseline', { live: true })).error?.code).toBe('BASELINE_ACTIVE');
    expect((await request(service, 'sessions.list', {})).error).toBeUndefined();
    await service.shutdown();
    expect((await measurement).error).toBeUndefined();
  });

  it('supports Responses streaming and tool chains while reporting only first request usage', async () => {
    const backend = await fixture((_body, response, index) => responseAnswer(response, index === 0 ? { name: 'read_file', args: { path: 'note.txt' } } : undefined, index === 0 ? 20 : 100));
    const { service, session, workspace, events } = await createRuntime(backend.baseUrl, { apiFormat: 'responses' });
    await writeFile(path.join(workspace, 'note.txt'), 'workspace note');
    await configure(service, session, ['read_file'], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '读文件' });
    await service.waitForIdle();
    expect(backend.bodies).toHaveLength(2);
    expect(backend.bodies[0].tools?.map((tool) => tool.name)).toEqual(['read_file']);
    expect(backend.bodies[1].input?.find((message) => message.type === 'function_call_output')?.output).toBe('workspace note');
    const measured = events.filter((event) => event.type === 'context' && event.usage !== null);
    expect(measured.length).toBeGreaterThanOrEqual(1);
    expect(measured.every((event) => event.type === 'context' && event.usage?.totalInput === 20)).toBe(true);
    const firstMeasured = measured[0];
    const lastMeasured = measured.at(-1);
    if (firstMeasured.type === 'context' && lastMeasured?.type === 'context') expect(lastMeasured.estimate.history).toBeGreaterThan(firstMeasured.estimate.history);
    expect(measured[0]).toMatchObject({ usage: { input: 15, cacheRead: 5, totalInput: 20 }, estimate: { toolCount: 1 } });
    expect(events.some((event) => event.type === 'text.delta' && event.delta === 'Responses 完成')).toBe(true);
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'completed' });
  });

  it('sends only the selected prompt and tools, streams, counts cached input, and keeps fresh sessions tool-free', async () => {
    const backend = await fixture();
    const { service, session, events, workspace } = await createRuntime(backend.baseUrl, { systemPrompt: '', enabledTools: ['run_command'] });
    expect(session.enabledTools).toEqual([]);
    expect((await request(service, 'run.start', { sessionId: session.id, text: '你好' })).error).toBeUndefined();
    await service.waitForIdle();
    expect(backend.bodies[0].tools).toBeUndefined();
    expect(backend.bodies[0].messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '你好' }] }]);
    expect(events.some((event) => event.type === 'text.delta' && event.delta === '收到')).toBe(true);
    const measured = events.findLast((event) => event.type === 'context' && event.usage !== null);
    expect(measured?.type === 'context' && measured.usage).toMatchObject({ input: 18, cacheRead: 6, totalInput: 24, source: 'provider' });
    await configure(service, session, ['list_directory', 'read_file'], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '第二轮' });
    await service.waitForIdle();
    expect(backend.bodies[1].tools?.map((tool) => tool.function.name)).toEqual(['list_directory', 'read_file']);
    await configure(service, session, [], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '第三轮' });
    await service.waitForIdle();
    expect(backend.bodies[2].tools).toBeUndefined();
    expect(JSON.stringify(backend.bodies[2])).not.toContain('run_command');
  });

  it('reports missing usage as unknown, persists messages/tools, and never stores or returns the API key', async () => {
    const backend = await fixture((_body, response) => answer(response, '没有 usage'));
    const { service, session, directory, workspace, events } = await createRuntime(backend.baseUrl);
    await configure(service, session, ['read_file'], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '测试' });
    await service.waitForIdle();
    expect(events.filter((event) => event.type === 'context').every((event) => event.type === 'context' && event.usage === null)).toBe(true);
    const root = path.join(directory, 'appdata');
    const settingsText = await readFile(path.join(root, 'settings.json'), 'utf8');
    const sessionText = await readFile(path.join(root, 'sessions', `${session.id}.json`), 'utf8');
    expect(settingsText + sessionText).not.toContain('test-memory-only-secret');
    expect(JSON.stringify(await request(service, 'settings.get', {}))).not.toContain('test-memory-only-secret');
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: root, emit: () => {} });
    cleanup.push(() => restored.shutdown());
    const loaded = (await request(restored, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(loaded.messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(loaded.enabledTools).toEqual(['read_file']);
    expect((await request(restored, 'settings.get', {})).result).toMatchObject({ hasApiKey: false });
    expect((await readdir(path.join(root, 'sessions'))).filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });

  it('redacts credentials echoed by a provider error before events or persistence', async () => {
    const backend = await fixture((_body, response) => {
      response.statusCode = 401;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ error: { message: 'Rejected test-memory-only-secret', type: 'authentication_error' } }));
    });
    const { service, session, events, directory } = await createRuntime(backend.baseUrl);
    await request(service, 'run.start', { sessionId: session.id, text: '触发错误' });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'error' });
    expect(JSON.stringify(events)).not.toContain('test-memory-only-secret');
    expect(await readFile(path.join(directory, 'appdata', 'sessions', `${session.id}.json`), 'utf8')).not.toContain('test-memory-only-secret');
  });
});

describe('tool permissions and recovery', () => {
  it('automatically approves an enabled write, emits a visible audit event and retains the session policy after restart', async () => {
    const backend = await fixture((_body, response, index) => index === 0 ? toolCall(response, 'write_file', { path: 'auto.txt', content: 'automatic write' }) : answer(response, '完成'));
    const { service, session, workspace, directory, events } = await createRuntime(backend.baseUrl);
    const configured = await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' });
    expect(configured.result).toMatchObject({ approvalMode: 'auto' });
    await request(service, 'run.start', { sessionId: session.id, text: '创建文件' });
    await service.waitForIdle();
    expect(await readFile(path.join(workspace, 'auto.txt'), 'utf8')).toBe('automatic write');
    expect(events.some((event) => event.type === 'approval.requested')).toBe(false);
    expect(events.filter((event) => event.type === 'approval.resolved')).toMatchObject([{ sessionId: session.id, approved: true, automatic: true, toolName: 'write_file' }]);
    expect((await request(service, 'sessions.create', {})).result).toMatchObject({ approvalMode: 'ask', enabledTools: [] });
    await service.shutdown();
    const restored = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: () => {} });
    cleanup.push(() => restored.shutdown());
    expect((await request(restored, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ approvalMode: 'auto' });
  });

  it.each(['outside-path', 'disabled-tool'])('keeps runtime boundaries in automatic approval mode (%s)', async (kind) => {
    const backend = await fixture((_body, response, index) => index === 0
      ? toolCall(response, kind === 'outside-path' ? 'write_file' : 'run_command', kind === 'outside-path' ? { path: '../outside.txt', content: 'forbidden' } : { command: 'echo forbidden > forbidden.txt' })
      : answer(response, '工具失败'));
    const { service, session, workspace, directory, events } = await createRuntime(backend.baseUrl);
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['write_file'], approvalMode: 'auto' });
    await request(service, 'run.start', { sessionId: session.id, text: '尝试受限操作' });
    await service.waitForIdle();
    expect(events.some((event) => event.type === 'tool.finished' && event.isError)).toBe(true);
    expect(events.some((event) => event.type === 'approval.resolved' && event.approved)).toBe(false);
    await expect(readFile(path.join(directory, 'outside.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(path.join(workspace, 'forbidden.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('cancels an automatically approved command and forbids approval/workspace changes during the run', async () => {
    if (process.platform === 'win32') return;
    const backend = await fixture((_body, response) => toolCall(response, 'run_command', { command: 'sleep 1; echo survived > auto-survived.txt' }));
    const { service, session, workspace, events } = await createRuntime(backend.baseUrl);
    const organizationWorkspace = (await request(service, 'workspaces.create', { path: workspace })).result as Workspace;
    await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['run_command'], approvalMode: 'auto' });
    await request(service, 'run.start', { sessionId: session.id, text: '执行命令' });
    await waitUntil(() => events.some((event) => event.type === 'approval.resolved' && event.automatic));
    expect((await request(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools: ['run_command'], approvalMode: 'ask' })).error?.code).toBe('RUN_ACTIVE');
    expect((await request(service, 'sessions.update', { sessionId: session.id, workspaceId: organizationWorkspace.id })).error?.code).toBe('RUN_ACTIVE');
    expect((await request(service, 'sessions.update', { sessionId: session.id, title: 'Running renamed', pinned: true })).error).toBeUndefined();
    await request(service, 'run.cancel', { sessionId: session.id });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'cancelled' });
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(readFile(path.join(workspace, 'auto-survived.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await request(service, 'sessions.load', { sessionId: session.id })).result).toMatchObject({ title: 'Running renamed', pinned: true, approvalMode: 'auto' });
  });

  it('preserves the submitted message when cancelled before the first provider request', async () => {
    const backend = await fixture();
    const { service, session, events } = await createRuntime(backend.baseUrl);
    await request(service, 'run.start', { sessionId: session.id, text: '立即停止' });
    await request(service, 'run.cancel', { sessionId: session.id });
    await service.waitForIdle();
    expect(backend.bodies).toHaveLength(0);
    const loaded = (await request(service, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(loaded.messages).toMatchObject([{ role: 'user', text: '立即停止' }]);
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'cancelled' });
  });

  it('freezes settings and the credential at run start, even while approval is pending', async () => {
    const backend = await fixture((_body, response, index) => index === 0 ? toolCall(response, 'write_file', { path: 'snapshot.txt', content: 'snapshot' }) : answer(response, '完成'));
    const { service, session, workspace, events } = await createRuntime(backend.baseUrl, { systemPrompt: 'original prompt' });
    await configure(service, session, ['write_file'], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '写入' });
    await waitUntil(() => events.some((event) => event.type === 'approval.requested'));
    const approval = events.find((event) => event.type === 'approval.requested');
    if (approval?.type !== 'approval.requested') throw new Error('approval missing');
    await request(service, 'settings.set', { settings: { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'chat-completions', baseUrl: backend.baseUrl, model: 'changed', systemPrompt: 'changed prompt', workspace, enabledTools: [] }, apiKey: 'changed-secret' });
    expect((await request(service, 'sessions.configure', { sessionId: session.id, enabledTools: [], workspace })).error?.code).toBe('RUN_ACTIVE');
    await request(service, 'approval.resolve', { approvalId: approval.approval.id, approved: true });
    await service.waitForIdle();
    expect(backend.bodies.map((body) => body.model)).toEqual(['fixture', 'fixture']);
    expect(JSON.stringify(backend.bodies[1])).toContain('original prompt');
    expect(JSON.stringify(backend.bodies[1])).not.toContain('changed prompt');
  });
  it.each([true, false])('requires per-execution approval for writes (approved=%s), and the model sees the result', async (approved) => {
    const backend = await fixture((_body, response, index) => index === 0 ? toolCall(response, 'write_file', { path: 'created.txt', content: 'hello' }) : answer(response, '完成'));
    const { service, session, workspace, events } = await createRuntime(backend.baseUrl);
    await configure(service, session, ['write_file'], workspace);
    const start = await request(service, 'run.start', { sessionId: session.id, text: '创建文件' });
    expect(start.result).toHaveProperty('runId');
    await waitUntil(() => events.some((event) => event.type === 'approval.requested'));
    const approval = events.find((event) => event.type === 'approval.requested');
    if (approval?.type !== 'approval.requested') throw new Error('approval missing');
    expect((await request(service, 'settings.get', {})).error).toBeUndefined();
    expect((await request(service, 'run.start', { sessionId: session.id, text: '重入' })).error?.code).toBe('RUN_ACTIVE');
    await request(service, 'approval.resolve', { approvalId: approval.approval.id, approved });
    await service.waitForIdle();
    if (approved) expect(await readFile(path.join(workspace, 'created.txt'), 'utf8')).toBe('hello');
    else await expect(readFile(path.join(workspace, 'created.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(backend.bodies[1].messages.find((message) => message.role === 'tool')?.content).toContain(approved ? '已写入' : '用户拒绝');
    expect(events.some((event) => event.type === 'tool.finished' && event.isError === !approved)).toBe(true);
    const loaded = (await request(service, 'sessions.load', { sessionId: session.id })).result as Session;
    expect(loaded.messages.find((message) => message.role === 'tool')?.id).toBe('tool-1');
  });

  it('cancels a pending approval without executing a write or blocking requests', async () => {
    const backend = await fixture((_body, response) => toolCall(response, 'write_file', { path: 'cancelled.txt', content: 'must not happen' }));
    const { service, session, workspace, events } = await createRuntime(backend.baseUrl);
    await configure(service, session, ['write_file'], workspace);
    await request(service, 'run.start', { sessionId: session.id, text: '创建文件' });
    await waitUntil(() => events.some((event) => event.type === 'approval.requested'));
    expect((await request(service, 'run.cancel', { sessionId: session.id })).result).toEqual({ cancelled: true });
    await service.waitForIdle();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'cancelled' });
    await expect(readFile(path.join(workspace, 'cancelled.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(events.some((event) => event.type === 'approval.resolved' && !event.approved)).toBe(true);
  });

  it('rejects lexical escapes and symlinks outside the workspace for reads and writes', async () => {
    const backend = await fixture();
    const { workspace, directory } = await createRuntime(backend.baseUrl);
    const outside = path.join(directory, 'outside.txt');
    await writeFile(outside, 'private');
    await symlink(outside, path.join(workspace, 'escape.txt'));
    const tools = createTools(['read_file', 'write_file'], { workspace, approve: async () => true });
    await expect(tools[0].execute('1', { path: '../outside.txt' })).rejects.toThrow('超出工作区');
    await expect(tools[0].execute('2', { path: 'escape.txt' })).rejects.toThrow('工作区外');
    await expect(tools[1].execute('3', { path: 'escape.txt', content: 'changed' })).rejects.toThrow('符号链接');
    expect(await readFile(outside, 'utf8')).toBe('private');
  });

  it('repairs missing tool results after restart without replaying an unknown write', async () => {
    const backend = await fixture();
    const { service, session, directory } = await createRuntime(backend.baseUrl);
    await service.shutdown();
    const filename = path.join(directory, 'appdata', 'sessions', `${session.id}.json`);
    const stored = JSON.parse(await readFile(filename, 'utf8')) as { agentMessages: unknown[] };
    stored.agentMessages = [{ role: 'assistant', api: 'openai-completions', provider: 'm1tera-openai-compatible', model: 'fixture', content: [{ type: 'toolCall', id: 'interrupted-write', name: 'write_file', arguments: { path: 'unknown.txt', content: 'unreplayed' } }], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'toolUse', timestamp: Date.now() }];
    await writeFile(filename, JSON.stringify(stored));
    const recovered = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: () => {} });
    cleanup.push(() => recovered.shutdown());
    expect((await request(recovered, 'run.start', { sessionId: session.id, text: '继续' })).error).toBeUndefined();
    await recovered.waitForIdle();
    const tool = backend.bodies[0].messages.find((message) => message.role === 'tool');
    expect(tool?.content).toContain('未被自动重新执行');
    const chain = JSON.parse(await readFile(filename, 'utf8')).agentMessages as { role: string; toolCallId?: string }[];
    expect(chain.some((message) => message.role === 'toolResult' && message.toolCallId === 'interrupted-write')).toBe(true);
  });

  it('caps shell output and terminates the process group on cancellation', async () => {
    if (process.platform === 'win32') return;
    const backend = await fixture();
    const { workspace } = await createRuntime(backend.baseUrl);
    const output = await executeCommand(workspace, `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(100000))'`, 5);
    expect(output).toContain('输出已截断');
    expect(Buffer.byteLength(output)).toBeLessThan(66_000);
    const controller = new AbortController();
    const command = executeCommand(workspace, 'sleep 2; echo survived > survived.txt', 5, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(command).rejects.toThrow('取消');
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await expect(readFile(path.join(workspace, 'survived.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

it('JSONL handles cancellation concurrently and emits only valid envelopes', async () => {
  const backend = await fixture((_body, response) => { chunk(response, { role: 'assistant', content: '等待' }); });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-jsonl-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const input = new PassThrough();
  const output = new PassThrough();
  const envelopes: RuntimeEnvelope[] = [];
  let pending = '';
  output.on('data', (buffer: Buffer) => {
    pending += buffer.toString('utf8');
    const lines = pending.split('\n'); pending = lines.pop()!;
    for (const line of lines) envelopes.push(JSON.parse(line) as RuntimeEnvelope);
  });
  const runtime = await startJsonlRuntime(directory, input, output);
  cleanup.push(() => runtime.shutdown());
  input.write(JSON.stringify({ id: 'settings', method: 'settings.set', params: { settings: { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: 'chat-completions', baseUrl: backend.baseUrl, model: 'fixture' }, apiKey: 'test' } }) + '\n');
  input.write(JSON.stringify({ id: 'create', method: 'sessions.create', params: {} }) + '\n');
  await waitUntil(() => envelopes.some((envelope) => envelope.kind === 'response' && envelope.id === 'create'));
  const created = envelopes.find((envelope) => envelope.kind === 'response' && envelope.id === 'create');
  if (created?.kind !== 'response') throw new Error('create response missing');
  const session = created.result as Session;
  input.write(JSON.stringify({ id: 'start', method: 'run.start', params: { sessionId: session.id, text: '等待取消' } }) + '\n');
  await waitUntil(() => envelopes.some((envelope) => envelope.kind === 'event' && envelope.event.type === 'text.delta'));
  input.write(JSON.stringify({ id: 'cancel', method: 'run.cancel', params: { sessionId: session.id } }) + '\n');
  input.write('invalid-json\n');
  await waitUntil(() => envelopes.some((envelope) => envelope.kind === 'event' && envelope.event.type === 'run.finished'));
  expect(envelopes.find((envelope) => envelope.kind === 'response' && envelope.id === 'cancel')).toMatchObject({ result: { cancelled: true } });
  expect(envelopes.some((envelope) => envelope.kind === 'response' && envelope.error?.code === 'INVALID_JSON')).toBe(true);
  expect(envelopes.every((envelope) => envelope.kind === 'event' || envelope.kind === 'response')).toBe(true);
  input.end();
});
