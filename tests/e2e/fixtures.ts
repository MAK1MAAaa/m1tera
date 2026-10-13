import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import type { BenchmarkReport, BenchmarkStatus, BenchmarkSuiteId, ComposerDraft, ConfiguredModel, ModelCatalog, ModelOption, Organization, RequestMap, RuntimeMethod, RuntimeEvent, Session, Settings, Skill, SkillDraft, SkillSummary } from '../../shared/protocol';
import type { RuntimeClient } from '../../src/lib/runtime-client';

interface FixtureOptions { connected?: boolean; resumable?: boolean }
export interface FixtureState {
  pending?: { sessionId: string; id: string };
  opened: number;
  key?: string;
  providerKeys: Record<string, string>;
  settings: Settings;
  settingsWrites: Settings[];
  failDiscoveries: boolean;
  providerWarnings: Record<string, string>;
  discoveryRequests: Record<string, unknown>[];
  runStarts: (ComposerDraft & { sessionId: string })[];
  resumeRequests: string[];
  externalUrls: string[];
  importedPaths: string[];
  previewRequests: (Partial<ComposerDraft> & { sessionId?: string })[];
  sessions: Session[];
  skills: Skill[];
  benchmarkRunning?: NonNullable<BenchmarkStatus['running']>;
  benchmarkReports: Record<string, BenchmarkReport>;
  benchmarkStarts: { suite: BenchmarkSuiteId; limit: number }[];
  benchmarkCancels: number;
  finishBenchmark: (cancelled?: boolean) => void;
  emit: (event: RuntimeEvent) => void;
}

export async function mockRuntime(page: Page, longContent = false, officialModelCount = 0, options: FixtureOptions = {}) {
  await page.addInitScript(({ defaults, longContent, officialModelCount, options }) => {
    let settings: Settings = { ...defaults, providerId: 'chatgpt', chatgptModels: [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', enabled: true, source: 'endpoint' },
      ...Array.from({ length: officialModelCount }, (_, index) => ({ id: `fixture-model-${index}`, name: `测试模型 ${index}`, enabled: false, source: 'endpoint' as const })),
    ], customProviders: [] };
    let connected = options.connected ?? false;
    const catalogs = new Map<string, ModelCatalog>();
    const listeners = new Set<(event: RuntimeEvent) => void>();
    const sessions: Session[] = [];
    const organization: Organization = { workspaces: [], categories: [] };
    const runs = new Map<string, string>();
    const skills: Skill[] = [{ id: 'writing', name: 'writing', description: '整理文章和写作任务', instructions: '先组织观点，再写清晰简洁的内容。', triggers: ['写作', 'writing'], enabled: true, builtin: false, updatedAt: new Date().toISOString() }];
    if (longContent) {
      const date = new Date().toISOString();
      for (let index = 0; index < 45; index++) sessions.push({ id: `fixture-${index}`, title: `会话 ${index}`, createdAt: date, updatedAt: date, messageCount: index ? 0 : 1, enabledTools: [], workspace: '', approvalMode: 'ask', pinned: false, messages: index ? [] : [{ id: 'long-message', role: 'assistant', text: Array.from({length: 160}, (_, line) => `第 ${line + 1} 段：用于验证聊天内部滚动、长代码与内容布局。`).join('\n\n'), createdAt: date }] });
    }
    if (options.resumable) {
      const date = new Date().toISOString();
      sessions.unshift({ id: 'recovered-session', title: '中断的任务', createdAt: date, updatedAt: date, messageCount: 1,
        messages: [{ id: 'previous-input', role: 'user', text: '继续整理工作区', createdAt: date }], enabledTools: ['write_file', 'run_command'], workspace: '/tmp/test-workspace', approvalMode: 'auto',
        runState: { runId: 'interrupted-run', status: 'interrupted', modelTurns: 3, canResume: true, unknownToolCalls: 2 } });
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
    const state: FixtureState = { opened: 0, providerKeys: {}, settings, settingsWrites: [], failDiscoveries: false, providerWarnings: {}, discoveryRequests: [], runStarts: [], resumeRequests: [], externalUrls: [], importedPaths: [], previewRequests: [], sessions, skills, benchmarkReports: {}, benchmarkStarts: [], benchmarkCancels: 0, finishBenchmark: () => undefined, emit };
    state.finishBenchmark = (cancelled = false) => {
      const running = state.benchmarkRunning;
      if (!running) return;
      const completed = cancelled ? running.completed : running.total;
      const graded = Math.min(completed, 2);
      const unknown = running.total - graded;
      const report: BenchmarkReport = {
        mode: 'fixture', status: cancelled ? 'cancelled' : 'completed', suite: running.suite, name: running.suite === 'bfcl-v4' ? 'BFCL v4 隔离 UI fixture' : 'SimpleQA 隔离 UI fixture', model: settings.model,
        measuredAt: new Date().toISOString(), source: { revision: 'isolated-ui-fixture', upstream: 'https://fixture-source.test/', license: 'Fixture only', sourceFileHashes: {}, selectedIds: Array.from({ length: running.total }, (_, index) => `fixture-${index}`), sampling: '隔离模拟数据，不是原题跑分', subsetSha256: '0'.repeat(64) },
        grader: 'Isolated UI fixture; no model has been graded', settings: { browsing: false, maxAnswerTurns: 1, freshContextPerTask: true, sameModelForGrader: running.suite === 'simpleqa' },
        total: running.total, completed,
        cases: Array.from({ length: running.total }, (_, index) => ({ id: `fixture-${index}`, status: index >= graded ? 'unknown' : index === 0 ? 'passed' : 'failed', ...(index >= graded ? { error: cancelled ? '模拟未执行的题目' : '模拟评分请求失败' } : { answer: '隔离模拟作答', grade: index === 0 ? 'CORRECT' : 'INCORRECT' }), elapsedMs: index < completed ? 10 : null, estimatedInputTokens: index < completed ? 40 : null, usage: null })),
        metrics: { correct: Math.min(1, graded), incorrect: Math.max(0, graded - 1), notAttempted: 0, unknown, graded, accuracy: null, accuracyGivenAttempted: null, denominator: 'graded cases', knownInputTokens: 0, totalInputTokens: null, inputUsageUnknown: true, estimatedInputTokens: completed * 40, elapsedMs: completed * 10 },
      };
      state.benchmarkReports[running.runId] = report;
      state.benchmarkRunning = undefined;
      emit({ type: 'benchmark.finished', runId: running.runId });
    };
    const officialModels = (): ModelOption[] => [
      { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 272000, reasoning: true, source: 'endpoint', availability: 'available' },
      { id: 'gpt-6-sol', name: 'GPT-6 Sol', contextWindow: 272000, reasoning: true, source: 'endpoint', availability: 'available' },
      { id: 'deprecated-model', name: '已弃用模型', source: 'endpoint', availability: 'unavailable', unavailableReason: '模型已弃用' },
      { id: 'removed-model', name: '已移除模型', source: 'endpoint', availability: 'unavailable', unavailableReason: '模型已移除' },
      ...Array.from({ length: officialModelCount }, (_, index): ModelOption => ({ id: `fixture-model-${index}`, name: `测试模型 ${index}`, source: 'endpoint', availability: 'available' })),
    ];
    const configuration = () => ({ settings: structuredClone(settings), hasApiKey: !!state.providerKeys[settings.providerId ?? ''],
      providerStatus: (settings.customProviders ?? []).map((provider) => ({ id: provider.id, hasApiKey: !!state.providerKeys[provider.id] })), chatgpt: { connected, loginPending: false } });
    const modelInventory = (): ModelOption[] => {
      if (connected && !state.failDiscoveries) catalogs.set('chatgpt', { models: officialModels(), fetched: true });
      const options: ModelOption[] = [];
      const append = (providerId: string, providerName: string, configured: ConfiguredModel[], catalog?: ModelCatalog) => {
        const directory = catalog?.models ?? [];
        for (const id of new Set([...directory.map((model) => model.id), ...configured.map((model) => model.id)])) {
          const saved = configured.find((model) => model.id === id);
          const remote = directory.find((model) => model.id === id);
          const missing = !!catalog?.fetched && !remote && (providerId === 'chatgpt' || saved?.source === 'endpoint');
          const availability = missing ? 'unavailable' : remote?.availability ?? 'unverified';
          options.push({ ...remote, id, name: saved?.name ?? remote?.name ?? id, providerId, providerName, source: remote?.source ?? 'configured',
            contextWindow: saved?.contextWindow ?? remote?.contextWindow, availability, enabled: !!saved?.enabled && availability !== 'unavailable',
            ...(missing ? { unavailableReason: '最新目录已移除此模型' } : {}), ...(state.providerWarnings[providerId] ? { catalogWarning: state.providerWarnings[providerId] } : {}) });
        }
      };
      append('chatgpt', 'ChatGPT', settings.chatgptModels ?? [], catalogs.get('chatgpt') ?? { models: [{ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', contextWindow: 272000, source: 'catalog', availability: 'unverified' }], fetched: false });
      for (const provider of settings.customProviders ?? []) append(provider.id, provider.name, provider.models, catalogs.get(provider.id));
      return options;
    };
    const summary = (session: Session) => ({ id: session.id, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, messageCount: session.messages.length, pinned: session.pinned, categoryId: session.categoryId, workspaceId: session.workspaceId, workspace: session.workspace, approvalMode: session.approvalMode, autoSkills: session.autoSkills, runState: session.runState });
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
          case 'settings.get': result = configuration(); break;
          case 'settings.set': {
            const next = structuredClone(p.settings as Settings);
            state.settingsWrites.push(next);
            for (const id of Object.keys(state.providerKeys)) {
              const previous = settings.customProviders?.find((provider) => provider.id === id);
              const provider = next.customProviders?.find((item) => item.id === id);
              if (!provider || previous?.baseUrl !== provider.baseUrl) { delete state.providerKeys[id]; catalogs.delete(id); }
            }
            settings = next; state.settings = settings;
            const updates = p.providerApiKeys as Record<string, string> | undefined;
            for (const [id, key] of Object.entries(updates ?? {})) { if (key) state.providerKeys[id] = key; else delete state.providerKeys[id]; }
            if (p.apiKey !== undefined) { state.key = String(p.apiKey); if (state.key) state.providerKeys[settings.providerId!] = state.key; }
            result = configuration(); break;
          }
          case 'models.list': result = modelInventory(); break;
          case 'benchmark.status': result = { running: state.benchmarkRunning, reports: Object.entries(state.benchmarkReports).map(([runId, report]) => ({ runId, suite: report.suite, model: report.model, mode: report.mode, status: report.status, completed: report.completed, total: report.total, accuracy: report.metrics.accuracy, graded: report.metrics.graded, unknown: report.metrics.unknown })) }; break;
          case 'benchmark.start': {
            if (!connected) throw new Error('模拟接口未连接');
            const suite = p.suite as BenchmarkSuiteId;
            const limit = Number(p.limit);
            state.benchmarkStarts.push({ suite, limit });
            const runId = crypto.randomUUID();
            state.benchmarkRunning = { runId, suite, completed: 0, total: limit };
            emit({ type: 'benchmark.progress', ...state.benchmarkRunning });
            result = { runId }; break;
          }
          case 'benchmark.report': {
            const report = state.benchmarkReports[String(p.runId)];
            if (!report) throw new Error('模拟报告不存在');
            result = structuredClone(report); break;
          }
          case 'benchmark.cancel': state.benchmarkCancels++; state.finishBenchmark(true); result = { cancelled: true }; break;
          case 'models.discover': {
            state.discoveryRequests.push(structuredClone(p));
            const providerId = String(p.providerId ?? settings.providerId ?? 'chatgpt');
            if (state.failDiscoveries) { result = { models: [], fetched: false, warning: '模拟目录获取失败，现有配置已保留。' }; break; }
            if (providerId === 'chatgpt') {
              if (!connected) { result = { models: [], fetched: false, warning: '请先连接 ChatGPT。' }; break; }
              const catalog: ModelCatalog = { models: officialModels(), fetched: true };
              catalogs.set(providerId, catalog); result = structuredClone(catalog); break;
            }
            // No endpoint is contacted: this fixture represents an authenticated GET /models data response.
            const data = [{ id: 'remote-model', name: '共享模型', context_window: 32768 }, { id: 'deprecated-model', name: '已弃用模型', status: 'deprecated' }, { id: 'removed-model', name: '已移除模型', status: 'removed' }];
            const catalog: ModelCatalog = { fetched: true, models: data.map((model): ModelOption => ({ id: model.id, name: model.name, source: 'endpoint', contextWindow: model.context_window,
              availability: model.status ? 'unavailable' : 'available', ...(model.status ? { unavailableReason: model.status === 'deprecated' ? '模型已弃用' : '模型已移除' } : {}) })) };
            catalogs.set(providerId, catalog); result = structuredClone(catalog); break;
          }
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
          case 'auth.logout': connected = false; catalogs.delete('chatgpt'); emit({ type: 'auth.status', status: { connected, loginPending: false } }); result = { loggedOut: true }; break;
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
          case 'run.resume': {
            state.resumeRequests.push(String(p.sessionId));
            const session = sessions.find((item) => item.id === p.sessionId)!;
            if (!connected || !session.runState?.canResume) throw new Error('模拟会话不能继续');
            const runId = crypto.randomUUID();
            session.approvalMode = 'ask';
            session.runState = { runId, status: 'running', modelTurns: 0, canResume: false, unknownToolCalls: 0 };
            runs.set(session.id, runId);
            emit({ type: 'session.updated', session: summary(session) });
            emit({ type: 'run.started', sessionId: session.id, runId });
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
  }, { defaults: DEFAULT_SETTINGS, longContent, officialModelCount, options });
}

export async function login(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with ChatGPT', exact: true }).click();
  await expect(page.getByText('ChatGPT 已连接', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
}

export async function openSettings(page: Page) {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  return page.getByRole('dialog', { name: '设置', exact: true });
}

export async function addCustomProvider(page: Page, name: string, baseUrl = 'https://mock-base-url.test/v1', apiKey = 'fixture-memory-key') {
  const dialog = page.getByRole('dialog', { name: '设置', exact: true });
  await dialog.getByRole('button', { name: '新增接口', exact: true }).click();
  const editor = dialog.locator('.custom-provider-editor').last();
  await editor.locator('input[name="providerName"]').fill(name);
  await editor.locator('input[name="baseUrl"]').fill(baseUrl);
  await editor.locator('input[name="apiKey"]').fill(apiKey);
  await editor.locator('select[name="apiFormat"]').selectOption('chat-completions');
  return editor;
}

export async function addManualModel(page: Page, providerName: string, id: string, name?: string, contextWindow?: number) {
  const provider = page.getByRole('region', { name: providerName, exact: true });
  await provider.getByRole('button', { name: '手动添加模型', exact: true }).click();
  await provider.locator('input[name="modelId"]').fill(id);
  if (name) await provider.locator('input[name="modelName"]').fill(name);
  if (contextWindow !== undefined) await provider.locator('input[name="contextWindow"]').fill(String(contextWindow));
  await provider.getByRole('button', { name: '添加模型', exact: true }).click();
  return provider.locator(`input[name^="enabledModel:"][name$=":${id}"]`);
}

