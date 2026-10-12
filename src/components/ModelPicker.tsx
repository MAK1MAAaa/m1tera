import { useEffect, useState } from 'react';
import { Check, ChevronDown, LoaderCircle, RefreshCw, Search } from 'lucide-react';
import type { ModelOption } from '../../shared/protocol';
interface Props {
  models: ModelOption[];
  model: string;
  compatible: boolean;
  loading: boolean;
  disabled: boolean;
  onSelect: (id: string) => Promise<boolean>;
  onRefresh: () => Promise<void>;
}
export function ModelPicker({ models, model, compatible, loading, disabled, onSelect, onRefresh }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const [query, setQuery] = useState('');
  const [selecting, setSelecting] = useState(false);
  const available = models.some((item) => item.id === model) ? models : [{ id: model, name: model, source: 'configured' } as ModelOption, ...models];
  const filtered = available.filter((item) => `${item.id} ${item.name}`.toLowerCase().includes(query.toLowerCase()));
  async function select(id: string) {
    setSelecting(true);
    const success = await onSelect(id);
    setSelecting(false);
    if (success) { setOpen(false); setQuery(''); }
  }
  return <div className="composer-picker model-picker">
    <button type="button" className="composer-control model-control" onClick={() => { setOpen(!open); setQuery(''); }} disabled={disabled || selecting} aria-label="选择模型" aria-expanded={open}>{selecting ? <LoaderCircle size={13} className="spin" /> : null}<span>{model || '选择模型'}</span><ChevronDown size={12} /></button>
    {open && !disabled && <><button className="popover-dismiss" type="button" onClick={() => setOpen(false)} aria-label="关闭模型选择" /><section className="model-popover" aria-label="模型选择">
      <div className="popover-heading"><strong>选择模型</strong><button type="button" className="icon-button" onClick={() => void onRefresh()} disabled={loading} title="刷新模型列表" aria-label="刷新模型列表">{loading ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}</button></div>
      <label className="model-search"><Search size={14} /><input name="modelSearch" aria-label="筛选模型" placeholder={compatible ? '搜索或输入模型 ID' : '搜索模型'} value={query} onChange={(event) => setQuery(event.target.value)} autoFocus /></label>
      <div className="model-options" role="listbox" aria-label="可用模型">{filtered.map((option) => <button type="button" role="option" aria-selected={option.id === model} className="model-option" key={option.id} onClick={() => void select(option.id)} disabled={selecting}><span><strong>{option.name || option.id}</strong><small>{option.id}{option.contextWindow ? ` · ${Math.round(option.contextWindow / 1000)}k 上下文` : ''}</small></span>{option.id === model && <Check size={15} />}</button>)}{!filtered.length && <p className="picker-empty">没有匹配的模型</p>}</div>
      {compatible && query.trim() && !available.some((option) => option.id === query.trim()) && <button type="button" className="custom-model-button" onClick={() => void select(query.trim())} disabled={selecting}>使用模型 ID：<strong>{query.trim()}</strong></button>}
    </section></>}
  </div>;
}
