import { useEffect, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { ModelOption } from '../../shared/protocol';
interface Props {
  models: ModelOption[];
  model: string;
  currentProviderId?: string;
  compatible: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string, providerId?: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}
export function ModelPicker({ models, model, currentProviderId, loading, disabled, onSelect, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const isSelected = (option: ModelOption) => option.id === model && (!currentProviderId || option.providerId === currentProviderId);
  const available = models.filter((item) => item.enabled !== false && item.availability !== 'unavailable');
  const selected = available.find(isSelected);
  const warnings = [...new Set(models.map((option) => option.catalogWarning).filter((warning): warning is string => !!warning))];
  const duplicateIds = new Set(available.filter((item, index) => available.findIndex((other) => other.id === item.id) !== index).map((item) => item.id));
  const filtered = available.filter((item) => `${item.id} ${item.name} ${item.providerName ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  async function select(option: ModelOption) {
    setSelecting(true);
    try {
      const success = await onSelect(option.id, option.providerId);
      if (success) { setOpen(false); setQuery(''); }
    } finally { setSelecting(false); }
  }
  return <div className="composer-picker model-picker">
    <button type="button" className="composer-control model-control" onClick={() => { setOpen(!open); setQuery(''); }} disabled={disabled || selecting} aria-label="选择模型" aria-expanded={open} title={selected ? `${selected.providerName ? `${selected.providerName} · ` : ''}${selected.name || selected.id}` : model ? '当前模型未启用或不可用，请重新选择' : '选择模型'}>{selecting ? <LoaderCircle size={13} className="spin" /> : null}<span>{selected ? `${duplicateIds.has(selected.id) && selected.providerName ? `${selected.providerName} · ` : ''}${selected.name || selected.id}` : '选择模型'}</span><ChevronDown size={12} /></button>
    {open && !disabled && <><button className="popover-dismiss" type="button" onClick={() => setOpen(false)} aria-label="关闭模型选择" /><section className="model-popover" aria-label="模型选择">
      <div className="popover-heading"><strong>选择模型</strong><button type="button" className="icon-button" onClick={() => void onRefresh()} disabled={loading} title="刷新模型列表" aria-label="刷新模型列表">{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}</button></div>
      <label className="model-search"><Search size={14} /><input name="modelSearch" aria-label="筛选模型" placeholder="搜索模型或接口" value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></label>
      <div className="model-options" role="listbox" aria-label="可用模型">{filtered.map((option) => <button type="button" role="option" aria-selected={isSelected(option)} className="model-option" key={`${option.providerId ?? ''}:${option.id}`} onClick={() => void select(option)} disabled={selecting}><span><strong>{option.name || option.id}</strong><small>{option.providerName ? `${option.providerName} · ` : ''}{option.id}{option.contextWindow ? ` · ${Math.round(option.contextWindow / 1000)}k 上下文` : ''}{option.availability === 'unverified' ? ' · 未验证' : ''}</small></span>{isSelected(option) && <Check size={15} />}</button>)}{!filtered.length && <p className="picker-empty">{available.length ? '没有匹配的模型' : '请在设置中勾选启用模型'}</p>}</div>
      {warnings.map((warning) => <p className="picker-note model-warning" role="status" key={warning}>{warning}</p>)}
      {model && !selected && <p className="picker-note">当前模型未启用或不可用，请重新选择。</p>}
      <p className="picker-note">在设置中管理接口、勾选模型或手动添加模型 ID。</p>
    </section></>}
  </div>;
}
