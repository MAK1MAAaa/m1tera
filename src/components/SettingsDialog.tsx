import { useState } from 'react';
import { Check, FolderOpen, LoaderCircle, X } from 'lucide-react';
import { TOOL_NAMES } from '../../shared/protocol';
import type { ApprovalMode, AuthStatus, ConfiguredModel, CustomProvider, ModelOption, ProviderStatus, Settings, ToolName } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';
import { TOOL_LABELS } from '../lib/tools';
import { useDialogFocus } from './use-dialog-focus';
import { ModelSettings } from './ModelSettings';
const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  list_directory: '查看工作区目录结构', read_file: '读取工作区内的文件',
  write_file: '写入工作区内的文件', run_command: '执行本地终端命令',
};

interface Props {
  settings: Settings;
  approvalMode: ApprovalMode;
  hasApiKey: boolean;
  models: ModelOption[];
  modelsLoading: boolean;
  providerStatus: ProviderStatus[];
  hasSession: boolean;
  chatgpt: AuthStatus;
  authMessage: string | null;
  runtimeError: string | null;
  onAuth: (action: 'login' | 'cancel' | 'logout') => Promise<void>;
  client: RuntimeClient;
  onRefreshModels: () => Promise<void>;
  onSave: (settings: Settings, apiKey?: string, approvalMode?: ApprovalMode, providerApiKeys?: Record<string, string>) => Promise<boolean>;
  onClose: () => void;
}

function initialDraft(settings: Settings, models: ModelOption[]): Settings {
  const providerId = settings.providerId ?? (settings.connection === 'chatgpt' ? 'chatgpt' : 'custom-default');
  const cloneModels = (configured: ConfiguredModel[], id: string) => configured.map((model) => ({ ...model, enabled: model.enabled && !models.some((option) => (option.providerId ?? 'chatgpt') === id && option.id === model.id && option.availability === 'unavailable') }));
  const legacyProvider: CustomProvider = { id: providerId, name: '自定义接口', baseUrl: settings.baseUrl, apiFormat: settings.apiFormat, models: [{ id: settings.model, enabled: true, contextWindow: settings.contextWindow, source: 'manual' }] };
  const providers = settings.customProviders ?? (settings.connection === 'compatible' ? [legacyProvider] : []);
  return { ...settings, providerId, enabledTools: [...settings.enabledTools], chatgptModels: cloneModels(settings.chatgptModels ?? [{ id: settings.connection === 'chatgpt' ? settings.model : 'gpt-6.1-sol', enabled: true, source: 'endpoint' }], 'chatgpt'), customProviders: providers.map((provider) => ({ ...provider, models: cloneModels(provider.models, provider.id) })) };
}

export function SettingsDialog({ settings, approvalMode, hasApiKey, models, modelsLoading, providerStatus, hasSession, chatgpt, authMessage, runtimeError, onAuth, client, onRefreshModels, onSave, onClose }: Props) {
  const [draft, setDraft] = useState<Settings>(() => initialDraft(settings, models));
  const [originalProviders] = useState<CustomProvider[]>(() => initialDraft(settings, models).customProviders ?? []);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [draftApprovalMode, setDraftApprovalMode] = useState<ApprovalMode>(approvalMode);
  const [saving, setSaving] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!saving) onClose(); });
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setValidation(null);
    if (manualPending) { setValidation('请先添加或保存正在编辑的模型，或取消该编辑。'); return; }
    for (const provider of draft.customProviders ?? []) {
      if (!provider.name.trim()) { setValidation('请输入每个自定义接口的名称。'); return; }
      try {
        const url = new URL(provider.baseUrl.trim());
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { setValidation(`“${provider.name}”需要有效的 HTTP 或 HTTPS 接口地址，地址不能包含凭据。`); return; }
    }
    const configuredModels = [...(draft.chatgptModels ?? []), ...(draft.customProviders ?? []).flatMap((provider) => provider.models)];
    if (configuredModels.some((model) => !model.id.trim())) { setValidation('模型 ID 不能为空。'); return; }
    if (configuredModels.some((model) => model.contextWindow !== undefined && (!Number.isSafeInteger(model.contextWindow) || model.contextWindow < 128))) { setValidation('上下文上限应为不小于 128 的整数。'); return; }
    if (draft.enabledTools.length && !draft.workspace.trim()) { setValidation('启用工具前，请选择工作区目录。'); return; }
    setSaving(true);
    try {
      const cleanModels = (configured: ConfiguredModel[], providerId: string, useCatalog = true) => configured.map((model) => ({ ...model, id: model.id.trim(), name: model.name?.trim() || undefined, enabled: model.enabled && !(useCatalog && models.some((option) => (option.providerId ?? 'chatgpt') === providerId && option.id === model.id && option.availability === 'unavailable')) }));
      const customProviders = (draft.customProviders ?? []).map((provider) => ({ ...provider, name: provider.name.trim(), baseUrl: provider.baseUrl.trim(), models: cleanModels(provider.models, provider.id, !originalProviders.some((original) => original.id === provider.id && original.baseUrl.trim() !== provider.baseUrl.trim())) }));
      const chatgptModels = cleanModels(draft.chatgptModels ?? [], 'chatgpt');
      const selectedProvider = customProviders.find((provider) => provider.id === draft.providerId);
      const selectedModel = (draft.providerId === 'chatgpt' ? chatgptModels : selectedProvider?.models)?.find((model) => model.id === draft.model.trim());
      const next = { ...draft, model: draft.model.trim(), workspace: draft.workspace.trim(), chatgptModels, customProviders, ...(selectedProvider ? { connection: 'compatible' as const, baseUrl: selectedProvider.baseUrl, apiFormat: selectedProvider.apiFormat, contextWindow: selectedModel?.contextWindow } : draft.providerId === 'chatgpt' ? { connection: 'chatgpt' as const, apiFormat: 'responses' as const, contextWindow: selectedModel?.contextWindow } : {}) };
      const success = await onSave(next, undefined, draftApprovalMode, Object.fromEntries(Object.entries(apiKeys).map(([id, key]) => [id, key.trim()])));
      if (success) { setApiKeys({}); onClose(); }
    } catch (error) { setValidation(error instanceof Error ? error.message : String(error)); }
    finally { setSaving(false); }
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
          <ModelSettings draft={draft} setDraft={setDraft} apiKeys={apiKeys} setApiKeys={setApiKeys} originalProviders={originalProviders} models={models} modelsLoading={modelsLoading} providerStatus={providerStatus.length ? providerStatus : hasApiKey && draft.connection === 'compatible' ? [{ id: draft.providerId ?? 'custom-default', hasApiKey: true }] : []} chatgpt={chatgpt} authMessage={authMessage} client={client} disabled={saving} onAuth={onAuth} onRefreshModels={onRefreshModels} onDiscoveringChange={setDiscovering} onManualDraftChange={setManualPending} />
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
          {runtimeError && <p className="inline-error" role="alert">{runtimeError}</p>}
          {client.transport === 'browser' && <p className="preview-note">浏览器仅预览设置，配置需在桌面应用中保存。</p>}
        </div>
        {validation && <div className="settings-validation"><p className="inline-error" role="alert">{validation}</p></div>}
        <footer className="dialog-footer"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary-button" type="submit" disabled={saving || discovering || client.transport === 'browser'}>{saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}保存设置</button></footer>
      </form>
    </section>
  </div>;
}
