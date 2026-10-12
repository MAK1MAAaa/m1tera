import { useState } from 'react';
import { Check, FolderOpen, KeyRound, LoaderCircle, X } from 'lucide-react';
import { TOOL_NAMES } from '../../shared/protocol';
import type { ApprovalMode, AuthStatus, Settings, ToolName } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';
import { TOOL_LABELS } from '../lib/tools';
import { useDialogFocus } from './use-dialog-focus';
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_directory: '查看工作区目录结构', read_file: '读取工作区内的文件',
  write_file: '写入工作区内的文件', run_command: '执行本地终端命令',
};

interface Props {
  settings: Settings;
  approvalMode: ApprovalMode;
  hasApiKey: boolean;
  hasSession: boolean;
  chatgpt: AuthStatus;
  authMessage: string | null;
  runtimeError: string | null;
  onAuth: (action: 'login' | 'cancel' | 'logout') => Promise<void>;
  client: RuntimeClient;
  onSave: (settings: Settings, apiKey?: string, approvalMode?: ApprovalMode) => Promise<boolean>;
  onClose: () => void;
}

export function SettingsDialog({ settings, approvalMode, hasApiKey, hasSession, chatgpt, authMessage, runtimeError, onAuth, client, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>({ ...settings, enabledTools: [...settings.enabledTools] });
  const [apiKey, setApiKey] = useState('');
  const [draftApprovalMode, setDraftApprovalMode] = useState<ApprovalMode>(approvalMode);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!saving) onClose(); });
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setValidation(null);
    if (draft.connection === 'compatible') try {
      const url = new URL(draft.baseUrl.trim());
      if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { setValidation('请输入有效的 HTTP 或 HTTPS 接口地址，地址不能包含凭据。'); return; }
    if (!draft.model.trim()) { setValidation('请输入模型名称。'); return; }
    if (draft.enabledTools.length && !draft.workspace.trim()) { setValidation('启用工具前，请选择工作区目录。'); return; }
    setSaving(true);
    const success = await onSave({ ...draft, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), apiFormat: draft.model.trim() === 'gpt-6.1-sol' ? 'responses' : draft.apiFormat, workspace: draft.workspace.trim() }, clearKey ? '' : apiKey.trim() || undefined, draftApprovalMode);
    setSaving(false);
    if (success) { setApiKey(''); onClose(); }
  }
  async function chooseDirectory() {
    try {
      const path = await client.chooseWorkspace();
      if (path) update('workspace', path);
    } catch (error) { setValidation(error instanceof Error ? error.message : String(error)); }
  }
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <header className="dialog-header">
        <h2 id="settings-title">设置</h2>
        <button className="icon-button" onClick={onClose} type="button" aria-label="关闭设置" disabled={saving}><X size={19} /></button>
      </header>
      <form onSubmit={(event) => void save(event)}>
        <div className="settings-scroll">
          <div className="settings-section-heading">模型连接<span>对所有会话生效</span></div>
          <label className="field">连接方式<select data-dialog-autofocus name="connection" value={draft.connection} onChange={(event) => update('connection', event.target.value as Settings['connection'])}><option value="chatgpt">ChatGPT 账号</option><option value="compatible">OpenAI 兼容接口</option></select></label>
          {draft.connection === 'chatgpt' ? <div className="chatgpt-connection">
            <div><strong>{chatgpt.connected ? 'ChatGPT 已连接' : chatgpt.loginPending ? '正在连接 ChatGPT' : '使用你的 ChatGPT 账号'}</strong><p>{authMessage || '通过官方浏览器授权连接，无需填写 API Key。'}</p></div>
            <button type="button" className={chatgpt.connected || chatgpt.loginPending ? 'secondary-button' : 'primary-button'} disabled={client.transport === 'browser'} onClick={() => void onAuth(chatgpt.connected ? 'logout' : chatgpt.loginPending ? 'cancel' : 'login')}>{chatgpt.connected ? '注销' : chatgpt.loginPending ? '取消登录' : 'Continue with ChatGPT'}</button>
          </div> : <>
          <label className="field">接口地址<input name="baseUrl" type="url" placeholder="https://api.openai.com/v1" value={draft.baseUrl} onChange={(event) => update('baseUrl', event.target.value)} /></label>
          <label className="field">API 格式<select name="apiFormat" value={draft.model.trim() === 'gpt-6.1-sol' ? 'responses' : draft.apiFormat} disabled={draft.model.trim() === 'gpt-6.1-sol'} onChange={(event) => update('apiFormat', event.target.value as Settings['apiFormat'])}><option value="responses">Responses API</option><option value="chat-completions">Chat Completions API</option></select></label>
          <label className="field">API Key<span className="field-note"><KeyRound size={12} />{hasApiKey ? '后端内存已配置，留空则保留' : '仅保存在后端运行内存'} </span>
            <input name="apiKey" type="password" autoComplete="off" placeholder="输入密钥" value={apiKey} disabled={clearKey} onChange={(event) => setApiKey(event.target.value)} />
          </label>
          {hasApiKey && <label className="compact-checkbox"><input type="checkbox" checked={clearKey} onChange={(event) => setClearKey(event.target.checked)} />清除当前密钥</label>}
          </>}
          <label className="field">模型名称<input name="model" placeholder="gpt-6.1-sol" value={draft.model} onChange={(event) => { update('model', event.target.value); update('contextWindow', undefined); if (event.target.value.trim() === 'gpt-6.1-sol') update('apiFormat', 'responses'); }} /></label>
          {draft.connection === 'compatible' && <label className="field">上下文上限（可选）<input name="contextWindow" type="number" min={128} step={1} placeholder="使用模型目录值；未知时留空" value={draft.contextWindow ?? ''} onChange={(event) => update('contextWindow', event.target.value ? Number(event.target.value) : undefined)} /></label>}
          <div className="settings-divider" />
          <div className="settings-section-heading">系统提示词</div>
          <label className="field"><span className="sr-only">系统提示词</span><textarea name="systemPrompt" rows={4} value={draft.systemPrompt} onChange={(event) => update('systemPrompt', event.target.value)} /></label>
          <div className="settings-divider" />
          <div className="settings-section-heading">当前会话的工具<span>下次发送生效</span></div>
          {!hasSession && <p className="helper">请先新建会话，再启用工具。</p>}
          <label className="field">工作区目录<div className="input-with-button"><input name="workspace" disabled={!hasSession} placeholder="选择可访问的目录" value={draft.workspace} onChange={(event) => update('workspace', event.target.value)} /><button type="button" className="secondary-button" onClick={() => void chooseDirectory()} disabled={!hasSession || client.transport === 'browser'} aria-label="选择工作区目录"><FolderOpen size={17} /></button></div></label>
          <div className="tool-options">{TOOL_NAMES.map((name) => <label className={`tool-option ${draft.enabledTools.includes(name) ? 'selected' : ''}`} key={name}>
            <input type="checkbox" name={name} checked={draft.enabledTools.includes(name)} disabled={!hasSession} onChange={(event) => update('enabledTools', event.target.checked ? [...draft.enabledTools, name] : draft.enabledTools.filter((item) => item !== name))} />
            <span><strong>{TOOL_LABELS[name]}</strong><small>{TOOL_DESCRIPTIONS[name]}</small></span>
          </label>)}</div>
          <label className="field">工具审批<select name="approvalMode" value={draftApprovalMode} onChange={(event) => setDraftApprovalMode(event.target.value as ApprovalMode)} disabled={!hasSession}><option value="ask">逐次审批</option><option value="auto">自动审批</option></select></label><p className="helper">{draftApprovalMode === 'auto' ? '已启用工具的写入和命令会自动批准；此设置不会启用工具。' : '写入文件和执行命令前，请求你的批准。'} 文件访问限制在工作区内，命令以当前用户权限执行，可访问工作区以外的系统资源。</p>
          {validation && <p className="inline-error" role="alert">{validation}</p>}
          {runtimeError && <p className="inline-error" role="alert">{runtimeError}</p>}
          {client.transport === 'browser' && <p className="preview-note">浏览器仅预览设置，配置需在桌面应用中保存。</p>}
        </div>
        <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary-button" type="submit" disabled={saving || client.transport === 'browser'}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存设置</button></footer>
      </form>
    </section>
  </div>;
}
