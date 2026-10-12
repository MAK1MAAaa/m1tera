import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RuntimeService } from '../../runtime/service.js';
import { DEFAULT_SETTINGS } from '../../shared/protocol.js';
import type { ContextEstimate, RequestMap, RuntimeEvent, RuntimeRequest, Session, Settings, Skill, ToolName } from '../../shared/protocol.js';

interface BodyMessage { role: string; content?: string; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }
interface BodyTool { type: string; function?: { name: string; description?: string }; name?: string }
interface Body { messages: BodyMessage[]; tools?: BodyTool[]; model: string }
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const task of cleanup.splice(0).reverse()) await task(); });

function chunk(response: ServerResponse, delta: unknown, finish: string | null = null) {
  response.write(`data: ${JSON.stringify({ id: 'composer-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
}

function answer(response: ServerResponse) {
  chunk(response, { role: 'assistant', content: '已完成' });
  chunk(response, {}, 'stop');
  response.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 64, completion_tokens: 3, total_tokens: 67 } })}\n\n`);
  response.end('data: [DONE]\n\n');
}

function callTool(response: ServerResponse, name: string, args: Record<string, unknown>, id = 'composer-tool-1') {
  chunk(response, { role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  chunk(response, {}, 'tool_calls');
  response.end('data: [DONE]\n\n');
}

async function request<M extends keyof RequestMap>(service: RuntimeService, method: M, params: RequestMap[M]['params']) {
  return service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
}

async function result<M extends keyof RequestMap>(service: RuntimeService, method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
  const response = await request(service, method, params);
  expect(response.error).toBeUndefined();
  return response.result as RequestMap[M]['result'];
}

async function fixture(respond?: (body: Body, response: ServerResponse, index: number) => void, extra: Partial<Settings> = {}, webSearchFetch?: typeof globalThis.fetch) {
  const bodies: Body[] = [];
  const backend = createServer(async (incoming, outgoing) => {
    let payload = '';
    for await (const data of incoming) payload += data;
    const body = JSON.parse(payload) as Body;
    bodies.push(body);
    outgoing.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (respond) respond(body, outgoing, bodies.length - 1); else answer(outgoing);
  });
  await new Promise<void>((resolve, reject) => { backend.once('error', reject); backend.listen(0, '127.0.0.1', resolve); });
  const address = backend.address();
  if (!address || typeof address === 'string') throw new Error('fixture unavailable');
  cleanup.push(async () => { backend.closeAllConnections(); await new Promise<void>((resolve) => backend.close(() => resolve())); });
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-composer-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, 'workspace');
  await mkdir(workspace);
  const events: RuntimeEvent[] = [];
  const service = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: (event) => events.push(event), webSearchFetch });
  cleanup.push(() => service.shutdown());
  const settings = { ...DEFAULT_SETTINGS, connection: 'compatible' as const, apiFormat: 'chat-completions' as const, model: 'fixture', baseUrl: `http://127.0.0.1:${address.port}/v1`, ...extra };
  await result(service, 'settings.set', { settings, apiKey: 'composer-test-only' });
  const session = await result(service, 'sessions.create', {});
  return { directory, workspace, service, session, settings, events, bodies };
}

function toolNames(body: Body) { return (body.tools ?? []).map((tool) => tool.function?.name ?? tool.name); }

const skillInput = {
  name: 'task-briefing', description: '针对当前任务整理简报', instructions: 'SKILL-INSTRUCTIONS-ONLY-WHEN-SELECTED：先核验事实再整理简报。', triggers: ['简报'], enabled: true,
};

async function configure(service: RuntimeService, session: Session, workspace: string, enabledTools: ToolName[] = [], autoSkills = false) {
  return result(service, 'sessions.configure', { sessionId: session.id, workspace, enabledTools, approvalMode: 'auto', autoSkills });
}

describe('composer runtime integration', () => {
  it('sends explicitly selected file contents and skill instructions while keeping display text and metadata separate', async () => {
    const { service, session, workspace, bodies } = await fixture();
    const contents = 'ATTACHMENT-EXPLICIT-CONTENTS：年度预算为 42。';
    await writeFile(path.join(workspace, 'brief.md'), contents);
    await configure(service, session, workspace);
    const skill = await result(service, 'skills.create', { skill: skillInput });
    const text = '整理 @brief.md $task-briefing';
    await result(service, 'run.start', { sessionId: session.id, text, attachments: ['brief.md'], skillIds: [skill.id] });
    await service.waitForIdle();
    expect(JSON.stringify(bodies[0])).toContain(contents);
    expect(JSON.stringify(bodies[0])).toContain(skillInput.instructions);
    expect(toolNames(bodies[0])).not.toContain('use_skill');
    const loaded = await result(service, 'sessions.load', { sessionId: session.id });
    const displayed = loaded.messages.find((message) => message.role === 'user');
    expect(displayed?.text).toBe(text);
    expect(displayed?.attachments).toEqual(['brief.md']);
    expect(displayed?.skills).toHaveLength(1);
    expect(displayed?.text).not.toContain(contents);
    expect(displayed?.text).not.toContain(skillInput.instructions);
    expect(loaded.autoSkills).toBe(false);

    await result(service, 'run.start', { sessionId: session.id, text: '继续回答，保持简洁。' });
    await service.waitForIdle();
    expect(JSON.stringify(bodies[1])).not.toContain(skillInput.instructions);
  });

  it('rejects attachment escapes and disabled skills before contacting the provider', async () => {
    const { service, session, workspace, directory, bodies } = await fixture();
    await configure(service, session, workspace);
    await writeFile(path.join(directory, 'outside.md'), 'PRIVATE-OUTSIDE-WORKSPACE');
    await symlink(path.join(directory, 'outside.md'), path.join(workspace, 'escape.md'));
    for (const filename of ['../outside.md', 'escape.md']) {
      const response = await request(service, 'run.start', { sessionId: session.id, text: '读取附件', attachments: [filename] });
      expect(response.error).toBeDefined();
    }
    const disabled = await result(service, 'skills.create', { skill: { ...skillInput, enabled: false } });
    expect((await request(service, 'run.start', { sessionId: session.id, text: '使用禁用技能', skillIds: [disabled.id] })).error).toBeDefined();
    expect((await request(service, 'context.preview', { sessionId: session.id, text: '预览禁用技能', skillIds: [disabled.id] })).error).toBeDefined();
    expect(bodies).toHaveLength(0);
    expect((await result(service, 'sessions.load', { sessionId: session.id })).messages).toHaveLength(0);
  });

  it('loads automatic skills only after opt-in and an actual model use_skill call', async () => {
    const { service, session, workspace, bodies, events } = await fixture((_body, response, index) => {
      if (index === 1) callTool(response, 'use_skill', { name: skillInput.name });
      else if (index === 5) callTool(response, 'use_skill', { name: skillInput.name }, 'composer-tool-2');
      else answer(response);
    });
    const skill = await result(service, 'skills.create', { skill: skillInput });
    await configure(service, session, workspace);
    await result(service, 'run.start', { sessionId: session.id, text: '做一个简报' });
    await service.waitForIdle();
    expect(toolNames(bodies[0])).not.toContain('use_skill');
    expect(JSON.stringify(bodies[0])).not.toContain(skillInput.instructions);

    expect((await configure(service, session, workspace, [], true)).autoSkills).toBe(true);
    await result(service, 'run.start', { sessionId: session.id, text: '根据需要使用合适技能' });
    await service.waitForIdle();
    expect(toolNames(bodies[1])).toContain('use_skill');
    expect(JSON.stringify(bodies[1].tools)).toContain(skillInput.description);
    expect(JSON.stringify(bodies[1])).not.toContain(skillInput.instructions);
    expect(bodies[2].messages.find((message) => message.role === 'tool')?.content).toContain(skillInput.instructions);
    expect(events).toContainEqual(expect.objectContaining({ type: 'skill.used', automatic: true, skill: expect.objectContaining({ id: skill.id }) }));

    await configure(service, session, workspace, [], false);
    await result(service, 'skills.update', { skillId: skill.id, patch: { enabled: false } });
    await result(service, 'run.start', { sessionId: session.id, text: '本轮普通回答即可' });
    await service.waitForIdle();
    expect(toolNames(bodies[3])).not.toContain('use_skill');
    expect(JSON.stringify(bodies[3])).not.toContain(skillInput.instructions);
    const priorCall = bodies[3].messages.flatMap((message) => message.tool_calls ?? []).find((call) => call.function.name === 'use_skill');
    expect(priorCall?.id).toBe('composer-tool-1');
    const priorResult = bodies[3].messages.find((message) => message.role === 'tool' && message.tool_call_id === priorCall?.id);
    expect(priorResult?.content).toContain('已在上一轮使用');
    expect(priorResult?.content!.length).toBeLessThan(200);

    await result(service, 'skills.update', { skillId: skill.id, patch: { enabled: true } });
    await result(service, 'run.start', { sessionId: session.id, text: '重新显式选用 $task-briefing', skillIds: [skill.id] });
    await service.waitForIdle();
    expect(toolNames(bodies[4])).not.toContain('use_skill');
    expect(bodies[4].messages.filter((message) => message.role === 'system').some((message) => message.content?.includes(skillInput.instructions))).toBe(true);
    expect(JSON.stringify(bodies[4]).split(skillInput.instructions)).toHaveLength(2);

    await configure(service, session, workspace, [], true);
    await result(service, 'run.start', { sessionId: session.id, text: '再次自动加载所需技能' });
    await service.waitForIdle();
    expect(toolNames(bodies[5])).toContain('use_skill');
    expect(JSON.stringify(bodies[5])).not.toContain(skillInput.instructions);
    const currentResult = bodies[6].messages.find((message) => message.role === 'tool' && message.tool_call_id === 'composer-tool-2');
    expect(currentResult?.content).toContain(skillInput.instructions);
    expect(bodies[6].messages.find((message) => message.role === 'tool' && message.tool_call_id === 'composer-tool-1')?.content).toContain('已在上一轮使用');
  });

  it('freezes automatic skill content and enabled state for the complete running turn', async () => {
    let heldResponse: ServerResponse | undefined;
    let ready: () => void = () => {};
    const providerWaiting = new Promise<void>((resolve) => { ready = resolve; });
    const { service, session, workspace, bodies } = await fixture((_body, response, index) => {
      if (index === 0) { heldResponse = response; ready(); } else answer(response);
    });
    const skill = await result(service, 'skills.create', { skill: skillInput });
    await configure(service, session, workspace, [], true);
    await result(service, 'run.start', { sessionId: session.id, text: '使用当前技能快照' });
    await providerWaiting;
    await result(service, 'skills.update', { skillId: skill.id, patch: { enabled: false, instructions: 'NEW-SKILL-CONTENT-NEXT-TURN' } });
    if (!heldResponse) throw new Error('held response missing');
    callTool(heldResponse, 'use_skill', { name: skillInput.name });
    await service.waitForIdle();
    expect(bodies[1].messages.find((message) => message.role === 'tool')?.content).toContain(skillInput.instructions);
    expect(JSON.stringify(bodies)).not.toContain('NEW-SKILL-CONTENT-NEXT-TURN');
  });

  it('includes draft attachment and skill costs in preview, and reports an unknown or explicitly configured limit', async () => {
    const { service, session, workspace, settings, bodies } = await fixture();
    await configure(service, session, workspace);
    await writeFile(path.join(workspace, 'cost.md'), '附件预算内容 '.repeat(20));
    const skill = await result(service, 'skills.create', { skill: skillInput });
    const empty: ContextEstimate = await result(service, 'context.preview', { sessionId: session.id });
    expect(empty.contextWindow).toBeNull();
    const draft: ContextEstimate = await result(service, 'context.preview', { sessionId: session.id, text: '详细分析这些内容', attachments: ['cost.md'], skillIds: [skill.id] });
    expect(draft).toMatchObject({ contextWindow: null, selectedSkills: 1, attachments: 1 });
    expect(draft.attachmentTokens).toBeGreaterThan(0);
    expect(draft.skillTokens).toBeGreaterThan(0);
    expect(draft.total).toBeGreaterThan(empty.total);
    expect(bodies).toHaveLength(0);
    await result(service, 'settings.set', { settings: { ...settings, contextWindow: 32_768 } });
    expect((await result(service, 'context.preview', { sessionId: session.id })).contextWindow).toBe(32_768);
  });

  it('removes write and command capabilities in plan mode even when automatic approvals are enabled', async () => {
    const { service, session, workspace, bodies, events } = await fixture((_body, response, index) => index === 0 ? callTool(response, 'write_file', { path: 'should-not-exist.txt', content: 'PLAN-MUST-NOT-WRITE' }) : answer(response));
    await configure(service, session, workspace, ['list_directory', 'read_file', 'write_file', 'run_command']);
    const text = '制定迁移计划';
    await result(service, 'run.start', { sessionId: session.id, text, command: 'plan' });
    await service.waitForIdle();
    expect(toolNames(bodies[0])).toEqual(expect.arrayContaining(['list_directory', 'read_file']));
    expect(toolNames(bodies[0])).not.toContain('write_file');
    expect(toolNames(bodies[0])).not.toContain('run_command');
    expect(events.some((event) => event.type === 'approval.resolved' && event.approved)).toBe(false);
    await expect(readFile(path.join(workspace, 'should-not-exist.txt'))).rejects.toMatchObject({ code: 'ENOENT' });
    const displayed = (await result(service, 'sessions.load', { sessionId: session.id })).messages.find((message) => message.role === 'user');
    expect(displayed).toMatchObject({ text, command: 'plan' });
  });

  it('lists workspace file metadata without reading contents or exposing outside symlink targets', async () => {
    const { service, session, workspace, directory, bodies } = await fixture();
    await configure(service, session, workspace);
    await mkdir(path.join(workspace, 'notes'));
    await writeFile(path.join(workspace, 'notes', 'brief.md'), 'DO-NOT-RETURN-TEXT-CONTENTS');
    await writeFile(path.join(directory, 'outside.md'), 'PRIVATE-CONTENTS');
    await symlink(path.join(directory, 'outside.md'), path.join(workspace, 'escape.md'));
    const files = await result(service, 'files.list', { sessionId: session.id, query: 'brief' });
    expect(files).toContainEqual({ path: 'notes/brief.md', size: Buffer.byteLength('DO-NOT-RETURN-TEXT-CONTENTS') });
    expect(JSON.stringify(files)).not.toContain('CONTENTS');
    const all = await result(service, 'files.list', { sessionId: session.id });
    expect(all.some((file) => file.path === 'escape.md')).toBe(false);
    expect(bodies).toHaveLength(0);
  });

  it('executes compatible web search, preserves source metadata, and removes its capability on the next normal turn', async () => {
    const fetchSearch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('<a class="result__a" href="https://example.com/research">Research reference</a><div class="result__snippet">SEARCH-RESULT-EXPLICIT-EVIDENCE</div>', { headers: { 'content-type': 'text/html' } }));
    const { service, session, bodies, events } = await fixture((_body, response, index) => {
      if (index === 0) callTool(response, 'web_search', { query: 'test current research' });
      else answer(response);
    }, {}, fetchSearch);
    await result(service, 'run.start', { sessionId: session.id, text: '查询研究资料', command: 'websearch' });
    await service.waitForIdle();
    expect(toolNames(bodies[0])).toContain('web_search');
    expect(fetchSearch).toHaveBeenCalledOnce();
    const fetchedUrl = new URL(String(fetchSearch.mock.calls[0][0]));
    expect(fetchedUrl.hostname).toBe('html.duckduckgo.com');
    expect(fetchedUrl.searchParams.get('q')).toBe('test current research');
    expect(bodies[1].messages.find((message) => message.role === 'tool')?.content).toContain('SEARCH-RESULT-EXPLICIT-EVIDENCE');
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'completed' });
    const loaded = await result(service, 'sessions.load', { sessionId: session.id });
    expect(loaded.messages.findLast((message) => message.role === 'assistant')?.sources).toContainEqual({ title: 'Research reference', url: 'https://example.com/research' });
    await result(service, 'run.start', { sessionId: session.id, text: '普通聊天即可' });
    await service.waitForIdle();
    expect(toolNames(bodies[2])).not.toContain('web_search');
    expect(fetchSearch).toHaveBeenCalledOnce();
  });

  it('does not accept a plain model answer as proof that websearch ran', async () => {
    const fetchSearch = vi.fn<typeof globalThis.fetch>();
    const { service, session, events } = await fixture(undefined, {}, fetchSearch);
    await result(service, 'run.start', { sessionId: session.id, text: '查询最新资料', command: 'websearch' });
    await service.waitForIdle();
    expect(fetchSearch).not.toHaveBeenCalled();
    expect(events.findLast((event) => event.type === 'run.finished')).toMatchObject({ status: 'error', error: expect.stringContaining('未完成') });
  });

  it('serves skill management requests through the runtime and persists custom content', async () => {
    const { service, directory } = await fixture();
    const created = await result(service, 'skills.create', { skill: skillInput });
    const summaries = await result(service, 'skills.list', {});
    expect(summaries).toContainEqual(expect.objectContaining({ id: created.id }));
    expect(summaries.every((skill) => !('instructions' in skill))).toBe(true);
    const detail: Skill = await result(service, 'skills.get', { skillId: created.id });
    expect(detail.instructions).toBe(skillInput.instructions);
    await result(service, 'skills.update', { skillId: created.id, patch: { enabled: false } });
    const filename = path.join(directory, 'SKILL.md');
    await writeFile(filename, '---\nname: imported-helper\ndescription: 指定导入技能\n---\n只保存指定正文。');
    const imported = await result(service, 'skills.import', { path: filename });
    expect(imported.instructions).toBe('只保存指定正文。');
    expect(await result(service, 'skills.delete', { skillId: imported.id })).toEqual({ deleted: true });
    await service.shutdown();
    const restarted = new RuntimeService({ dataDir: path.join(directory, 'appdata'), emit: () => {} });
    cleanup.push(() => restarted.shutdown());
    expect(await result(restarted, 'skills.get', { skillId: created.id })).toMatchObject({ enabled: false, instructions: skillInput.instructions });
  });
});
