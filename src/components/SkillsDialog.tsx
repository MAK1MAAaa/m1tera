import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Download, LoaderCircle, Plus, Search, Trash2, X } from 'lucide-react';
import type { Skill, SkillDraft, SkillSummary } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';
import { useDialogFocus } from './use-dialog-focus';

interface Props {
  skills: SkillSummary[];
  loading: boolean;
  autoSkills: boolean;
  canConfigureAuto: boolean;
  disabled: boolean;
  error: string | null;
  client: RuntimeClient;
  onLoad: (id: string) => Promise<Skill | undefined>;
  onSave: (draft: SkillDraft, id?: string) => Promise<boolean>;
  onImport: (path: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onToggle: (id: string, enabled: boolean) => Promise<boolean>;
  onAuto: (enabled: boolean) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  onClose: () => void;
}
type Editor = { id?: string; builtin?: boolean; name: string; description: string; instructions: string; triggers: string; enabled: boolean };
const emptyEditor = (): Editor => ({ name: '', description: '', instructions: '', triggers: '', enabled: true });

export function SkillsDialog({ skills, loading, autoSkills, canConfigureAuto, disabled, error, client, onLoad, onSave, onImport, onDelete, onToggle, onAuto, onRefresh, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SkillSummary | null>(null);
  const requestRef = useRef(0);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!pending) onClose(); });
  const filtered = skills.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { void onRefresh(); }, [onRefresh]);

  async function edit(id: string) {
    const request = ++requestRef.current;
    setLoadingId(id); setLocalError(null);
    try {
      const skill = await onLoad(id);
      if (request === requestRef.current && skill) setEditor({ id: skill.id, builtin: skill.builtin, name: skill.name, description: skill.description, instructions: skill.instructions, triggers: skill.triggers.join(', '), enabled: skill.enabled });
    } catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (request === requestRef.current) setLoadingId(null); }
  }
  async function perform(action: () => Promise<boolean>) {
    setPending(true); setLocalError(null);
    try { return await action(); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : String(cause)); return false; }
    finally { setPending(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || editor.builtin) return;
    if (!editor.name.trim() || !editor.instructions.trim()) { setLocalError('请填写名称和指令。'); return; }
    const draft: SkillDraft = { name: editor.name.trim(), description: editor.description.trim(), instructions: editor.instructions, triggers: editor.triggers.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean), enabled: editor.enabled };
    const success = await perform(() => onSave(draft, editor.id));
    if (success) setEditor(null);
  }
  async function importSkill() {
    const success = await perform(async () => { const path = await client.chooseSkillFile(); return path ? onImport(path) : false; });
    if (success) setEditor(null);
  }

  return <div className="modal-backdrop" onClick={(event) => { if (event.currentTarget === event.target && !pending) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="skills-dialog" role="dialog" aria-modal="true" aria-labelledby="skills-title">
    <header className="dialog-header"><h2 id="skills-title">Skills</h2><button type="button" className="icon-button" aria-label="关闭 Skills" onClick={onClose} disabled={pending}><X size={19} /></button></header>
    <div className="skills-auto"><label><span><strong>自动匹配</strong><small>仅本会话，由模型按任务选择已启用的 Skill。</small></span><input type="checkbox" aria-label="自动匹配 Skills" checked={autoSkills} disabled={disabled || pending || !canConfigureAuto} onChange={(event) => void perform(() => onAuto(event.target.checked))} /></label></div>
    <div className="skills-body"><div className="skills-library"><div className="skills-library-toolbar"><label className="model-search"><Search size={14} /><input data-dialog-autofocus name="skillSearch" aria-label="搜索 Skills" placeholder="搜索 Skills" value={query} onChange={(event) => setQuery(event.target.value)} /></label><div className="skills-library-actions"><button className="secondary-button" type="button" disabled={pending || disabled} onClick={() => { requestRef.current++; setLoadingId(null); setLocalError(null); setEditor(emptyEditor()); }}><Plus size={14} />创建</button><button className="secondary-button" type="button" disabled={pending || disabled} onClick={() => void importSkill()}><Download size={14} />导入</button></div></div>
      <div className="skill-list">{loading ? <div className="suggestion-empty"><LoaderCircle size={15} className="spin" />正在加载…</div> : filtered.length ? filtered.map((item) => <div key={item.id} className={`skill-item ${editor?.id === item.id ? 'selected' : ''} ${item.enabled ? '' : 'is-disabled'}`}><button type="button" className="skill-item-select" disabled={pending} onClick={() => void edit(item.id)}>{loadingId === item.id ? <LoaderCircle size={17} className="spin" /> : <BookOpen size={17} />}<span><strong>{item.name}{item.builtin && <small>内置</small>}</strong><span>{item.description || '无描述'}</span></span></button><div className="skill-item-actions"><input type="checkbox" aria-label={`启用 Skill ${item.name}`} checked={item.enabled} disabled={pending || disabled} onChange={(event) => { const enabled = event.target.checked; void perform(() => onToggle(item.id, enabled)).then((success) => { if (success) setEditor((current) => current?.id === item.id ? { ...current, enabled } : current); }); }} />{!item.builtin && <button className="icon-button" type="button" aria-label={`删除 Skill ${item.name}`} disabled={pending || disabled} onClick={() => setDeleting(item)}><Trash2 size={14} /></button>}</div></div>) : <p className="skill-list-empty">{query ? '没有匹配的 Skill' : '创建或导入你的第一个 Skill'}</p>}</div>
    </div><div className="skill-editor">{editor ? <form onSubmit={(event) => void save(event)}><div className="skill-editor-fields"><h3>{editor.builtin ? '内置 Skill' : editor.id ? '编辑 Skill' : '创建 Skill'}</h3><label className="field">名称<input name="skillName" value={editor.name} readOnly={editor.builtin} onChange={(event) => setEditor({ ...editor, name: event.target.value })} maxLength={80} /></label><label className="field">描述<textarea name="skillDescription" rows={2} value={editor.description} readOnly={editor.builtin} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label><label className="field">匹配关键词<input name="skillTriggers" value={editor.triggers} readOnly={editor.builtin} placeholder="用逗号分隔，例如：代码审查, review" onChange={(event) => setEditor({ ...editor, triggers: event.target.value })} /></label><label className="field">指令<textarea className="skill-instructions" name="skillInstructions" rows={8} value={editor.instructions} readOnly={editor.builtin} placeholder="使用这个 Skill 时，Agent 应该如何完成任务？" onChange={(event) => setEditor({ ...editor, instructions: event.target.value })} /></label>{!editor.builtin && <label className="compact-checkbox"><input type="checkbox" checked={editor.enabled} onChange={(event) => setEditor({ ...editor, enabled: event.target.checked })} />启用此 Skill</label>}</div>{!editor.builtin && <footer className="skill-editor-footer"><button className="secondary-button" type="button" onClick={() => setEditor(null)} disabled={pending}>取消</button><button className="primary-button" type="submit" disabled={pending || disabled}>{pending ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}保存 Skill</button></footer>}</form> : <div className="skill-editor-empty"><BookOpen size={27} strokeWidth={1.3} /><h3>为常用任务定义做法</h3><p>选择 Skill 查看指令，或创建自己的 Skill。<br />在消息里输入 $，按需加入本轮上下文。</p></div>}</div></div>
    {(localError || error) && <div className="skills-error inline-error" role="alert">{localError || error}</div>}
    {deleting && <DeleteSkillConfirmation name={deleting.name} pending={pending} onClose={() => setDeleting(null)} onDelete={() => void perform(() => onDelete(deleting.id)).then((success) => { if (success) { if (editor?.id === deleting.id) setEditor(null); setDeleting(null); } })} />}
  </section></div>;
}

function DeleteSkillConfirmation({ name, pending, onDelete, onClose }: { name: string; pending: boolean; onDelete: () => void; onClose: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!pending) onClose(); });
  return <div className="modal-backdrop skill-delete-backdrop"><section ref={dialogRef} tabIndex={-1} role="alertdialog" aria-modal="true" aria-labelledby="skill-delete-title" className="confirm-dialog"><h2 id="skill-delete-title">删除“{name}”？</h2><p>此 Skill 的本地指令会被删除，操作无法撤销。</p><div className="approval-actions"><button type="button" data-dialog-autofocus className="secondary-button" onClick={onClose} disabled={pending}>取消</button><button type="button" className="danger-button" onClick={onDelete} disabled={pending}>{pending ? <LoaderCircle size={14} className="spin" /> : <Trash2 size={14} />}删除 Skill</button></div></section></div>;
}
