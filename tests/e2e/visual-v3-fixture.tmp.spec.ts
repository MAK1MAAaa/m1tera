import { writeFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import type { ComposerDraft, Organization, RequestMap, RuntimeMethod, RuntimeEvent, Session, Settings, Skill, SkillDraft, SkillSummary } from '../../shared/protocol';
import type { RuntimeClient } from '../../src/lib/runtime-client';

async function mockRuntime(page: Page, longContent = false) {
  await page.addInitScript(({ defaults, longContent }) => {
    let settings: Settings = defaults;
    let connected = false;
    let savedKey = false;
    const listeners = new Set<(event: RuntimeEvent) => void>();
    const sessions: Session[] = [];
    const organization: Organization = { workspaces: [], categories: [] };
    const runs = new Map<string, string>();
    const skills: Skill[] = [{ id: 'writing', name: 'writing', description: '整理文章和写作任务', instructions: '先组织观点，再写清晰简洁的内容。', triggers: ['写作', 'writing'], enabled: true, builtin: false, updatedAt: new Date().toISOString() }];
    skills.unshift({ id: 'builtin-review', name: 'workspace-review', description: '遵循项目规范审查行为变化、兼容性与边界条件。', instructions: Array.from({ length: 24 }, (_, index) => `${index + 1}. 根据代码与日志验证结论，明确说明未确认的假设与回归风险。`).join('\n\n'), triggers: ['审查', 'review'], enabled: true, builtin: true, updatedAt: new Date().toISOString() });
    for (let index = 1; index <= 12; index++) skills.push({ id: `fixture-skill-${index}`, name: `task-method-${index}`, description: '用于检查较长 Skill 名称、说明截断及库内滚动的隔离样例。', instructions: '明确目标，检查实现，并记录验证结果。', triggers: ['检查'], enabled: true, builtin: false, updatedAt: new Date().toISOString() });
    if (longContent) {
      const date = new Date().toISOString();
      for (let index = 0; index < 45; index++) sessions.push({ id: `fixture-${index}`, title: `会话 ${index}`, createdAt: date, updatedAt: date, messageCount: index ? 0 : 1, enabledTools: [], workspace: '', approvalMode: 'ask', pinned: false, messages: index ? [] : [{ id: 'long-message', role: 'assistant', text: Array.from({length: 160}, (_, line) => `第 ${line + 1} 段：用于验证聊天内部滚动、长代码与内容布局。`).join('\n\n'), createdAt: date }] });
    }
    const emit = (event: RuntimeEvent) => listeners.forEach((listener) => listener(event));
    const estimate = (count = 0, draft: Partial<ComposerDraft> = {}) => {
      const attachments = draft.attachments?.length ?? 0;
      const selectedSkills = draft.skillIds?.length ?? 0;
      const history = Math.ceil((draft.text?.length ?? 0) / 4) + attachments * 25;
      const system = 40 + selectedSkills * 35;
      const tools = (count + (draft.command === 'websearch' ? 1 : 0)) * 65;
      return { system, tools, history, total: system + tools + history, toolCount: count, method: 'test estimate', contextWindow: settings.connection === 'chatgpt' ? 272000 : settings.contextWindow ?? null, attachments, selectedSkills, skillTokens: selectedSkills * 35, attachmentTokens: attachments * 25 };
    };
    const state: { pending?: { sessionId: string; id: string }; opened: number; key?: string; runStarts: (ComposerDraft & { sessionId: string })[]; externalUrls: string[]; importedPaths: string[]; previewRequests: (Partial<ComposerDraft> & { sessionId?: string })[]; sessions: Session[]; skills: Skill[]; emit: (event: RuntimeEvent) => void } = { opened: 0, runStarts: [], externalUrls: [], importedPaths: [], previewRequests: [], sessions, skills, emit };
    const summary = (session: Session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length, pinned: session.pinned, categoryId: session.categoryId, workspaceId: session.workspaceId, workspace: session.workspace, approvalMode: session.approvalMode, autoSkills: session.autoSkills });
    const skillSummary = (skill: Skill): SkillSummary => ({ id: skill.id, name: skill.name, description: skill.description, triggers: skill.triggers, enabled: skill.enabled, builtin: skill.builtin, updatedAt: skill.updatedAt });
    const client: RuntimeClient = {
      transport: 'test',
      async subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async chooseWorkspace() { return '/tmp/test-workspace'; },
      async chooseSkillFile() { return '/tmp/test-skills/SKILL.md'; },
      async openAuthUrl() { state.opened++; },
      async openExternalUrl(url) { state.externalUrls.push(url); },
      async request<M extends RuntimeMethod>(method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']> {
        const p = params as Record<string, unknown>;
        let result: unknown;
        switch (method) {
          case 'settings.get': result = { settings, hasApiKey: savedKey, chatgpt: { connected, loginPending: false } }; break;
          case 'settings.set':
            settings = p.settings as Settings;
            if (p.apiKey !== undefined) { state.key = String(p.apiKey); savedKey = Boolean(state.key); }
            result = { settings, hasApiKey: savedKey, chatgpt: { connected, loginPending: false } }; break;
          case 'models.list': result = [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 272000, source: 'catalog' }, { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 272000, source: 'catalog' }]; break;
          case 'organization.get': result = structuredClone(organization); break;
          case 'workspaces.create': {
            let workspace = organization.workspaces.find((item) => item.path === p.path);
            if (!workspace) { workspace = { id: crypto.randomUUID(), name: String(p.name || 'test-workspace'), path: String(p.path), createdAt: new Date().toISOString() }; organization.workspaces.push(workspace); }
            result = structuredClone(workspace); break;
          }
          case 'workspaces.rename': {
            const workspace = organization.workspaces.find((item) => item.id === p.workspaceId)!;
            workspace.name = String(p.name); result = structuredClone(workspace); break;
          }
          case 'categories.create': {
            const category = { id: crypto.randomUUID(), name: String(p.name), createdAt: new Date().toISOString() };
            organization.categories.push(category); result = structuredClone(category); break;
          }
          case 'files.list': {
            const session = sessions.find((item) => item.id === p.sessionId);
            if (!session?.workspace) throw new Error('请先为会话选择工作区');
            const query = String(p.query ?? '').toLowerCase();
            result = [{ path: 'hello.txt', size: 12 }, { path: 'docs/guide.md', size: 48 }].filter((file) => file.path.toLowerCase().includes(query)); break;
          }
          case 'skills.list': result = structuredClone(skills.map(skillSummary)); break;
          case 'skills.get': result = structuredClone(skills.find((skill) => skill.id === p.skillId)); break;
          case 'skills.create': {
            const skill: Skill = { ...(p.skill as SkillDraft), id: crypto.randomUUID(), builtin: false, updatedAt: new Date().toISOString() };
            skills.push(skill); result = structuredClone(skill); break;
          }
          case 'skills.update': {
            const skill = skills.find((item) => item.id === p.skillId)!;
            Object.assign(skill, p.patch as Partial<SkillDraft>, { updatedAt: new Date().toISOString() }); result = structuredClone(skill); break;
          }
          case 'skills.import': {
            state.importedPaths.push(String(p.path));
            const skill: Skill = { id: crypto.randomUUID(), name: 'imported-skill', description: '导入的本地 Skill', instructions: '按导入指令执行任务。', triggers: [], enabled: true, builtin: false, updatedAt: new Date().toISOString() };
            skills.push(skill); result = structuredClone(skill); break;
          }
          case 'skills.delete': { const index = skills.findIndex((skill) => skill.id === p.skillId); if (index >= 0) skills.splice(index, 1); result = { deleted: index >= 0 }; break; }
          case 'sessions.list': result = sessions.map(summary); break;
          case 'sessions.create': {
            const date = new Date().toISOString();
            const workspace = organization.workspaces.find((item) => item.id === p.workspaceId);
            const session: Session = { id: crypto.randomUUID(), title: '新会话', createdAt: date, updatedAt: date, messageCount: 0, messages: [], enabledTools: [], workspace: workspace?.path ?? '', workspaceId: workspace?.id, categoryId: p.categoryId as string | undefined, approvalMode: 'ask', pinned: false, autoSkills: false };
            sessions.push(session); result = structuredClone(session); break;
          }
          case 'sessions.load': result = structuredClone(sessions.find((session) => session.id === p.sessionId)); break;
          case 'sessions.configure': {
            const session = sessions.find((session) => session.id === p.sessionId)!;
            session.enabledTools = p.enabledTools as Session['enabledTools']; session.workspace = String(p.workspace);
            if (p.approvalMode) session.approvalMode = p.approvalMode as Session['approvalMode'];
            if (typeof p.autoSkills === 'boolean') session.autoSkills = p.autoSkills;
            result = structuredClone(session); break;
          }
          case 'sessions.update': {
            const session = sessions.find((session) => session.id === p.sessionId)!;
            if (typeof p.title === 'string') session.title = p.title;
            if (typeof p.pinned === 'boolean') session.pinned = p.pinned;
            if ('categoryId' in p) session.categoryId = p.categoryId as string | undefined || undefined;
            if ('workspaceId' in p) { const workspace = organization.workspaces.find((item) => item.id === p.workspaceId); session.workspaceId = workspace?.id; session.workspace = workspace?.path ?? ''; }
            emit({ type: 'session.updated', session: summary(session) });
            result = structuredClone(session); break;
          }
          case 'sessions.delete': { const index = sessions.findIndex((session) => session.id === p.sessionId); if (index >= 0) sessions.splice(index, 1); result = { deleted: index >= 0 }; break; }
          case 'context.preview': state.previewRequests.push(structuredClone(p as Partial<ComposerDraft>)); result = estimate(sessions.find((session) => session.id === p.sessionId)?.enabledTools.length, p as Partial<ComposerDraft>); break;
          case 'auth.login':
            connected = true;
            emit({ type: 'auth.url', url: 'https://auth.openai.com/api/accounts/authorize?test=1' });
            emit({ type: 'auth.status', status: { connected: true, loginPending: false } });
            result = { started: true }; break;
          case 'auth.status': result = { connected, loginPending: false }; break;
          case 'auth.cancel': result = { cancelled: true }; break;
          case 'auth.logout': connected = false; emit({ type: 'auth.status', status: { connected, loginPending: false } }); result = { loggedOut: true }; break;
          case 'run.start': {
            state.runStarts.push(structuredClone(p as ComposerDraft & { sessionId: string }));
            if (p.text === '首次发送失败') throw new Error('模拟首次发送失败');
            const session = sessions.find((session) => session.id === p.sessionId)!;
            const runId = crypto.randomUUID();
            runs.set(session.id, runId);
            emit({ type: 'run.started', sessionId: session.id, runId });
            const message = { id: crypto.randomUUID(), role: 'user' as const, text: String(p.text), createdAt: new Date().toISOString() };
            session.messages.push(message); emit({ type: 'message', sessionId: session.id, message });
            if (p.command === 'websearch' && p.text === '后台搜索长任务') {
              emit({ type: 'context', sessionId: session.id, estimate: { system: 120, tools: 150, history: 430, total: 700, toolCount: 1, method: '真实出站 payload fixture', contextWindow: 128000 }, usage: null });
              emit({ type: 'tool.started', sessionId: session.id, toolCallId: 'hosted-search-pending', toolName: 'web_search', arguments: { query: 'Tauri docs' } });
            } else if (p.text === '需要审批' && session.approvalMode !== 'auto') {
              const id = crypto.randomUUID(); state.pending = { id, sessionId: session.id };
              emit({ type: 'approval.requested', approval: { id, sessionId: session.id, runId, toolName: 'write_file', description: '写入 test.txt', arguments: { path: 'test.txt', content: 'test' } } });
            } else if (p.text !== '长任务') {
              if (p.text === '需要审批') emit({ type: 'approval.resolved', sessionId: session.id, approvalId: crypto.randomUUID(), approved: true, automatic: true, toolName: 'write_file' });
              const id = crypto.randomUUID();
              emit({ type: 'text.delta', sessionId: session.id, messageId: id, delta: '已收到' });
              emit({ type: 'text.delta', sessionId: session.id, messageId: id, delta: '你的消息。' });
              const reply = { id, role: 'assistant' as const, text: '已收到你的消息。', createdAt: new Date().toISOString(), ...(p.command === 'websearch' ? { sources: [{ title: 'Tauri 官方文档', url: 'https://v2.tauri.app/' }] } : {}) };
              session.messages.push(reply); emit({ type: 'message', sessionId: session.id, message: reply });
              emit({ type: 'context', sessionId: session.id, estimate: estimate(), usage: null });
              emit({ type: 'run.finished', sessionId: session.id, runId, status: 'completed' });
            }
            result = { runId }; break;
          }
          case 'run.cancel': emit({ type: 'run.finished', sessionId: String(p.sessionId), runId: runs.get(String(p.sessionId)) ?? 'cancel', status: 'cancelled' }); result = { cancelled: true }; break;
          case 'approval.resolve':
            if (state.pending) emit({ type: 'approval.resolved', sessionId: state.pending.sessionId, approvalId: state.pending.id, approved: Boolean(p.approved) });
            result = { resolved: true }; break;
          case 'context.baseline': result = { model: settings.model, connection: settings.connection, prompt: '只回复 OK，不调用工具。', measuredAt: new Date().toISOString(), mode: 'live', cases: [0, 4, 20].map((toolCount) => ({ toolCount, estimate: estimate(toolCount), usage: null, elapsedMs: 15 })) }; break;
          default: throw new Error(`Unsupported fixture request ${method}`);
        }
        return result as RequestMap[M]['result'];
      },
    };
    window.__M1TERA_RUNTIME__ = client;
    Object.defineProperty(window, '__M1TERA_TEST_STATE__', { value: state });
  }, { defaults: DEFAULT_SETTINGS, longContent });
}

async function login(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByText('ChatGPT 已连接', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
}


async function bounds(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom, scrollTop: element.scrollTop, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowY: getComputedStyle(element).overflowY };
  });
}
function assertInside(rect: Awaited<ReturnType<typeof bounds>>, viewport: { width: number; height: number }) {
  expect(rect.x).toBeGreaterThanOrEqual(-1);
  expect(rect.y).toBeGreaterThanOrEqual(-1);
  expect(rect.right).toBeLessThanOrEqual(viewport.width + 1);
  expect(rect.bottom).toBeLessThanOrEqual(viewport.height + 1);
}
for (const viewport of [{ width: 1280, height: 850 }, { width: 800, height: 600 }]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`isolated visual v3 fixture ${viewport.width}x${viewport.height} ${theme}`, async ({ page }) => {
      test.setTimeout(60000);
      const remoteRequests: string[] = [];
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { remoteRequests.push(url.toString()); await route.abort(); }
        else await route.continue();
      });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mockRuntime(page, true);
      await page.goto('/');
      await expect(page.getByRole('heading', { name: '会话 0', exact: true })).toBeVisible();
      await login(page);
      const prefix = `docs/screenshots/desktop-v3-${viewport.width}x${viewport.height}-${theme}`;
      const report: Record<string, unknown> = { viewport, theme, screenshots: [] };
      async function capture(name: string) {
        const path = `${prefix}-${name}-fixture.png`;
        await page.screenshot({ path, animations: 'disabled' });
        (report.screenshots as string[]).push(path);
      }
      await page.locator('.chat-scroll').evaluate((element) => { element.scrollTop = 200; });
      await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 200; });
      const windowLayout = await page.evaluate(() => {
        window.scrollTo(500, 500);
        return { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight, bodyWidth: document.body.scrollWidth, bodyHeight: document.body.scrollHeight, background: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() };
      });
      const chat = await bounds(page, '.chat-scroll');
      const sidebar = await bounds(page, '.sidebar-scroll');
      const composer = await bounds(page, '.composer');
      report.scroll = { window: windowLayout, chat, sidebar, composer };
      expect(windowLayout.x).toBe(0);
      expect(windowLayout.y).toBe(0);
      expect(windowLayout.documentWidth).toBeLessThanOrEqual(viewport.width + 1);
      expect(windowLayout.documentHeight).toBeLessThanOrEqual(viewport.height + 1);
      expect(chat.scrollHeight).toBeGreaterThan(chat.clientHeight);
      expect(sidebar.scrollHeight).toBeGreaterThan(sidebar.clientHeight);
      expect(chat.scrollTop).toBeGreaterThan(0);
      expect(sidebar.scrollTop).toBeGreaterThan(0);
      assertInside(composer, viewport);
      await capture('long-scroll');
      const input = page.getByRole('textbox', { name: '发送消息', exact: true });
      await input.fill('/');
      await expect(page.getByRole('region', { name: '快捷命令' })).toBeVisible();
      const slash = await bounds(page, '.composer-suggestions');
      assertInside(slash, viewport);
      report.slash = { bounds: slash, options: await page.getByRole('option').allTextContents() };
      await capture('slash');
      await input.press('ArrowDown');
      await expect(page.getByRole('option', { name: /联网搜索/ })).toHaveAttribute('aria-selected', 'true');
      await input.press('Escape');
      await expect(page.locator('.composer-suggestions')).toHaveCount(0);
      report.slashEscape = true;
      await input.fill('$');
      await expect(page.getByRole('region', { name: '选择 Skill' })).toBeVisible();
      const dollar = await bounds(page, '.composer-suggestions');
      assertInside(dollar, viewport);
      report.dollar = { bounds: dollar, list: await bounds(page, '.suggestion-options'), options: await page.getByRole('option').count() };
      await capture('dollar');
      await input.press('Escape');
      await expect(page.locator('.composer-suggestions')).toHaveCount(0);
      report.dollarEscape = true;
      await input.fill('');
      const skillsButton = page.getByRole('button', { name: '管理 Skills', exact: true });
      await skillsButton.click();
      const skillsDialog = page.getByRole('dialog', { name: 'Skills', exact: true });
      await expect(skillsDialog).toBeVisible();
      await skillsDialog.getByRole('button', { name: /workspace-review/ }).click();
      await expect(skillsDialog.getByRole('heading', { name: '内置 Skill', exact: true })).toBeVisible();
      const skillFields = await skillsDialog.locator('[name="skillName"], [name="skillDescription"], [name="skillTriggers"], [name="skillInstructions"]').evaluateAll((elements) => elements.map((element) => ({ name: element.getAttribute('name'), readOnly: (element as HTMLInputElement).readOnly, value: (element as HTMLInputElement).value })));
      expect(skillFields).toHaveLength(4);
      expect(skillFields.every((field) => field.readOnly)).toBe(true);
      await expect(skillsDialog.getByRole('button', { name: '保存 Skill', exact: true })).toHaveCount(0);
      await expect(skillsDialog.getByRole('button', { name: '删除 Skill workspace-review', exact: true })).toHaveCount(0);
      const skillsBounds = await bounds(page, '.skills-dialog');
      assertInside(skillsBounds, viewport);
      await expect.poll(() => skillsDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      for (let index = 0; index < 8; index++) {
        await page.keyboard.press(index % 2 ? 'Tab' : 'Shift+Tab');
        expect(await skillsDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
      }
      const library = await bounds(page, '.skill-list');
      const fields = await bounds(page, '.skill-editor-fields');
      report.skills = { bounds: skillsBounds, readOnlyFields: skillFields, library, fields, noBuiltinSaveDelete: true, focusContained: true };
      await page.locator('.skill-list').evaluate((element) => { element.scrollTop = 0; });
      await page.locator('.skill-editor-fields').evaluate((element) => { element.scrollTop = 0; });
      await capture('skills-builtin');
      await page.locator('.skill-list').evaluate((element) => { element.scrollTop = 200; });
      await page.locator('.skill-editor-fields').evaluate((element) => { element.scrollTop = 200; });
      report.skillsScrolled = { library: await bounds(page, '.skill-list'), fields: await bounds(page, '.skill-editor-fields') };
      expect(library.scrollHeight).toBeGreaterThan(library.clientHeight);
      await capture('skills-scroll');
      await page.keyboard.press('Escape');
      await expect(skillsDialog).toHaveCount(0);
      await expect(skillsButton).toBeFocused();
      report.skillsEscape = true;
      const contextButton = page.getByRole('button', { name: /^上下文占用：/ });
      await contextButton.click();
      const contextDialog = page.getByRole('dialog', { name: '上下文详情', exact: true });
      await expect(contextDialog).toBeVisible();
      const context = await bounds(page, '.context-panel');
      assertInside(context, viewport);
      report.context = { bounds: context, scroll: await bounds(page, '.context-scroll') };
      await capture('context');
      await page.keyboard.press('Escape');
      await expect(contextDialog).toBeHidden();
      await expect(contextButton).toBeFocused();
      report.contextEscape = true;
      const modelButton = page.getByRole('button', { name: '选择模型', exact: true });
      await modelButton.click();
      await expect(page.getByRole('option', { name: /GPT-6.1 Sol/ })).toBeVisible();
      const model = await bounds(page, '.model-popover');
      assertInside(model, viewport);
      report.model = { bounds: model };
      await capture('model-picker');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('listbox', { name: '可用模型' })).toHaveCount(0);
      report.modelEscape = true;
      const fixtureState = await page.evaluate(() => {
        const state = (window as Window & { __M1TERA_TEST_STATE__: { runStarts: unknown[]; sessions: Session[]; externalUrls: string[]; opened: number } }).__M1TERA_TEST_STATE__;
        return { runs: state.runStarts.length, approvalModes: [...new Set(state.sessions.map((session) => session.approvalMode))], autoSkills: [...new Set(state.sessions.map((session) => session.autoSkills))], externalUrls: state.externalUrls, mockAuthOpened: state.opened };
      });
      expect(fixtureState.runs).toBe(0);
      expect(fixtureState.approvalModes).toEqual(['ask']);
      expect(fixtureState.externalUrls).toEqual([]);
      expect(remoteRequests).toEqual([]);
      report.fixtureState = fixtureState;
      report.remoteRequests = remoteRequests;
      await writeFile(`/tmp/m1tera-desktop-v3-${viewport.width}x${viewport.height}-${theme}-layout.json`, JSON.stringify(report, null, 2));
      console.log(`V3 FIXTURE ${viewport.width}x${viewport.height} ${theme}: 7 screenshots; document ${windowLayout.documentWidth}x${windowLayout.documentHeight}; no runs or remote requests`);
    });
  }
}
