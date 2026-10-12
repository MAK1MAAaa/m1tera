import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, BookOpen, Check, ChevronRight, FileText, Folder, ListTree, LoaderCircle, MoreHorizontal, Pencil, Pin, Plus, Terminal, Trash2, X } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ComposerDraft, DisplayMessage, ToolName } from '../shared/protocol';
import { ApprovalDialog } from './components/ApprovalDialog';
import { ApprovalPicker } from './components/ApprovalPicker';
import { BaselinePanel } from './components/BaselinePanel';
import { Composer } from './components/Composer';
import { ModelPicker } from './components/ModelPicker';
import { OrganizationDialog } from './components/OrganizationDialog';
import type { OrganizationAction } from './components/OrganizationDialog';
import { OrganizationSidebar } from './components/OrganizationSidebar';
import type { SidebarMenu } from './components/OrganizationSidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { SkillsDialog } from './components/SkillsDialog';
import { useRuntime } from './hooks/use-runtime';
import { createRuntimeClient } from './lib/runtime-client';
import type { RuntimeClient } from './lib/runtime-client';
import { TOOL_LABELS } from './lib/tools';
import { useDialogFocus } from './components/use-dialog-focus';
import './App.css';

const TOOL_ICONS = { list_directory: ListTree, read_file: FileText, write_file: FileText, run_command: Terminal };
const count = (value: number | undefined) => value === undefined ? '—' : value.toLocaleString('zh-CN');
const toolLabel = (name: string) => name === 'web_search' ? '联网搜索' : name === 'use_skill' ? '使用技能' : TOOL_LABELS[name as ToolName] ?? name;

function Message({ message, automaticallyApproved = false, onOpenURL }: { message: DisplayMessage; automaticallyApproved?: boolean; onOpenURL: (url: string) => void }) {
  if (message.role === 'tool') return <details className={`tool-card ${message.isError ? 'tool-error' : ''}`}>
    <summary>{message.isError ? <X size={14} /> : <Check size={14} />}<span>{toolLabel(message.toolName ?? '工具')}</span><span className="tool-state">{message.isError ? '失败' : automaticallyApproved ? '自动批准 · 完成' : '完成'}</span><ChevronRight size={13} className="detail-chevron" /></summary>
    <pre>{message.text}</pre>
  </details>;
  return <article className={`message message-${message.role}`}><div className="message-label">{message.role === 'user' ? '你' : 'm1tera'}</div><div className="message-body">{message.text ? message.role === 'assistant' ? <Markdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} onClick={(event) => { event.preventDefault(); if (props.href) onOpenURL(props.href); }}>{children}</a> }}>{message.text}</Markdown> : message.text : <span className="thinking"><span /><span /><span /></span>}</div>{!!message.sources?.length && <div className="message-sources" aria-label="搜索来源">{message.sources.map((source, index) => <a key={`${source.url}-${index}`} href={source.url} title={source.url} onClick={(event) => { event.preventDefault(); onOpenURL(source.url); }}><span>{index + 1}</span>{source.title || source.url}</a>)}</div>}</article>;
}

export default function App({ client: injectedClient }: { client?: RuntimeClient }) {
  const client = useMemo(() => injectedClient ?? createRuntimeClient(), [injectedClient]);
  const runtime = useRuntime(client);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const contextDialogRef = useDialogFocus<HTMLElement>(() => setContextOpen(false), undefined, contextOpen);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState(false);
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const [sessionCreating, setSessionCreating] = useState(false);
  const [composerKey, setComposerKey] = useState(0);
  const [menu, setMenu] = useState<SidebarMenu | null>(null);
  const [organizationAction, setOrganizationAction] = useState<OrganizationAction | null>(null);
  const [uiError, setUiError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [scrollAway, setScrollAway] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const preview = client.transport === 'browser';
  const activeModel = runtime.models.find((model) => model.id === runtime.settings.model && (!model.providerId || model.providerId === runtime.settings.providerId));
  const savedModel = runtime.settings.connection === 'chatgpt' ? runtime.settings.chatgptModels?.find((model) => model.id === runtime.settings.model) : runtime.settings.customProviders?.find((provider) => provider.id === runtime.settings.providerId)?.models.find((model) => model.id === runtime.settings.model);
  const managedModels = runtime.settings.connection === 'chatgpt' ? runtime.settings.chatgptModels !== undefined : runtime.settings.customProviders !== undefined;
  const modelEnabled = (!managedModels || !!savedModel?.enabled) && activeModel?.enabled !== false && activeModel?.availability !== 'unavailable';
  const localConnection = (() => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(runtime.settings.baseUrl).hostname); } catch { return false; } })();
  const configured = !!runtime.settings.model.trim() && modelEnabled && (runtime.settings.connection === 'chatgpt' ? runtime.chatgpt.connected : !!runtime.settings.baseUrl.trim() && (runtime.hasApiKey || localConnection));
  const enabledTools = runtime.session?.enabledTools ?? [];
  const approvalMode = runtime.session?.approvalMode ?? 'ask';
  const messages = runtime.session?.messages ?? [];
  const pendingTools = runtime.activeTools.filter((tool) => tool.status === 'running');
  const transientTools = runtime.activeTools.filter((tool) => !messages.some((message) => message.id === tool.id));
  const effectiveSettings = { ...runtime.settings, enabledTools, workspace: runtime.session?.workspace ?? '' };
  const sessionKey = runtime.selectedId ?? 'new';
  const messagesEnd = messages[messages.length - 1]?.text;
  const activeWorkspaceId = workspaceView ? selectedWorkspaceId : runtime.session?.workspaceId ?? null;
  const workspace = runtime.organization.workspaces.find((item) => item.id === (workspaceView ? selectedWorkspaceId : runtime.session?.workspaceId));
  const workspaceSessions = workspace ? runtime.sessions.filter((item) => item.workspaceId === workspace.id) : [];
  const controlsDisabled = runtime.running || runtime.busy || sessionCreating || !runtime.ready || preview || workspaceView;
  const estimate = runtime.draftEstimate ?? runtime.estimate;

  useEffect(() => {
    const element = scrollRef.current;
    if (element && !scrollAway) element.scrollTop = element.scrollHeight;
  }, [messages.length, messagesEnd, pendingTools.length, scrollAway, sessionKey]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') { setMenu(null); setContextOpen(false); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n' && runtime.ready && !preview) { event.preventDefault(); if (!document.querySelector('[aria-modal="true"]')) void newSession(); }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });

  async function newSession(workspaceId = activeWorkspaceId ?? undefined) {
    setScrollAway(false); setWorkspaceView(false);
    setSessionCreating(true);
    try { const created = await runtime.newSession(workspaceId ? { workspaceId } : undefined); if (created) setComposerKey((value) => value + 1); }
    finally { setSessionCreating(false); }
    document.querySelector<HTMLTextAreaElement>('textarea[name="message"]')?.focus();
  }
  async function addWorkspace() {
    setWorkspaceCreating(true); setUiError(null);
    try {
      const path = await client.chooseWorkspace();
      if (path) {
        const created = await runtime.createWorkspace(path);
        if (created) { setSelectedWorkspaceId(created.id); setWorkspaceView(true); }
      }
    } catch (cause) { setUiError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setWorkspaceCreating(false); }
  }
  function selectSession(id: string) {
    setComposerKey((value) => value + 1);
    setSelectedWorkspaceId(runtime.sessions.find((item) => item.id === id)?.workspaceId ?? null);
    setScrollAway(false); setWorkspaceView(false); void runtime.selectSession(id);
  }
  async function send(draft: ComposerDraft) {
    if (runtime.running || runtime.busy || sessionCreating || !configured || preview || !runtime.ready || workspaceView) return false;
    setScrollAway(false);
    return runtime.send(draft);
  }
  function openURL(url: string) { void client.openExternalUrl(url).catch((cause: unknown) => setUiError(cause instanceof Error ? cause.message : String(cause))); }
  function scrollToBottom() { const element = scrollRef.current; if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' }); setScrollAway(false); }

  return <div className={`app-shell ${sidebarCollapsed ? 'sidebar-is-collapsed' : ''}`}>
    <OrganizationSidebar sessions={runtime.sessions} workspaces={runtime.organization.workspaces} categories={runtime.organization.categories} selectedId={workspaceView ? null : runtime.selectedId} selectedWorkspaceId={activeWorkspaceId} runs={runtime.runs} ready={runtime.ready && !preview && !workspaceCreating && !sessionCreating} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(!sidebarCollapsed)} onSelect={selectSession} onNew={(workspaceId) => void newSession(workspaceId)} onWorkspaceSelect={(id) => { setSelectedWorkspaceId(id); setWorkspaceView(!!id); }} onAddWorkspace={() => void addWorkspace()} onMenu={setMenu} onSettings={() => setSettingsOpen(true)} />
    <main className="chat-panel">
      <header className="chat-header"><div className="header-title">{workspace && <><Folder size={14} /><span className="header-workspace">{workspace.name}</span>{!workspaceView && <ChevronRight size={13} />}</>}<h1>{workspaceView ? '工作区' : runtime.session?.title || '新会话'}</h1></div><div className="header-actions"><button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="会话设置" title="会话设置"><MoreHorizontal size={18} /></button></div></header>
      {preview && <div className="preview-banner">浏览器预览 · Agent 仅在桌面应用中运行</div>}
      {(runtime.error || uiError) && <div className="error-banner" role="alert"><span>{uiError || runtime.error}</span>{!runtime.ready && !preview && <button className="retry-button" onClick={runtime.retry}>重新连接</button>}<button onClick={() => { runtime.clearError(); setUiError(null); }} aria-label="关闭错误提示"><X size={16} /></button></div>}
      <div className="chat-scroll" key={sessionKey} ref={scrollRef} onScroll={() => { const element = scrollRef.current; if (element) setScrollAway(element.scrollHeight - element.scrollTop - element.clientHeight > 100); }}>
        {workspaceView && workspace ? <div className="workspace-overview"><div className="workspace-heading"><div className="workspace-symbol"><Folder size={24} /></div><h2>{workspace.name}</h2><p title={workspace.path}>{workspace.path}</p><button className="primary-button" onClick={() => void newSession(workspace.id)} disabled={!runtime.ready || preview}><Plus size={15} />在工作区新建会话</button></div><div className="workspace-conversations"><h3>会话<span>{workspaceSessions.length}</span></h3>{workspaceSessions.length ? workspaceSessions.map((item) => <button key={item.id} onClick={() => selectSession(item.id)} className="workspace-conversation"><span>{item.title}</span><small>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</small><ChevronRight size={14} /></button>) : <p className="helper">还没有会话。</p>}</div></div> : messages.length === 0 ? <div className="empty-chat"><div className="empty-greeting">有什么可以帮你？</div><p>{workspace ? `在 ${workspace.name} 中开始工作。` : '开始一个问题，或选择工作区处理任务。'}</p>{!configured && <button className="empty-config" onClick={() => setSettingsOpen(true)}>连接模型<ChevronRight size={13} /></button>}</div> : <div className="messages">{messages.map((message) => <Message key={message.id} message={message} onOpenURL={openURL} automaticallyApproved={runtime.activeTools.some((tool) => tool.id === message.id && tool.automaticallyApproved)} />)}{transientTools.map((tool) => <div key={tool.id} className={`tool-card ${tool.status === 'running' ? 'running-tool' : tool.status === 'error' ? 'tool-error' : ''}`} title={tool.text}><div className="running-tool-header">{tool.status === 'running' ? <LoaderCircle size={14} className="spin" /> : tool.status === 'error' ? <X size={14} /> : <Check size={14} />}<span>{toolLabel(tool.name)}</span><span className="tool-state">{tool.status === 'running' ? tool.automaticallyApproved ? '自动批准 · 执行中' : '执行中' : tool.status === 'error' ? tool.text === '已停止' ? '已停止' : '失败' : '完成'}</span></div></div>)}{runtime.running && messages[messages.length - 1]?.role !== 'assistant' && <div className="runtime-working"><LoaderCircle size={13} className="spin" />正在处理</div>}</div>}
      </div>
      {!workspaceView && <>{scrollAway && <button className="scroll-bottom" onClick={scrollToBottom} aria-label="滚动到最新消息"><ArrowDown size={16} /></button>}<Composer key={composerKey} estimate={estimate} disabled={preview || !runtime.ready || sessionCreating} canSend={configured && runtime.ready && !preview && !sessionCreating} running={runtime.running} busy={runtime.busy} placeholder={preview ? '桌面应用中开始对话…' : configured ? '发送消息，/ 命令、@ 文件、$ Skills' : '连接模型后开始对话…'} skills={runtime.skills} skillsLoading={runtime.skillsLoading} hasWorkspace={!!runtime.session?.workspace} onFiles={runtime.listFiles} onSend={send} onDraft={runtime.previewDraft} onCancel={runtime.cancel} onNew={() => newSession()} onSkills={() => setSkillsOpen(true)} onContext={() => setContextOpen(true)} controls={<><button type="button" className="composer-control tools-control" onClick={() => setSettingsOpen(true)} aria-label="管理会话工具" title="管理会话工具"><Plus size={17} /><span>{enabledTools.length ? `${enabledTools.length} 个工具` : '工具'}</span></button><button type="button" className="composer-control skills-control" onClick={() => setSkillsOpen(true)} aria-label="管理 Skills" title="管理 Skills"><BookOpen size={15} /></button><span className="control-divider" /><ModelPicker models={runtime.models} model={runtime.settings.model} currentProviderId={runtime.settings.providerId} compatible={runtime.settings.connection === 'compatible'} loading={runtime.modelsLoading} disabled={controlsDisabled} onSelect={runtime.selectModel} onRefresh={runtime.refreshModels} /><ApprovalPicker mode={approvalMode} disabled={controlsDisabled || !runtime.session} onSelect={runtime.setApprovalMode} /></>} /></>}
      {contextOpen && <button className="context-backdrop" aria-label="关闭上下文面板" onClick={() => setContextOpen(false)} />}
      <aside ref={contextDialogRef} className="context-panel" hidden={!contextOpen} role="dialog" aria-modal={contextOpen || undefined} aria-label="上下文详情"><header className="context-header"><h2>上下文</h2><button className="icon-button" onClick={() => setContextOpen(false)} aria-label="关闭上下文"><X size={17} /></button></header><div className="context-scroll"><section className="context-section"><div className="section-heading">预计输入<span>本地估算</span></div><div className="token-total">{count(estimate?.total)}<span>tokens</span></div><div className="context-limit">当前可用上限<span>{estimate?.contextWindow ? `${count(estimate.contextWindow)} tokens` : '未知'}</span></div><div className="token-bar"><span style={{ width: estimate?.total ? `${estimate.system / estimate.total * 100}%` : '33%' }} /><span style={{ width: estimate?.total ? `${estimate.tools / estimate.total * 100}%` : '0%' }} /><span style={{ flex: 1 }} /></div><dl className="token-breakdown"><div><dt><i className="legend-system" />系统提示词</dt><dd>{count(estimate?.system)}</dd></div>{!!estimate?.selectedSkills && <div className="breakdown-subrow"><dt>其中 Skills · {estimate.selectedSkills}</dt><dd>{count(estimate.skillTokens)}</dd></div>}<div><dt><i className="legend-tools" />工具定义</dt><dd>{count(estimate?.tools)}</dd></div><div><dt><i className="legend-history" />消息与历史</dt><dd>{count(estimate?.history)}</dd></div>{!!estimate?.attachments && <div className="breakdown-subrow"><dt>其中文件 · {estimate.attachments}</dt><dd>{count(estimate.attachmentTokens)}</dd></div>}</dl><p className="panel-note">本地估算，与服务商计数可能不同。</p></section><section className="context-section"><div className="section-heading">本次首轮实际输入<span>服务商 usage</span></div><div className={`usage-total ${runtime.usage ? '' : 'usage-unknown'}`}>{runtime.usage ? count(runtime.usage.totalInput) : '未知'}{runtime.usage && <span>tokens</span>}</div>{runtime.usage ? <dl className="token-breakdown"><div><dt>未缓存输入</dt><dd>{count(runtime.usage.input)}</dd></div><div><dt>缓存读取</dt><dd>{count(runtime.usage.cacheRead)}</dd></div><div><dt>缓存写入</dt><dd>{count(runtime.usage.cacheWrite)}</dd></div><div><dt>输出</dt><dd>{count(runtime.usage.output)}</dd></div></dl> : <p className="panel-note">尚未获得服务商 usage。</p>}</section><section className="context-section tools-section"><div className="section-heading">已启用工具<span>{enabledTools.length}</span></div>{enabledTools.length ? <div className="enabled-tools">{enabledTools.map((name) => { const Icon = TOOL_ICONS[name]; return <div key={name}><Icon size={14} /><span>{TOOL_LABELS[name]}</span></div>; })}</div> : <p className="panel-note">未启用工具</p>}<button className="manage-tools" onClick={() => setSettingsOpen(true)}>管理会话工具<ChevronRight size={13} /></button></section><BaselinePanel client={client} connected={configured} ready={runtime.ready} /></div></aside>
    </main>
    {menu && <><button className="menu-dismiss" aria-label="关闭操作菜单" onClick={() => setMenu(null)} /><div className="sidebar-menu" role="menu" style={{ left: Math.min(menu.x, window.innerWidth - 226), top: Math.max(12, Math.min(menu.y, window.innerHeight - (menu.kind === 'session' ? 214 : 100))) }}>{menu.kind === 'session' ? <><button role="menuitem" onClick={() => { void runtime.updateSession(menu.item.id, { pinned: !menu.item.pinned }); setMenu(null); }}><Pin size={14} />{menu.item.pinned ? '取消置顶' : '置顶'}</button><button role="menuitem" onClick={() => { setOrganizationAction({ kind: 'rename', session: menu.item }); setMenu(null); }}><Pencil size={14} />重命名会话</button><button role="menuitem" onClick={() => { setOrganizationAction({ kind: 'category', session: menu.item }); setMenu(null); }}><ListTree size={14} />分类</button><button role="menuitem" disabled={!!runtime.runs[menu.item.id]} onClick={() => { setOrganizationAction({ kind: 'move', session: menu.item }); setMenu(null); }}><Folder size={14} />移动到工作区</button><div className="menu-divider" /><button role="menuitem" className="menu-danger" disabled={!!runtime.runs[menu.item.id]} onClick={() => { setDeletingId(menu.item.id); setMenu(null); }}><Trash2 size={14} />删除会话</button></> : <><button role="menuitem" onClick={() => { void newSession(menu.item.id); setMenu(null); }}><Plus size={14} />新建会话</button><button role="menuitem" onClick={() => { setOrganizationAction({ kind: 'workspace-rename', workspace: menu.item }); setMenu(null); }}><Pencil size={14} />重命名工作区</button></>}</div></>}
    {organizationAction && <OrganizationDialog key={`${organizationAction.kind}-${'session' in organizationAction ? organizationAction.session.id : organizationAction.workspace.id}`} action={organizationAction} categories={runtime.organization.categories} workspaces={runtime.organization.workspaces} onSessionUpdate={runtime.updateSession} onCreateCategory={runtime.createCategory} onWorkspaceRename={runtime.renameWorkspace} error={runtime.error} onClose={() => setOrganizationAction(null)} />}
    {settingsOpen && <SettingsDialog key={sessionKey} settings={effectiveSettings} approvalMode={approvalMode} hasApiKey={runtime.hasApiKey} models={runtime.models} modelsLoading={runtime.modelsLoading} providerStatus={runtime.providerStatus} onRefreshModels={runtime.refreshModels} hasSession={!!runtime.session} chatgpt={runtime.chatgpt} authMessage={runtime.authMessage} runtimeError={runtime.error} onAuth={runtime.authAction} client={client} onSave={runtime.saveSettings} onClose={() => setSettingsOpen(false)} />}
    {skillsOpen && <SkillsDialog skills={runtime.skills} loading={runtime.skillsLoading} autoSkills={runtime.session?.autoSkills ?? false} canConfigureAuto={runtime.ready && !preview && !runtime.running} disabled={preview || !runtime.ready || runtime.running} error={runtime.error} client={client} onLoad={runtime.loadSkill} onSave={runtime.saveSkill} onImport={runtime.importSkill} onDelete={runtime.deleteSkill} onToggle={runtime.toggleSkill} onAuto={runtime.setAutoSkills} onRefresh={runtime.refreshSkills} onClose={() => setSkillsOpen(false)} />}
    {runtime.authPrompt && <AuthPrompt key={runtime.authPrompt.id} message={runtime.authPrompt.message} placeholder={runtime.authPrompt.placeholder} onSubmit={runtime.authRespond} onCancel={() => runtime.authAction('cancel')} />}
    {runtime.approvals[0] && <ApprovalDialog key={runtime.approvals[0].id} approval={runtime.approvals[0]} count={runtime.approvals.length} onResolve={runtime.resolveApproval} />}
    {deletingId && <DeleteSessionDialog sessionId={deletingId} onDelete={() => { void runtime.deleteSession(deletingId); setDeletingId(null); }} onClose={() => setDeletingId(null)} />}
  </div>;
}

function AuthPrompt({ message, placeholder, onSubmit, onCancel }: { message: string; placeholder?: string; onSubmit: (value: string) => Promise<boolean>; onCancel: () => Promise<void> }) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!submitting) void onCancel(); });
  return <div className="modal-backdrop auth-backdrop"><section ref={dialogRef} tabIndex={-1} className="approval-dialog auth-prompt" role="dialog" aria-modal="true" aria-labelledby="auth-prompt-title"><h2 id="auth-prompt-title">完成 ChatGPT 授权</h2><p className="helper">{message}</p><form onSubmit={(event) => { event.preventDefault(); if (!value.trim()) return; setSubmitting(true); void onSubmit(value.trim()).then((success) => { if (success) setValue(''); }).finally(() => setSubmitting(false)); }}><label className="field">浏览器回调地址<input data-dialog-autofocus name="authCallback" type="password" autoComplete="off" placeholder={placeholder || '粘贴完整回调地址'} value={value} onChange={(event) => setValue(event.target.value)} /></label><div className="approval-actions"><button type="button" className="secondary-button" onClick={() => void onCancel()}>取消登录</button><button type="submit" className="primary-button" disabled={submitting || !value.trim()}>{submitting ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}完成授权</button></div></form></section></div>;
}

function DeleteSessionDialog({ sessionId, onDelete, onClose }: { sessionId: string; onDelete: () => void; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose, () => document.querySelector<HTMLElement>(`[data-session-id="${CSS.escape(sessionId)}"] .session-more`));
  return <div className="modal-backdrop"><section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><h2 id="delete-title">删除这个会话？</h2><p>本地保存的消息也会一并删除，此操作无法撤销。</p><div className="approval-actions"><button data-dialog-autofocus className="secondary-button" onClick={onClose}>取消</button><button className="danger-button" onClick={onDelete}>删除会话</button></div></section></div>;
}
