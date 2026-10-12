import { useState } from 'react';
import { LoaderCircle, Plus, X } from 'lucide-react';
import type { SessionCategory, SessionSummary, Workspace } from '../../shared/protocol';
import { useDialogFocus } from './use-dialog-focus';
export type OrganizationAction = { kind: 'rename'; session: SessionSummary } | { kind: 'category'; session: SessionSummary } | { kind: 'move'; session: SessionSummary } | { kind: 'workspace-rename'; workspace: Workspace };
interface Props {
  action: OrganizationAction;
  categories: SessionCategory[];
  workspaces: Workspace[];
  onSessionUpdate: (id: string, patch: { title?: string; categoryId?: string | null; workspaceId?: string | null }) => Promise<boolean>;
  onCreateCategory: (name: string) => Promise<SessionCategory | undefined>;
  onWorkspaceRename: (id: string, name: string) => Promise<boolean>;
  error: string | null;
  onClose: () => void;
}
export function OrganizationDialog({ action, categories, workspaces, onSessionUpdate, onCreateCategory, onWorkspaceRename, error, onClose }: Props) {
  const title = action.kind === 'rename' ? '重命名会话' : action.kind === 'category' ? '会话分类' : action.kind === 'move' ? '移动到工作区' : '重命名工作区';
  const [value, setValue] = useState(action.kind === 'rename' ? action.session.title : action.kind === 'workspace-rename' ? action.workspace.name : action.kind === 'category' ? action.session.categoryId ?? '' : action.session.workspaceId ?? '');
  const [newCategory, setNewCategory] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(() => { if (!saving) onClose(); }, () => document.querySelector<HTMLElement>(action.kind === 'workspace-rename' ? `[data-workspace-id="${CSS.escape(action.workspace.id)}"] .session-more` : `[data-session-id="${CSS.escape(action.session.id)}"] .session-more`));
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    let success = false;
    if (action.kind === 'workspace-rename') success = await onWorkspaceRename(action.workspace.id, value.trim());
    else if (action.kind === 'rename') success = await onSessionUpdate(action.session.id, { title: value.trim() });
    else if (action.kind === 'move') success = await onSessionUpdate(action.session.id, { workspaceId: value || null });
    else {
      const created = newCategory !== null ? await onCreateCategory(newCategory.trim()) : undefined;
      if (newCategory === null || created) success = await onSessionUpdate(action.session.id, { categoryId: created?.id || value || null });
    }
    setSaving(false);
    if (success) onClose();
  }
  return <div className="modal-backdrop" onClick={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="organization-dialog" role="dialog" aria-modal="true" aria-labelledby="organization-title"><header className="dialog-header"><h2 id="organization-title">{title}</h2><button className="icon-button" onClick={onClose} disabled={saving} aria-label="关闭会话管理"><X size={18} /></button></header><form onSubmit={(event) => void save(event)}><div className="organization-body">
    {action.kind === 'rename' || action.kind === 'workspace-rename' ? <label className="field">名称<input name="title" aria-label={action.kind === 'rename' ? '会话名称' : '工作区名称'} value={value} onChange={(event) => setValue(event.target.value)} data-dialog-autofocus maxLength={200} /></label> : action.kind === 'category' ? <><label className="field">分类<select data-dialog-autofocus name="category" value={value} onChange={(event) => setValue(event.target.value)} disabled={newCategory !== null}><option value="">未分类</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>{newCategory === null ? <button className="text-button" type="button" onClick={() => setNewCategory('')}><Plus size={14} />新建分类</button> : <label className="field">新分类名称<input name="categoryName" autoFocus value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="例如：写作、研究" maxLength={80} /></label>}</> : <><label className="field">工作区<select data-dialog-autofocus name="workspaceId" value={value} onChange={(event) => setValue(event.target.value)}><option value="">不属于工作区</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><p className="helper">移动只更改会话归属和工具工作目录，不移动或删除文件。工具能力保持当前设置。</p></>}
    {error && <p className="inline-error" role="alert">{error}</p>}</div><footer className="dialog-footer"><button className="secondary-button" type="button" onClick={onClose} disabled={saving}>取消</button><button className="primary-button" disabled={saving || ((action.kind === 'rename' || action.kind === 'workspace-rename') && !value.trim()) || (newCategory !== null && !newCategory.trim())}>{saving && <LoaderCircle size={14} className="spin" />}{newCategory !== null ? '创建并归类' : '保存'}</button></footer></form></section></div>;
}
