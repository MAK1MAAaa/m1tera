import { useEffect, useState } from 'react';
import { Check, ChevronDown, Shield, ShieldCheck } from 'lucide-react';
import type { ApprovalMode } from '../../shared/protocol';
export function ApprovalPicker({ mode, disabled, onSelect }: { mode: ApprovalMode; disabled: boolean; onSelect: (mode: ApprovalMode) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  return <div className="composer-picker approval-picker"><button type="button" className={`composer-control ${mode === 'auto' ? 'auto-approval-control' : ''}`} onClick={() => setOpen(!open)} disabled={disabled} aria-label="审批模式" aria-expanded={open}>{mode === 'auto' ? <ShieldCheck size={13} /> : <Shield size={13} />}<span>{mode === 'auto' ? '自动审批' : '逐次审批'}</span><ChevronDown size={12} /></button>
    {open && !disabled && <><button className="popover-dismiss" type="button" onClick={() => setOpen(false)} aria-label="关闭审批选择" /><section className="approval-popover" aria-label="审批模式"><div className="popover-heading"><strong>当前会话的审批</strong></div>{([{ id: 'ask', label: '逐次审批', note: '写文件和执行命令前，由你确认。' }, { id: 'auto', label: '自动审批', note: '自动批准已启用工具的写入和命令。' }] as const).map((option) => <button type="button" className="approval-option" key={option.id} onClick={() => { void onSelect(option.id).then((success) => { if (success) setOpen(false); }); }}><span><strong>{option.label}</strong><small>{option.note}</small></span>{mode === option.id && <Check size={15} />}</button>)}<p className="picker-note">自动审批不会启用工具。命令以当前用户权限执行。</p></section></>}
  </div>;
}
