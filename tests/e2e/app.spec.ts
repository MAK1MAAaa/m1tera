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

test('browser preview never claims a running agent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('浏览器预览 · Agent 仅在桌面应用中运行')).toBeVisible();
  await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeDisabled();
});

test('ChatGPT login, streamed messages and unknown baseline usage', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await expect(page.getByRole('button', { name: '新建会话', exact: true })).toBeEnabled();
  await login(page);
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('你好');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toBeVisible();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toHaveCount(1);
  await page.getByRole('button', { name: /^上下文占用：/ }).click();
  await page.getByRole('button', { name: '测量首轮基线', exact: true }).click();
  const table = page.getByRole('table', { name: '首轮上下文基线结果' });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByText('未知', { exact: true })).toHaveCount(3);
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
});

test('per-session tools and write approval dialog', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理会话工具', exact: true }).click();
  await page.locator('input[name="workspace"]').fill('/tmp/test-workspace');
  await page.locator('input[name="write_file"]').check();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toContainText('1 个工具');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('需要审批');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /批准/ })).toBeVisible();
  await page.getByRole('button', { name: '拒绝', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /批准/ })).toHaveCount(0);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
});

test('model selection and automatic approval belong to the composer and current session', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await page.getByRole('textbox', { name: '筛选模型' }).fill('gpt-6-sol');
  await page.getByRole('option', { name: /GPT-6 Sol/ }).click();
  await expect(page.getByRole('button', { name: '选择模型', exact: true })).toContainText('gpt-6-sol');
  await page.getByRole('button', { name: '审批模式', exact: true }).click();
  await page.getByRole('button', { name: /自动审批 自动批准/ }).click();
  await expect(page.getByRole('button', { name: '审批模式', exact: true })).toContainText('自动审批');
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toContainText('工具');
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('需要审批');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.getByText('已收到你的消息。', { exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: /批准/ })).toHaveCount(0);
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '审批模式', exact: true })).toContainText('逐次审批');
});

test('rename, pin and classification update the session sidebar', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '会话操作 新会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '重命名会话', exact: true }).click();
  const rename = page.getByRole('dialog', { name: '重命名会话', exact: true });
  await rename.getByRole('textbox', { name: '会话名称' }).fill('研究笔记');
  await rename.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '研究笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '会话操作 研究笔记', exact: true }).click();
  await page.getByRole('menuitem', { name: '置顶', exact: true }).click();
  await expect(page.locator('.sidebar-section').filter({ has: page.locator('.sidebar-label', { hasText: '置顶' }) }).getByRole('button', { name: '研究笔记', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '会话操作 研究笔记', exact: true }).first().click();
  await page.getByRole('menuitem', { name: '分类', exact: true }).click();
  const category = page.getByRole('dialog', { name: '会话分类', exact: true });
  await category.getByRole('button', { name: '新建分类', exact: true }).click();
  await category.locator('input[name="categoryName"]').fill('调研');
  await category.getByRole('button', { name: '创建并归类', exact: true }).click();
  await expect(page.locator('.category-label').getByText('调研', { exact: true })).toBeVisible();
});

test('workspace navigation creates a zero-tool session and moves it without changing capabilities', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await expect(page.locator('.workspace-select')).toContainText('test-workspace');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
  await page.getByRole('button', { name: '会话操作 新会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '移动到工作区', exact: true }).click();
  const move = page.getByRole('dialog', { name: '移动到工作区', exact: true });
  await move.getByRole('combobox', { name: '工作区', exact: true }).selectOption('');
  await move.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.workspace-sessions').getByRole('button', { name: '新会话', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '管理会话工具', exact: true })).toHaveText('工具');
});

test('long chat and sidebar scroll internally while the window stays fixed at supported sizes', async ({ page }) => {
  await mockRuntime(page, true); await page.goto('/');
  await expect(page.getByRole('heading', { name: '会话 0', exact: true })).toBeVisible();
  for (const viewport of [{ width: 1280, height: 850 }, { width: 800, height: 600 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.chat-scroll').evaluate((element) => { element.scrollTop = 200; });
    await page.locator('.sidebar-scroll').evaluate((element) => { element.scrollTop = 200; });
    const layout = await page.evaluate(() => {
      const chat = document.querySelector('.chat-scroll')!;
      const sidebar = document.querySelector('.sidebar-scroll')!;
      const composer = document.querySelector('.composer')!.getBoundingClientRect();
      window.scrollTo(0, 500);
      return { windowY: window.scrollY, documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight, chatScrollable: chat.scrollHeight > chat.clientHeight, sidebarScrollable: sidebar.scrollHeight > sidebar.clientHeight, composerBottom: composer.bottom };
    });
    expect(layout.windowY).toBe(0);
    expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight + 1);
    expect(layout.chatScrollable).toBe(true);
    expect(layout.sidebarScrollable).toBe(true);
    expect(layout.composerBottom).toBeLessThanOrEqual(layout.viewportHeight);
    await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
    await page.getByRole('button', { name: /^上下文占用：/ }).click();
    await expect(page.getByRole('button', { name: '关闭上下文', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '关闭上下文', exact: true }).click();
  }
});

test('settings keeps keyboard focus inside the dialog and restores it when closed', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  const settingsButton = page.getByRole('button', { name: '设置', exact: true });
  await settingsButton.click();
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await expect(dialog).toBeVisible();
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  for (let index = 0; index < 14; index++) {
    await page.keyboard.press(index % 2 ? 'Tab' : 'Shift+Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(settingsButton).toBeFocused();
  const contextButton = page.getByRole('button', { name: /^上下文占用：/ });
  await contextButton.click();
  const contextDialog = page.getByRole('dialog', { name: '上下文详情', exact: true });
  await expect.poll(() => contextDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  expect(await contextDialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(contextDialog).toBeHidden();
  await expect(contextButton).toBeFocused();
});

test('dark theme model picker stays inside the minimum window', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 800, height: 600 });
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '选择模型', exact: true }).click();
  await expect(page.getByRole('option', { name: /GPT-6.1 Sol/ })).toBeVisible();
  const bounds = await page.locator('.model-popover').boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(800);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(600);
  await page.screenshot({ path: 'docs/screenshots/desktop-dark-model-picker-fixture.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox', { name: '可用模型' })).toHaveCount(0);
});

async function starts(page: Page) {
  return page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { runStarts: (ComposerDraft & { sessionId: string })[] } }).__M1TERA_TEST_STATE__.runStarts);
}

test('context ring precedes send and explains estimated usage plus the current model limit', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('这是一条上下文测量草稿');
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName(/预计 \d+ \/ 272,000 tokens/);
  const ringBounds = await ring.boundingBox();
  const sendBounds = await page.getByRole('button', { name: '发送消息', exact: true }).boundingBox();
  expect(ringBounds!.x + ringBounds!.width).toBeLessThanOrEqual(sendBounds!.x);
  await ring.hover();
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('预计输入');
  await expect(tooltip).toContainText('272,000');
  await expect(tooltip).toContainText('本地估算');
  await expect(page.getByText('零工具 · 不自动加载项目指令或记忆', { exact: true })).toHaveCount(0);
});

test('unknown compatible context maximum stays unknown until explicitly configured', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.getByRole('combobox', { name: '连接方式' }).selectOption('compatible');
  await settings.locator('input[name="model"]').fill('private-model');
  await settings.locator('input[name="apiKey"]').fill('fixture-memory-key');
  await settings.getByRole('button', { name: '保存设置', exact: true }).click();
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName(/\/ 未知 tokens/);
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('尚无法计算占用比例');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('input[name="contextWindow"]').fill('16384');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await expect(ring).toHaveAccessibleName(/\/ 16,384 tokens/);
});

test('slash pickers send structured plan and search commands for one turn and keep ordinary text intact', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/');
  await expect(page.getByRole('region', { name: '快捷命令' })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.draft-command')).toHaveText('做计划');
  await input.fill('设计一个读书计划');
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(1);
  expect((await starts(page))[0]).toMatchObject({ text: '设计一个读书计划', command: 'plan' });
  await expect(page.locator('.draft-command')).toHaveCount(0);
  await input.fill('/websearch');
  await expect(page.getByRole('option', { name: /联网搜索/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.locator('.draft-command')).toHaveText('联网搜索');
  await input.fill('查找 Tauri 官方文档');
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(2);
  expect((await starts(page))[1]).toMatchObject({ text: '查找 Tauri 官方文档', command: 'websearch' });
  await expect(page.locator('.draft-command')).toHaveCount(0);
  await page.getByRole('link', { name: /Tauri 官方文档/ }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { externalUrls: string[] } }).__M1TERA_TEST_STATE__.externalUrls)).toEqual(['https://v2.tauri.app/']);
  for (const text of ['/unknown 继续聊天', '邮件联系 hello@example.com，说明 /websearch 路径']) {
    await input.fill(text);
    await expect(page.locator('.composer-suggestions')).toHaveCount(0);
    await input.press('Enter');
  }
  await expect.poll(() => starts(page)).toHaveLength(4);
  expect((await starts(page)).slice(2)).toEqual(expect.arrayContaining([expect.objectContaining({ text: '/unknown 继续聊天' }), expect.objectContaining({ text: '邮件联系 hello@example.com，说明 /websearch 路径' })]));
  expect((await starts(page)).slice(2).every((start) => start.command === undefined)).toBe(true);
});

test('at and dollar pickers attach explicit workspace files and skills to the outgoing request', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: '添加工作区', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('@hello');
  await expect(page.getByRole('option', { name: /hello\.txt/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '移除文件 hello.txt', exact: true })).toBeVisible();
  await input.fill('$写作');
  await expect(page.getByRole('option', { name: /writing/ })).toBeVisible();
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '移除 Skill writing', exact: true })).toBeVisible();
  await input.fill('整理这个文件的内容');
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: Partial<ComposerDraft>[] } }).__M1TERA_TEST_STATE__.previewRequests.at(-1))).toMatchObject({ text: '整理这个文件的内容', attachments: ['hello.txt'], skillIds: ['writing'] });
  await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(1);
  expect((await starts(page))[0]).toMatchObject({ text: '整理这个文件的内容', attachments: ['hello.txt'], skillIds: ['writing'] });
  await expect(page.locator('.draft-chips')).toHaveCount(0);
});

test('Skills management creates edits disables imports deletes and scopes automatic selection to the session', async ({ page }) => {
  await mockRuntime(page); await page.goto('/');
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理 Skills', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Skills', exact: true });
  await dialog.getByRole('checkbox', { name: '自动匹配 Skills', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: '自动匹配 Skills', exact: true })).toBeChecked();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await dialog.locator('input[name="skillName"]').fill('review');
  await dialog.locator('textarea[name="skillDescription"]').fill('审查代码变更');
  await dialog.locator('input[name="skillTriggers"]').fill('review, 代码审查');
  await dialog.locator('textarea[name="skillInstructions"]').fill('检查行为变化和回归风险。');
  await dialog.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await dialog.getByRole('button', { name: /review 审查代码变更/ }).click();
  await dialog.locator('textarea[name="skillInstructions"]').fill('优先检查边界与权限，再审查行为变化。');
  await dialog.getByRole('button', { name: '保存 Skill', exact: true }).click();
  await dialog.getByRole('checkbox', { name: '启用 Skill review', exact: true }).uncheck();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill review', exact: true })).not.toBeChecked();
  await dialog.getByRole('button', { name: '导入', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill imported-skill', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { importedPaths: string[] } }).__M1TERA_TEST_STATE__.importedPaths)).toEqual(['/tmp/test-skills/SKILL.md']);
  await dialog.getByRole('button', { name: '删除 Skill imported-skill', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: '删除“imported-skill”？', exact: true });
  await confirmation.getByRole('button', { name: '删除 Skill', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: '启用 Skill imported-skill', exact: true })).toHaveCount(0);
  const library = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { skills: Skill[] } }).__M1TERA_TEST_STATE__.skills);
  expect(library.find((skill) => skill.name === 'review')).toMatchObject({ enabled: false, instructions: '优先检查边界与权限，再审查行为变化。', triggers: ['review', '代码审查'] });
  await dialog.getByRole('button', { name: '关闭 Skills', exact: true }).click();
  await page.getByRole('textbox', { name: '发送消息', exact: true }).fill('$review');
  await expect(page.getByText('没有匹配的结果', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await page.getByRole('button', { name: '管理 Skills', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: '自动匹配 Skills', exact: true })).not.toBeChecked();
});

test('a failed first send keeps the new-session draft command and skill chips available for retry', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/plan'); await input.press('Enter');
  await input.fill('$writing');
  await expect(page.getByRole('option', { name: /writing/ })).toBeVisible();
  await input.press('Enter');
  await input.fill('首次发送失败'); await input.press('Enter');
  await expect(page.getByRole('alert')).toContainText('模拟首次发送失败');
  await expect(input).toHaveValue('首次发送失败');
  await expect(page.locator('.draft-command')).toHaveText('做计划');
  await expect(page.getByRole('button', { name: '移除 Skill writing', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
  expect((await starts(page))[0]).toMatchObject({ text: '首次发送失败', command: 'plan', skillIds: ['writing'] });
  await input.fill('重试这个计划'); await input.press('Enter');
  await expect.poll(() => starts(page)).toHaveLength(2);
  expect((await starts(page))[1]).toMatchObject({ text: '重试这个计划', command: 'plan', skillIds: ['writing'] });
  await expect(page.locator('.draft-chips')).toHaveCount(0);
});

test('an unsent draft in another session cannot replace a running search payload or its 128k limit', async ({ page }) => {
  await mockRuntime(page, true); await page.goto('/'); await login(page);
  await page.getByRole('button', { name: /^会话 1(?: 运行中)?$/ }).click();
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/websearch'); await input.press('Enter');
  await input.fill('后台搜索长任务'); await input.press('Enter');
  const ring = page.getByRole('button', { name: /^上下文占用：/ });
  await expect(ring).toHaveAccessibleName('上下文占用：预计 700 / 128,000 tokens');
  await expect(page.locator('.running-tool').filter({ hasText: '联网搜索' })).toBeVisible();
  const searchPreviews = await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: { sessionId?: string }[] } }).__M1TERA_TEST_STATE__.previewRequests.filter((request) => request.sessionId === 'fixture-1').length);
  await page.getByRole('button', { name: '会话 0', exact: true }).click();
  await input.fill('a'.repeat(8000));
  await expect(ring).toHaveAccessibleName('上下文占用：预计 2,040 / 272,000 tokens');
  await page.getByRole('button', { name: /^会话 1(?: 运行中)?$/ }).click();
  await expect(page.getByRole('heading', { name: '会话 1', exact: true })).toBeVisible();
  await expect(ring).toHaveAccessibleName('上下文占用：预计 700 / 128,000 tokens');
  await ring.hover();
  await expect(page.getByRole('tooltip')).toContainText('128,000');
  // Re-entering a running session must not request a fresh pure-chat preview.
  expect(await page.evaluate(() => (window as Window & { __M1TERA_TEST_STATE__: { previewRequests: { sessionId?: string }[] } }).__M1TERA_TEST_STATE__.previewRequests.filter((request) => request.sessionId === 'fixture-1').length)).toBe(searchPreviews);
});

test('a cancelled hosted search settles the pending tool card without a lingering spinner', async ({ page }) => {
  await mockRuntime(page); await page.goto('/'); await login(page);
  const input = page.getByRole('textbox', { name: '发送消息', exact: true });
  await input.fill('/websearch'); await input.press('Enter');
  await input.fill('后台搜索长任务'); await input.press('Enter');
  const search = page.locator('.tool-card').filter({ hasText: '联网搜索' });
  await expect(search).toContainText('执行中');
  await expect(search.locator('.spin')).toHaveCount(1);
  // The fixture emits run.finished without tool.finished, as a provider-side cancellation can.
  await page.getByRole('button', { name: '停止运行', exact: true }).click();
  await expect(search).toContainText('已停止');
  await expect(search).toHaveClass(/tool-error/);
  await expect(search.locator('.spin')).toHaveCount(0);
  await expect(page.locator('.running-tool')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '停止运行', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeVisible();
});
