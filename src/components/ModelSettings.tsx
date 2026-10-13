import { useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { ChevronDown, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { AuthStatus, ConfiguredModel, CustomProvider, ModelCatalog, ModelOption, ProviderStatus, Settings } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';
import { useDialogFocus } from './use-dialog-focus';

interface Props {
  draft: Settings;
  setDraft: Dispatch<SetStateAction<Settings>>;
  apiKeys: Record<string, string>;
  setApiKeys: Dispatch<SetStateAction<Record<string, string>>>;
  originalProviders: CustomProvider[];
  models: ModelOption[];
  modelsLoading: boolean;
  providerStatus: ProviderStatus[];
  chatgpt: AuthStatus;
  authMessage: string | null;
  client: RuntimeClient;
  disabled: boolean;
  onAuth: (action: 'login' | 'cancel' | 'logout') => Promise<void>;
  onRefreshModels: () => Promise<void>;
  onDiscoveringChange: (pending: boolean) => void;
  onManualDraftChange: (pending: boolean) => void;
}

interface ManualDraft { editingId?: string; id: string; name: string; contextWindow: string }
const newManualDraft = (): ManualDraft => ({ id: '', name: '', contextWindow: '' });
const modelProvider = (option: ModelOption) => option.providerId ?? 'chatgpt';

function mergeCatalog(providerId: string, configured: ConfiguredModel[], catalog: ModelCatalog): ConfiguredModel[] {
  const options = new Map(catalog.models.map((option) => [option.id, option]));
  const existing = configured.map((model) => {
    const option = options.get(model.id);
    const missingEndpoint = catalog.complete !== false && (providerId === 'chatgpt' || model.source !== 'manual') && !option;
    return {
      ...model,
      enabled: missingEndpoint || option?.availability === 'unavailable' ? false : model.enabled,
    };
  });
  return existing;
}

function rowsForProvider(providerId: string, configured: ConfiguredModel[], options: ModelOption[], catalog?: ModelCatalog): ModelOption[] {
  const directory = catalog ? catalog.models : options.filter((option) => modelProvider(option) === providerId);
  const known = new Map(directory.map((option) => [option.id, option]));
  const rows = configured.map((model): ModelOption => {
    const option = known.get(model.id);
    const missingEndpoint = catalog?.fetched && catalog.complete !== false && (providerId === 'chatgpt' || model.source !== 'manual') && !option;
    const unavailable = missingEndpoint || option?.availability === 'unavailable';
    return {
      ...option,
      id: model.id,
      name: model.name || option?.name || model.id,
      contextWindow: model.contextWindow ?? option?.contextWindow,
      providerId,
      source: model.source === 'manual' ? 'configured' : option?.source ?? 'endpoint',
      enabled: model.enabled && !unavailable,
      availability: unavailable ? 'unavailable' : providerId !== 'chatgpt' && model.source === 'manual' ? 'unverified' : option?.availability ?? 'unverified',
      unavailableReason: missingEndpoint ? '最新目录已移除此模型' : option?.unavailableReason,
    };
  });
  const configuredRows = new Map(rows.map((row) => [row.id, row]));
  const directoryIds = new Set(directory.map((option) => option.id));
  return [...directory.map((option) => configuredRows.get(option.id) ?? { ...option, providerId, enabled: false, availability: option.availability ?? (catalog?.fetched ? 'available' as const : 'unverified' as const) }), ...rows.filter((row) => !directoryIds.has(row.id))];
}

export function ModelSettings({ draft, setDraft, apiKeys, setApiKeys, originalProviders, models, modelsLoading, providerStatus, chatgpt, authMessage, client, disabled, onAuth, onRefreshModels, onDiscoveringChange, onManualDraftChange }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Record<string, ModelCatalog>>({});
  const [warnings, setWarnings] = useState<Record<string, string | undefined>>({});
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [manualDrafts, setManualDrafts] = useState<Record<string, ManualDraft>>({});
  const [manualErrors, setManualErrors] = useState<Record<string, string | undefined>>({});
  const [removeProvider, setRemoveProvider] = useState<CustomProvider | null>(null);
  const providers = draft.customProviders ?? [];
  const busy = disabled || discoveringId !== null;
  const browser = client.transport === 'browser';
  const optionsForProvider = (provider: CustomProvider) => originalProviders.some((original) => original.id === provider.id && original.baseUrl.trim() !== provider.baseUrl.trim()) ? [] : models;
  const officialInventory = chatgpt.connected ? models : models.filter((model) => modelProvider(model) === 'chatgpt' && model.id === 'gpt-6.1-sol').map((model) => ({ ...model, availability: 'unverified' as const, unavailableReason: undefined }));
  const official = rowsForProvider('chatgpt', draft.chatgptModels ?? [], officialInventory, chatgpt.connected ? catalogs.chatgpt : undefined);
  const currentProviderId = draft.providerId ?? (draft.connection === 'chatgpt' ? 'chatgpt' : 'custom-default');
  const currentProvider = providers.find((provider) => provider.id === currentProviderId);
  const currentRows = currentProviderId === 'chatgpt' ? official : currentProvider ? rowsForProvider(currentProvider.id, currentProvider.models, optionsForProvider(currentProvider), catalogs[currentProvider.id]) : [];
  const currentModel = currentRows.find((model) => model.id === draft.model);
  const currentUsable = currentModel?.enabled && currentModel.availability !== 'unavailable';

  function updateProvider(id: string, patch: Partial<CustomProvider>) {
    const connectionChanged = patch.baseUrl !== undefined || patch.apiFormat !== undefined;
    if (connectionChanged) {
      if (patch.baseUrl !== undefined) setApiKeys((current) => { const next = { ...current }; delete next[id]; return next; });
      setCatalogs((current) => { const next = { ...current }; delete next[id]; return next; });
      setWarnings((current) => ({ ...current, [id]: undefined }));
    }
    setDraft((current) => ({ ...current, customProviders: current.customProviders?.map((provider) => provider.id === id ? { ...provider, ...patch } : provider) }));
  }

  function toggleModel(providerId: string, option: ModelOption, enabled: boolean) {
    const configured = providerId === 'chatgpt' ? draft.chatgptModels ?? [] : providers.find((provider) => provider.id === providerId)?.models ?? [];
    if (!configured.some((model) => model.id === option.id) && configured.length >= 256) {
      setWarnings((current) => ({ ...current, [providerId]: '每个接口最多配置 256 个模型，请先移除不再需要的模型。' }));
      return;
    }
    const updateModels = (configured: ConfiguredModel[]) => {
      const found = configured.some((model) => model.id === option.id);
      return found ? configured.map((model) => model.id === option.id ? { ...model, enabled } : model) : [...configured, {
        id: option.id, enabled, source: 'endpoint' as const,
      }];
    };
    setDraft((current) => providerId === 'chatgpt' ? { ...current, chatgptModels: updateModels(current.chatgptModels ?? []) } : {
      ...current, customProviders: current.customProviders?.map((provider) => provider.id === providerId ? { ...provider, models: updateModels(provider.models) } : provider),
    });
  }

  function addProvider() {
    const id = `custom-${crypto.randomUUID()}`;
    setDraft((current) => ({ ...current, customProviders: [...(current.customProviders ?? []), { id, name: `自定义接口 ${providers.length + 1}`, baseUrl: '', apiFormat: 'responses', models: [] }] }));
    setExpandedId(id);
  }

  function changeAccount() {
    setCatalogs((current) => { const next = { ...current }; delete next.chatgpt; return next; });
    setWarnings((current) => ({ ...current, chatgpt: undefined }));
    void onAuth(chatgpt.connected ? 'logout' : chatgpt.loginPending ? 'cancel' : 'login');
  }

  async function discover(providerId: string) {
    const provider = providers.find((item) => item.id === providerId);
    if (provider) {
      try {
        const url = new URL(provider.baseUrl.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      } catch { setWarnings((current) => ({ ...current, [providerId]: '请输入有效的 HTTP 或 HTTPS 接口地址，地址不能包含凭据。' })); return; }
    }
    setDiscoveringId(providerId);
    onDiscoveringChange(true);
    setWarnings((current) => ({ ...current, [providerId]: undefined }));
    try {
      const original = originalProviders.find((item) => item.id === providerId);
      const connectionChanged = !!provider && !!original && original.baseUrl.trim() !== provider.baseUrl.trim();
      const key = apiKeys[providerId];
      const catalog = await client.request('models.discover', {
        providerId, ...(provider ? { baseUrl: provider.baseUrl.trim(), ...(key !== undefined ? { apiKey: key.trim() } : connectionChanged ? { apiKey: '' } : {}) } : {}),
      });
      setWarnings((current) => ({ ...current, [providerId]: catalog.warning || (!catalog.fetched ? '未能取得模型目录，现有配置已保留。可手动添加模型。' : undefined) }));
      // Preserve metadata and unavailable decisions, but revoke verification on a failed refresh.
      if (catalog.fetched) {
        setCatalogs((current) => ({ ...current, [providerId]: catalog }));
        setDraft((current) => providerId === 'chatgpt' ? { ...current, chatgptModels: mergeCatalog(providerId, current.chatgptModels ?? [], catalog) } : {
          ...current, customProviders: current.customProviders?.map((item) => item.id === providerId ? { ...item, models: mergeCatalog(providerId, item.models, catalog) } : item),
        });
        await onRefreshModels();
      } else demoteCatalog(providerId, catalog);
    } catch (error) {
      const warning = `${error instanceof Error ? error.message : String(error)} 现有配置已保留。`;
      setWarnings((current) => ({ ...current, [providerId]: warning }));
      demoteCatalog(providerId, { models: [], fetched: false, warning });
    }
    finally { setDiscoveringId(null); onDiscoveringChange(false); }
  }

  function demoteCatalog(providerId: string, failed: ModelCatalog) {
    const provider = providers.find((item) => item.id === providerId);
    const configured = providerId === 'chatgpt' ? draft.chatgptModels ?? [] : provider?.models ?? [];
    const inventory = provider ? optionsForProvider(provider) : models;
    setCatalogs((current) => {
      const previous = rowsForProvider(providerId, configured, inventory, current[providerId]);
      const retained = new Map(previous.map((option) => [option.id, { ...option, availability: option.availability === 'unavailable' ? 'unavailable' as const : 'unverified' as const }]));
      for (const option of failed.models) {
        const prior = retained.get(option.id);
        retained.set(option.id, prior?.availability === 'unavailable' ? prior : { ...prior, ...option, availability: option.availability === 'unavailable' ? 'unavailable' : 'unverified' });
      }
      return { ...current, [providerId]: { ...failed, models: [...retained.values()], fetched: false } };
    });
  }

  function updateManual(providerId: string, patch: Partial<ManualDraft>) {
    setManualDrafts((current) => ({ ...current, [providerId]: { ...(current[providerId] ?? newManualDraft()), ...patch } }));
    setManualErrors((current) => ({ ...current, [providerId]: undefined }));
    onManualDraftChange(true);
  }

  function closeManual(providerId: string) {
    const next = { ...manualDrafts };
    delete next[providerId];
    setManualDrafts(next);
    onManualDraftChange(Object.keys(next).length > 0);
  }

  function saveManual(provider: CustomProvider) {
    const entry = manualDrafts[provider.id] ?? newManualDraft();
    const id = entry.id.trim();
    const contextWindow = entry.contextWindow.trim() ? Number(entry.contextWindow) : undefined;
    let error: string | undefined;
    if (!id) error = '请输入模型 ID。';
    else if (provider.models.some((model) => model.id === id && model.id !== entry.editingId)) error = '此模型 ID 已存在，请直接勾选或编辑。';
    else if (!entry.editingId && provider.models.length >= 256) error = '每个接口最多配置 256 个模型，请先移除不再需要的模型。';
    else if (contextWindow !== undefined && (!Number.isSafeInteger(contextWindow) || contextWindow < 128)) error = '上下文上限应为不小于 128 的整数。';
    if (error) { setManualErrors((current) => ({ ...current, [provider.id]: error })); return; }
    const previous = provider.models.find((model) => model.id === entry.editingId);
    const next: ConfiguredModel = { id, name: entry.name.trim() || undefined, contextWindow, enabled: previous?.id === id ? previous.enabled : false, source: previous && previous.id === id ? previous.source ?? 'endpoint' : 'manual' };
    updateProvider(provider.id, { models: previous ? provider.models.map((model) => model.id === entry.editingId ? next : model) : [...provider.models, next] });
    closeManual(provider.id);
  }

  function confirmRemoveProvider() {
    if (!removeProvider) return;
    const id = removeProvider.id;
    setDraft((current) => ({ ...current, customProviders: current.customProviders?.filter((provider) => provider.id !== id) }));
    setApiKeys((current) => { const next = { ...current }; delete next[id]; return next; });
    closeManual(id);
    if (expandedId === id) setExpandedId(null);
    setRemoveProvider(null);
  }

  return <>
    <div className="settings-section-heading">模型配置<span>仅勾选的模型出现在输入框</span></div>
    <label className="current-model-summary"><span>当前发送模型 · {currentProviderId === 'chatgpt' ? 'ChatGPT' : currentProvider?.name || '已移除的接口'}</span><input name="model" aria-label="当前发送模型" value={draft.model} readOnly placeholder="未选择" /></label>
    {!currentUsable && <p className="model-warning">当前模型未启用或不可用。可以保存此设置，请在输入框重新选择模型后发送。</p>}
    <div className="model-provider-panel official-provider">
      <div className="chatgpt-connection">
        <div><strong>{chatgpt.connected ? 'ChatGPT 已连接' : chatgpt.loginPending ? '正在连接 ChatGPT' : '使用你的 ChatGPT 账号'}</strong><p>{authMessage || '通过官方浏览器授权连接，无需填写 API Key。账号凭据仅保留到本次应用退出。'}</p></div>
        <button type="button" data-dialog-autofocus className={chatgpt.connected || chatgpt.loginPending ? 'secondary-button' : 'primary-button'} disabled={busy || browser} onClick={changeAccount}>{chatgpt.connected ? '注销' : chatgpt.loginPending ? '取消登录' : 'Continue with ChatGPT'}</button>
      </div>
      <div className="model-list-heading"><strong>ChatGPT 模型</strong><button type="button" className="text-button" disabled={busy || browser || modelsLoading} onClick={() => void discover('chatgpt')}>{discoveringId === 'chatgpt' ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}拉取模型列表</button></div>
      {!chatgpt.connected && <p className="helper">请先登录以更新此账号的模型目录。未验证模型不代表账号已获得使用权限。</p>}
      {warnings.chatgpt && <p className="model-warning" role="status">{warnings.chatgpt}</p>}
      <ModelChecklist providerName="ChatGPT" models={official} disabled={busy} onToggle={(option, enabled) => toggleModel('chatgpt', option, enabled)} removableIds={new Set((draft.chatgptModels ?? []).map((model) => model.id))} onRemove={(id) => setDraft((current) => ({ ...current, chatgptModels: current.chatgptModels?.filter((model) => model.id !== id) }))} />
    </div>
    <div className="custom-providers-heading"><strong>自定义接口</strong><button type="button" className="secondary-button" disabled={busy} onClick={addProvider}><Plus size={14} />新增接口</button></div>
    {!providers.length && <p className="helper">添加 OpenAI 兼容接口，再拉取目录或手动添加模型。</p>}
    <div className="custom-providers">{providers.map((provider) => {
      const expanded = expandedId === provider.id;
      const original = originalProviders.find((item) => item.id === provider.id);
      const connectionChanged = !!original && original.baseUrl.trim() !== provider.baseUrl.trim();
      const hasKey = !connectionChanged && providerStatus.some((item) => item.id === provider.id && item.hasApiKey);
      const entry = manualDrafts[provider.id];
      const rows = rowsForProvider(provider.id, provider.models, optionsForProvider(provider), catalogs[provider.id]);
      return <section className="model-provider-panel" key={provider.id} aria-label={provider.name || '自定义接口'}>
        <div className="custom-provider-header"><button type="button" className="custom-provider-toggle" aria-expanded={expanded} disabled={busy} onClick={() => setExpandedId(expanded ? null : provider.id)}><ChevronDown size={15} className={expanded ? 'expanded' : ''} /><span><strong>{provider.name || '未命名接口'}</strong><small>{provider.apiFormat === 'responses' ? 'Responses' : 'Chat Completions'} · {rows.filter((model) => model.enabled).length} 个模型已启用</small></span></button><button type="button" className="icon-button provider-remove" title="移除接口" aria-label={`移除接口 ${provider.name}`} disabled={busy} onClick={() => setRemoveProvider(provider)}><Trash2 size={15} /></button></div>
        {expanded && <div className="custom-provider-editor">
          <label className="field">接口名称<input name="providerName" value={provider.name} disabled={busy} onChange={(event) => updateProvider(provider.id, { name: event.target.value })} placeholder="例如：团队接口" /></label>
          <label className="field">接口地址<input name="baseUrl" type="url" value={provider.baseUrl} disabled={busy} onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label>
          <label className="field">API 格式<select name="apiFormat" value={provider.apiFormat} disabled={busy} onChange={(event) => updateProvider(provider.id, { apiFormat: event.target.value as CustomProvider['apiFormat'] })}><option value="responses">Responses API</option><option value="chat-completions">Chat Completions API</option></select></label>
          <label className="field">API Key<span className="field-note"><KeyRound size={12} />{hasKey ? '本次运行已配置，留空则保留' : '仅保存在本次运行内存；无密钥接口可留空'}</span><input name="apiKey" type="password" autoComplete="off" value={apiKeys[provider.id] ?? ''} disabled={busy || (hasKey && apiKeys[provider.id] === '')} onChange={(event) => setApiKeys((current) => { const next = { ...current }; if (event.target.value.trim()) next[provider.id] = event.target.value; else delete next[provider.id]; return next; })} placeholder={hasKey ? '留空保留现有密钥' : '输入本接口的密钥'} /></label>
          {connectionChanged && <p className="model-warning">接口地址已更改，原密钥将失效。需要认证时，请重新输入密钥。</p>}
          {hasKey && <label className="compact-checkbox"><input type="checkbox" checked={apiKeys[provider.id] === ''} disabled={busy} onChange={(event) => setApiKeys((current) => { const next = { ...current }; if (event.target.checked) next[provider.id] = ''; else delete next[provider.id]; return next; })} />清除本接口的现有密钥</label>}
          <div className="model-list-heading"><strong>启用模型</strong><button type="button" className="text-button" disabled={busy || browser} onClick={() => void discover(provider.id)}>{discoveringId === provider.id ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}拉取模型列表</button></div>
          {warnings[provider.id] && <p className="model-warning" role="status">{warnings[provider.id]}</p>}
          <ModelChecklist providerName={provider.name} models={rows} disabled={busy} onToggle={(option, enabled) => toggleModel(provider.id, option, enabled)} editableIds={new Set(provider.models.map((model) => model.id))} removableIds={new Set(provider.models.map((model) => model.id))} onEdit={(model) => { const configured = provider.models.find((item) => item.id === model.id); updateManual(provider.id, { editingId: model.id, id: model.id, name: configured?.name ?? '', contextWindow: configured?.contextWindow?.toString() ?? '' }); }} onRemove={(id) => { updateProvider(provider.id, { models: provider.models.filter((model) => model.id !== id) }); if (entry?.editingId === id) closeManual(provider.id); }} />
          {entry ? <div className="manual-model-editor">
            <strong>{entry.editingId ? '编辑模型' : '手动添加模型'}</strong>
            <label className="field">模型 ID<input name="modelId" value={entry.id} disabled={busy} onChange={(event) => updateManual(provider.id, { id: event.target.value })} placeholder="接口实际接受的模型 ID" /></label>
            <label className="field">显示名称（可选）<input name="modelName" value={entry.name} disabled={busy} onChange={(event) => updateManual(provider.id, { name: event.target.value })} placeholder="留空则显示模型 ID" /></label>
            <label className="field">上下文上限（可选）<input name="contextWindow" type="number" min={128} step={1} value={entry.contextWindow} disabled={busy} onChange={(event) => updateManual(provider.id, { contextWindow: event.target.value })} placeholder="未知时留空，不估计模型容量" /></label>
            <p className="helper">手动模型标为未验证；新增后请勾选启用，再保存设置。</p>
            {manualErrors[provider.id] && <p className="inline-error" role="alert">{manualErrors[provider.id]}</p>}
            <div className="manual-model-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => closeManual(provider.id)}>取消</button><button type="button" className="secondary-button" disabled={busy} onClick={() => saveManual(provider)}>{entry.editingId ? '保存模型' : '添加模型'}</button></div>
          </div> : <button type="button" className="text-button add-manual-model" disabled={busy} onClick={() => updateManual(provider.id, newManualDraft())}><Plus size={13} />手动添加模型</button>}
        </div>}
      </section>;
    })}</div>
    {removeProvider && <RemoveProviderDialog name={removeProvider.name} onClose={() => setRemoveProvider(null)} onConfirm={confirmRemoveProvider} />}
  </>;
}

function ModelChecklist({ providerName, models, disabled, onToggle, editableIds, removableIds, onEdit, onRemove }: {
  providerName: string;
  models: ModelOption[];
  disabled: boolean;
  onToggle: (option: ModelOption, enabled: boolean) => void;
  editableIds?: Set<string>;
  removableIds?: Set<string>;
  onEdit?: (model: ModelOption) => void;
  onRemove?: (id: string) => void;
}) {
  return <div className="configured-model-list" aria-label={`${providerName} 模型配置`}>
    {models.map((model) => <div className={`configured-model ${model.availability === 'unavailable' ? 'model-unavailable' : ''}`} key={model.id}>
      <label><input type="checkbox" name={`enabledModel:${model.providerId}:${model.id}`} checked={model.enabled === true} disabled={disabled || model.availability === 'unavailable'} onChange={(event) => onToggle(model, event.target.checked)} /><span><strong>{model.name || model.id}</strong><small>{model.id}{model.contextWindow ? ` · ${model.contextWindow.toLocaleString()} tokens` : ''}</small><small className="model-availability">{model.availability === 'unavailable' ? `不可用：${model.unavailableReason || '模型已退役或目录不再提供'}` : model.availability === 'unverified' ? '未验证' : '目录已验证'}</small></span></label>
      {(editableIds?.has(model.id) || removableIds?.has(model.id)) && <div className="configured-model-actions">{editableIds?.has(model.id) && <button type="button" className="icon-button" aria-label={`编辑模型 ${model.id}`} disabled={disabled} onClick={() => onEdit?.(model)}><Pencil size={13} /></button>}{removableIds?.has(model.id) && <button type="button" className="icon-button" aria-label={`移除模型 ${model.id}`} disabled={disabled} onClick={() => onRemove?.(model.id)}><Trash2 size={13} /></button>}</div>}
    </div>)}
    {!models.length && <p className="helper model-list-empty">尚未配置模型，可拉取目录或手动添加。</p>}
  </div>;
}

function RemoveProviderDialog({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  return <div className="modal-backdrop provider-delete-backdrop" onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="provider-delete-title"><h2 id="provider-delete-title">移除“{name}”？</h2><p>此接口及其模型配置会从设置草稿中移除。保存设置后，本次运行中的接口密钥也会清除；使用此接口的当前模型需要重新选择。</p><div className="approval-actions"><button type="button" data-dialog-autofocus className="secondary-button" onClick={onClose}>取消</button><button type="button" className="danger-button" onClick={onConfirm}><Trash2 size={14} />移除接口</button></div></section></div>;
}
