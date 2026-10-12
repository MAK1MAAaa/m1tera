import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SETTINGS } from '../../shared/protocol';
import type { Approval, ApprovalMode, AuthStatus, ComposerDraft, ContextEstimate, DisplayMessage, ModelOption, Organization, RequestMap, RuntimeEvent, Session, SessionCategory, SessionSummary, Settings, Skill, SkillDraft, SkillSummary, TokenUsage, Workspace, WorkspaceFile } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';

export interface ActiveTool {
  id: string;
  name: string;
  arguments: unknown;
  status: 'running' | 'success' | 'error';
  text?: string;
  automaticallyApproved?: boolean;
}
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function upsertSummary(sessions: SessionSummary[], session: SessionSummary) {
  return [session, ...sessions.filter((item) => item.id !== session.id)]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function useRuntime(client: RuntimeClient) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [chatgpt, setChatgpt] = useState<AuthStatus>({ connected: false, loginPending: false });
  const [authPrompt, setAuthPrompt] = useState<{ id: string; message: string; placeholder?: string } | null>(null);
  const [authMessage, setAuthMessage] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [organization, setOrganization] = useState<Organization>({ workspaces: [], categories: [] });
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [draftPreview, setDraftEstimate] = useState<{ sessionId: string | null; estimate: ContextEstimate }>();
  const [loaded, setLoaded] = useState<Record<string, Session>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [estimates, setEstimates] = useState<Record<string, ContextEstimate>>({});
  const [usages, setUsages] = useState<Record<string, TokenUsage | null>>({});
  const [tools, setTools] = useState<Record<string, ActiveTool[]>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(client.transport === 'browser');
  const [busy, setBusy] = useState(false);
  const [lastStatus, setLastStatus] = useState<Record<string, string>>({});
  const [retryCount, setRetryCount] = useState(0);
  const selectedRef = useRef<string | null>(null);
  const activeRuns = useRef<Record<string, string>>({});
  const contextRevision = useRef<Record<string, number>>({});
  const pendingCreate = useRef<Promise<Session> | null>(null);
  const modelRequest = useRef(0);
  const draftRequest = useRef(0);
  const lastDraft = useRef<ComposerDraft>({ text: '' });
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftWorkspace = loaded[selectedId ?? '']?.workspace;
  const draftAutoSkills = loaded[selectedId ?? '']?.autoSkills;
  const draftTools = loaded[selectedId ?? '']?.enabledTools;

  const storeSession = useCallback((session: Session) => {
    setLoaded((current) => ({ ...current, [session.id]: session }));
    setSessions((current) => upsertSummary(current, session));
  }, []);

  const preview = useCallback(async (sessionId?: string) => {
    if (client.transport === 'browser' || sessionId && activeRuns.current[sessionId]) return;
    const key = sessionId ?? 'new';
    const revision = contextRevision.current[key] ?? 0;
    try {
      const estimate = await client.request('context.preview', sessionId ? { sessionId } : {});
      if (revision === (contextRevision.current[key] ?? 0) && !activeRuns.current[key]) setEstimates((current) => ({ ...current, [key]: estimate }));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client]);

  const refreshModels = useCallback(async () => {
    if (client.transport === 'browser') return;
    const request = ++modelRequest.current;
    setModelsLoading(true);
    try {
      const list = await client.request('models.list', {});
      if (request === modelRequest.current) setModels(list);
    } catch (cause) { if (request === modelRequest.current) setError(errorMessage(cause)); }
    finally { if (request === modelRequest.current) setModelsLoading(false); }
  }, [client]);

  const refreshSkills = useCallback(async () => {
    if (client.transport === 'browser') return;
    setSkillsLoading(true);
    try { setSkills(await client.request('skills.list', {})); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { setSkillsLoading(false); }
  }, [client]);

  const previewDraft = useCallback((draft: ComposerDraft) => {
    lastDraft.current = draft;
    clearTimeout(draftTimer.current);
    const generation = ++draftRequest.current;
    const id = selectedRef.current;
    if (client.transport === 'browser' || id && runs[id]) return;
    draftTimer.current = setTimeout(() => {
      void client.request('context.preview', { ...draft, ...(id ? { sessionId: id } : {}) }).then((estimate) => {
        if (generation === draftRequest.current && selectedRef.current === id && !activeRuns.current[id ?? 'new']) setDraftEstimate({ sessionId: id, estimate });
      }).catch((cause: unknown) => { if (generation === draftRequest.current) { setDraftEstimate(undefined); setError(errorMessage(cause)); } });
    }, 160);
  }, [client, runs]);

  useEffect(() => {
    previewDraft(lastDraft.current);
    return () => clearTimeout(draftTimer.current);
  }, [selectedId, settings, models, skills, previewDraft, draftWorkspace, draftAutoSkills, draftTools]);

  useEffect(() => {
    if (client.transport === 'browser') return;
    modelRequest.current++;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    const receive = (event: RuntimeEvent) => {
      if (disposed) return;
      switch (event.type) {
        case 'runtime.failed':
          activeRuns.current = {};
          setError(event.message);
          setReady(false);
          setHasApiKey(false);
          setRuns({});
          setApprovals([]);
          setTools({});
          setChatgpt({ connected: false, loginPending: false });
          setAuthPrompt(null);
          setAuthMessage(null);
          setLastStatus((current) => Object.fromEntries(Object.keys(current).map((id) => [id, '运行时已断开'])));
          break;
        case 'auth.url':
          setAuthMessage('在浏览器完成授权。');
          void client.openAuthUrl(event.url).catch((cause: unknown) => setError(errorMessage(cause)));
          break;
        case 'auth.prompt':
          setAuthPrompt({ id: event.id, message: event.message, placeholder: event.placeholder });
          break;
        case 'auth.status':
          setChatgpt(event.status);
          if (!event.status.loginPending) setAuthPrompt(null);
          setAuthMessage(event.message ?? (event.status.connected ? 'ChatGPT 已连接。' : null));
          break;
        case 'run.started':
          activeRuns.current[event.sessionId] = event.runId;
          contextRevision.current[event.sessionId] = (contextRevision.current[event.sessionId] ?? 0) + 1;
          draftRequest.current++;
          setDraftEstimate(undefined);
          setRuns((current) => ({ ...current, [event.sessionId]: event.runId }));
          setTools((current) => ({ ...current, [event.sessionId]: [] }));
          setLastStatus((current) => ({ ...current, [event.sessionId]: '运行中' }));
          break;
        case 'message':
          setLoaded((current) => {
            const session = current[event.sessionId];
            if (!session) return current;
            const existing = session.messages.findIndex((item) => item.id === event.message.id);
            const messages = [...session.messages];
            if (existing >= 0) messages[existing] = event.message;
            else messages.push(event.message);
            return { ...current, [event.sessionId]: { ...session, messages } };
          });
          break;
        case 'text.delta':
          setLoaded((current) => {
            const session = current[event.sessionId];
            if (!session) return current;
            const existing = session.messages.find((item) => item.id === event.messageId);
            const message: DisplayMessage = existing
              ? { ...existing, text: existing.text + event.delta }
              : { id: event.messageId, role: 'assistant', text: event.delta, createdAt: new Date().toISOString() };
            const messages = existing
              ? session.messages.map((item) => item.id === message.id ? message : item)
              : [...session.messages, message];
            return { ...current, [event.sessionId]: { ...session, messages } };
          });
          break;
        case 'tool.started':
          setTools((current) => ({ ...current, [event.sessionId]: [
            ...(current[event.sessionId] ?? []).filter((tool) => tool.id !== event.toolCallId),
            { id: event.toolCallId, name: event.toolName, arguments: event.arguments, status: 'running' },
          ] }));
          break;
        case 'tool.finished':
          setTools((current) => ({ ...current, [event.sessionId]: (current[event.sessionId] ?? []).map((tool) =>
            tool.id === event.toolCallId ? { ...tool, status: event.isError ? 'error' : 'success', text: event.text } : tool) }));
          break;
        case 'skill.used':
          setLastStatus((current) => ({ ...current, [event.sessionId]: `使用 ${event.skill.name}` }));
          break;
        case 'approval.requested':
          setApprovals((current) => [...current.filter((item) => item.id !== event.approval.id), event.approval]);
          break;
        case 'approval.resolved':
          setApprovals((current) => current.filter((item) => item.id !== event.approvalId));
          if (event.automatic) setTools((current) => ({
            ...current,
            [event.sessionId]: (current[event.sessionId] ?? []).map((tool) => tool.status === 'running' && tool.name === event.toolName ? { ...tool, automaticallyApproved: true } : tool),
          }));
          break;
        case 'context':
          contextRevision.current[event.sessionId] = (contextRevision.current[event.sessionId] ?? 0) + 1;
          setEstimates((current) => ({ ...current, [event.sessionId]: event.estimate }));
          setUsages((current) => ({ ...current, [event.sessionId]: event.usage }));
          break;
        case 'session.updated':
          setSessions((current) => upsertSummary(current, event.session));
          setLoaded((current) => current[event.session.id]
            ? { ...current, [event.session.id]: { ...current[event.session.id], ...event.session, categoryId: event.session.categoryId, workspaceId: event.session.workspaceId } }
            : current);
          break;
        case 'run.finished':
          if (activeRuns.current[event.sessionId] === event.runId) delete activeRuns.current[event.sessionId];
          setRuns((current) => {
            const next = { ...current };
            if (next[event.sessionId] === event.runId) delete next[event.sessionId];
            return next;
          });
          setTools((current) => ({ ...current, [event.sessionId]: (current[event.sessionId] ?? []).map((tool) => tool.status === 'running'
            ? { ...tool, status: 'error', text: event.status === 'cancelled' ? '已停止' : '未完成' }
            : tool) }));
          setApprovals((current) => current.filter((item) => item.runId !== event.runId));
          setLastStatus((current) => ({ ...current, [event.sessionId]: event.status === 'cancelled' ? '已停止' : event.status === 'error' ? '运行失败' : '已完成' }));
          if (event.error) setError(event.error);
          break;
      }
    };
    async function initialize() {
      try {
        unsubscribe = await client.subscribe(receive);
        if (disposed) { unsubscribe(); return; }
        const [configuration, list, organization, skills] = await Promise.all([client.request('settings.get', {}), client.request('sessions.list', {}), client.request('organization.get', {}), client.request('skills.list', {})]);
        if (disposed) return;
        setSettings(configuration.settings);
        setHasApiKey(configuration.hasApiKey);
        setChatgpt(configuration.chatgpt);
        setSessions(list);
        setOrganization(organization);
        setSkills(skills);
        if (list[0]) {
          const session = await client.request('sessions.load', { sessionId: list[0].id });
          if (disposed) return;
          storeSession(session);
          selectedRef.current = session.id;
          setSelectedId(session.id);
          await preview(session.id);
        } else await preview();
        if (!disposed) { setReady(true); void refreshModels(); }
      } catch (cause) { if (!disposed) setError(errorMessage(cause)); }
    }
    void initialize();
    return () => { disposed = true; unsubscribe?.(); };
  }, [client, preview, refreshModels, retryCount, storeSession]);

  const selectSession = useCallback(async (id: string) => {
    selectedRef.current = id;
    setSelectedId(id);
    setError(null);
    try {
      if (!loaded[id]) {
        const session = await client.request('sessions.load', { sessionId: id });
        storeSession(session);
      }
      await preview(id);
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, loaded, preview, storeSession]);

  const createSession = useCallback(async (options: RequestMap['sessions.create']['params'] = {}) => {
    if (pendingCreate.current) return pendingCreate.current;
    setError(null);
    const creation = client.request('sessions.create', options);
    pendingCreate.current = creation;
    try {
      const session = await creation;
      storeSession(session);
      selectedRef.current = session.id;
      setSelectedId(session.id);
      await preview(session.id);
      return session;
    } finally { pendingCreate.current = null; }
  }, [client, preview, storeSession]);

  const send = useCallback(async (input: string | ComposerDraft) => {
    setBusy(true);
    setError(null);
    try {
      const sessionId = selectedRef.current ?? (await createSession()).id;
      const draft = typeof input === 'string' ? { text: input } : input;
      await client.request('run.start', { sessionId, ...draft });
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
    finally { setBusy(false); }
  }, [client, createSession]);

  const cancel = useCallback(async () => {
    if (!selectedRef.current) return;
    try { await client.request('run.cancel', { sessionId: selectedRef.current }); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [client]);

  const saveSettings = useCallback(async (draft: Settings, apiKey?: string, approvalMode?: ApprovalMode) => {
    const sessionId = selectedRef.current;
    try {
      const result = await client.request('settings.set', { settings: draft, ...(apiKey !== undefined ? { apiKey } : {}) });
      setSettings(result.settings);
      setHasApiKey(result.hasApiKey);
      setChatgpt(result.chatgpt);
      if (sessionId) {
        const session = await client.request('sessions.configure', { sessionId, enabledTools: draft.enabledTools, workspace: draft.workspace, ...(approvalMode ? { approvalMode } : {}) });
        storeSession(session);
      }
      await preview(sessionId ?? undefined);
      await refreshModels();
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, preview, refreshModels, storeSession]);

  const updateSession = useCallback(async (id: string, patch: Omit<RequestMap['sessions.update']['params'], 'sessionId'>) => {
    setError(null);
    try {
      const session = await client.request('sessions.update', { sessionId: id, ...patch });
      storeSession(session);
      await preview(id);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, preview, storeSession]);

  const createWorkspace = useCallback(async (path: string, name?: string): Promise<Workspace | undefined> => {
    setError(null);
    try {
      const workspace = await client.request('workspaces.create', { path, ...(name ? { name } : {}) });
      setOrganization(await client.request('organization.get', {}));
      return workspace;
    } catch (cause) { setError(errorMessage(cause)); return undefined; }
  }, [client]);

  const renameWorkspace = useCallback(async (id: string, name: string) => {
    setError(null);
    try {
      await client.request('workspaces.rename', { workspaceId: id, name });
      setOrganization(await client.request('organization.get', {}));
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client]);

  const createCategory = useCallback(async (name: string): Promise<SessionCategory | undefined> => {
    setError(null);
    try {
      const category = await client.request('categories.create', { name });
      setOrganization(await client.request('organization.get', {}));
      return category;
    } catch (cause) { setError(errorMessage(cause)); return undefined; }
  }, [client]);

  const selectModel = useCallback(async (model: string) => {
    setError(null);
    try {
      const result = await client.request('settings.set', { settings: { ...settings, model, contextWindow: undefined, apiFormat: model === 'gpt-6.1-sol' ? 'responses' : settings.apiFormat } });
      setSettings(result.settings);
      setHasApiKey(result.hasApiKey);
      setChatgpt(result.chatgpt);
      await preview(selectedRef.current ?? undefined);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, preview, settings]);

  const setApprovalMode = useCallback(async (approvalMode: ApprovalMode) => {
    setError(null);
    try {
      const sessionId = selectedRef.current ?? (await createSession()).id;
      const session = loaded[sessionId] ?? await client.request('sessions.load', { sessionId });
      const updated = await client.request('sessions.configure', { sessionId, enabledTools: session.enabledTools, workspace: session.workspace, approvalMode });
      storeSession(updated);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, createSession, loaded, storeSession]);

  const listFiles = useCallback(async (query: string): Promise<WorkspaceFile[]> => {
    const id = selectedRef.current;
    if (!id) return [];
    return client.request('files.list', { sessionId: id, query });
  }, [client]);

  const loadSkill = useCallback(async (skillId: string): Promise<Skill | undefined> => {
    try { return await client.request('skills.get', { skillId }); }
    catch (cause) { setError(errorMessage(cause)); return undefined; }
  }, [client]);

  const saveSkill = useCallback(async (skill: SkillDraft, id?: string) => {
    setError(null);
    try {
      if (id) await client.request('skills.update', { skillId: id, patch: skill });
      else await client.request('skills.create', { skill });
      await refreshSkills();
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, refreshSkills]);

  const importSkill = useCallback(async (path: string) => {
    setError(null);
    try { await client.request('skills.import', { path }); await refreshSkills(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, refreshSkills]);

  const deleteSkill = useCallback(async (skillId: string) => {
    setError(null);
    try { const result = await client.request('skills.delete', { skillId }); await refreshSkills(); return result.deleted; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, refreshSkills]);

  const toggleSkill = useCallback(async (skillId: string, enabled: boolean) => {
    setError(null);
    try { await client.request('skills.update', { skillId, patch: { enabled } }); await refreshSkills(); return true; }
    catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, refreshSkills]);

  const setAutoSkills = useCallback(async (autoSkills: boolean) => {
    setError(null);
    try {
      const id = selectedRef.current ?? (await createSession()).id;
      const session = loaded[id] ?? await client.request('sessions.load', { sessionId: id });
      storeSession(await client.request('sessions.configure', { sessionId: id, workspace: session.workspace, enabledTools: session.enabledTools, autoSkills }));
      await preview(id);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [client, createSession, loaded, preview, storeSession]);

  const resolveApproval = useCallback(async (id: string, approved: boolean) => {
    try {
      await client.request('approval.resolve', { approvalId: id, approved });
      setApprovals((current) => current.filter((item) => item.id !== id));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client]);

  const authAction = useCallback(async (action: 'login' | 'cancel' | 'logout') => {
    setError(null);
    try {
      if (action === 'login') await client.request('auth.login', {});
      else if (action === 'cancel') await client.request('auth.cancel', {});
      else await client.request('auth.logout', {});
      setChatgpt(await client.request('auth.status', {}));
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client]);

  const authRespond = useCallback(async (value: string) => {
    if (!authPrompt) return false;
    try {
      await client.request('auth.respond', { promptId: authPrompt.id, value });
      setAuthPrompt(null);
      return true;
    } catch (cause) { setError(errorMessage(cause)); return false; }
  }, [authPrompt, client]);

  const newSession = useCallback(async (options: RequestMap['sessions.create']['params'] = {}) => {
    try { return await createSession(options); }
    catch (cause) { setError(errorMessage(cause)); }
  }, [createSession]);

  const deleteSession = useCallback(async (id: string) => {
    try {
      const result = await client.request('sessions.delete', { sessionId: id });
      if (!result.deleted) return;
      setSessions((current) => current.filter((item) => item.id !== id));
      setLoaded((current) => { const next = { ...current }; delete next[id]; return next; });
      if (selectedRef.current === id) { selectedRef.current = null; setSelectedId(null); void preview(); }
    } catch (cause) { setError(errorMessage(cause)); }
  }, [client, preview]);

  const session = selectedId ? loaded[selectedId] : undefined;
  const draftEstimate = draftPreview?.sessionId === selectedId && !(selectedId && runs[selectedId]) ? draftPreview?.estimate : undefined;
  return {
    settings, hasApiKey, chatgpt, authMessage, authPrompt, authAction, authRespond, sessions, selectedId, session, ready, busy, error,
    estimate: estimates[selectedId ?? 'new'], usage: selectedId ? usages[selectedId] : null,
    running: selectedId ? !!runs[selectedId] : false, runs,
    activeTools: selectedId ? tools[selectedId] ?? [] : [],
    status: selectedId ? lastStatus[selectedId] : undefined,
    approvals, selectSession, newSession, createSession, send, cancel, saveSettings, resolveApproval, deleteSession,
    organization, models, modelsLoading, refreshModels, updateSession, createWorkspace, renameWorkspace, createCategory, selectModel, setApprovalMode,
    skills, skillsLoading, refreshSkills, draftEstimate, previewDraft, listFiles, loadSkill, saveSkill, importSkill, deleteSkill, toggleSkill, setAutoSkills,
    clearError: () => setError(null),
    retry: () => { setError(null); setRetryCount((current) => current + 1); },
  };
}
