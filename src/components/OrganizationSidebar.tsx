import { useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FolderPlus, MessageSquare, MoreHorizontal, PanelLeft, Pin, Plus, Settings2 } from 'lucide-react';
import type { SessionSummary, SessionCategory, Workspace } from '../../shared/protocol';

export type SidebarMenu = { kind: 'session'; item: SessionSummary; x: number; y: number } | { kind: 'workspace'; item: Workspace; x: number; y: number };
interface Props {
  sessions: SessionSummary[];
  workspaces: Workspace[];
  categories: SessionCategory[];
  selectedId: string | null;
  selectedWorkspaceId: string | null;
  runs: Record<string, unknown>;
  ready: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: (id: string) => void;
  onNew: (workspaceId?: string) => void;
  onWorkspaceSelect: (id: string | null) => void;
  onAddWorkspace: () => void;
  onMenu: (menu: SidebarMenu) => void;
  onSettings: () => void;
}

export function OrganizationSidebar({ sessions, workspaces, categories, selectedId, selectedWorkspaceId, runs, ready, collapsed, onToggle, onSelect, onNew, onWorkspaceSelect, onAddWorkspace, onMenu, onSettings }: Props) {
  const [closedWorkspaces, setClosedWorkspaces] = useState<string[]>([]);
  function row(session: SessionSummary, duplicate = false) {
    return <div className={`session-row ${selectedId === session.id ? 'active' : ''}`} key={`${duplicate ? 'pinned-' : ''}${session.id}`} data-session-id={session.id} onContextMenu={(event) => { event.preventDefault(); onMenu({ kind: 'session', item: session, x: event.clientX, y: event.clientY }); }}>
      <button className="session-select" title={session.title} onClick={() => onSelect(session.id)}><MessageSquare size={14} /><span>{session.title || '新会话'}</span>{!!runs[session.id] && <span className="session-running" aria-label="运行中" />}</button>
      <button className="session-more" aria-label={`会话操作 ${session.title}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ kind: 'session', item: session, x: rect.right + 5, y: rect.top }); }}><MoreHorizontal size={15} /></button>
    </div>;
  }
  function grouped(items: SessionSummary[]) {
    const known = new Set(categories.map((category) => category.id));
    const uncategorized = items.filter((item) => !item.categoryId || !known.has(item.categoryId));
    return <>{uncategorized.map((item) => row(item))}{categories.map((category) => {
      const members = items.filter((item) => item.categoryId === category.id);
      return members.length > 0 && <div className="category-group" key={category.id}><div className="category-label">{category.name}</div>{members.map((item) => row(item))}</div>;
    })}</>;
  }
  const pinned = sessions.filter((session) => session.pinned);
  const knownWorkspaces = new Set(workspaces.map((workspace) => workspace.id));
  const loose = sessions.filter((session) => !session.workspaceId || !knownWorkspaces.has(session.workspaceId));
  return <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <div className="sidebar-top"><button className="brand" onClick={() => onWorkspaceSelect(null)} aria-label="m1tera 首页"><span className="brand-mark">m</span><strong>m1tera</strong></button><button className="icon-button sidebar-toggle" onClick={onToggle} aria-label={collapsed ? '展开侧栏' : '收起侧栏'} title={collapsed ? '展开侧栏' : '收起侧栏'}><PanelLeft size={17} /></button></div>
    <button className="new-session" onClick={() => onNew(selectedWorkspaceId ?? undefined)} disabled={!ready} title="新建会话" aria-label="新建会话"><Plus size={17} /><span>新建会话</span><kbd aria-hidden="true">{navigator.userAgent.includes('Mac') ? '⌘ N' : 'Ctrl N'}</kbd></button>
    <div className="sidebar-scroll">
      {pinned.length > 0 && <section className="sidebar-section"><div className="sidebar-label"><Pin size={12} /><span>置顶</span><span className="section-count">{pinned.length}</span></div>{pinned.map((item) => row(item, true))}</section>}
      <section className="sidebar-section"><div className="sidebar-label"><span>工作区</span><button className="icon-button" onClick={onAddWorkspace} disabled={!ready} aria-label="添加工作区" title="添加工作区"><FolderPlus size={15} /></button></div>
        {workspaces.map((workspace) => {
          const closed = closedWorkspaces.includes(workspace.id);
          const members = sessions.filter((session) => session.workspaceId === workspace.id);
          return <div className={`workspace-group ${selectedWorkspaceId === workspace.id ? 'workspace-selected' : ''}`} key={workspace.id}>
            <div className="workspace-row" data-workspace-id={workspace.id} onContextMenu={(event) => { event.preventDefault(); onMenu({ kind: 'workspace', item: workspace, x: event.clientX, y: event.clientY }); }}>
              <button className="workspace-chevron" aria-label={`${closed ? '展开' : '收起'}工作区 ${workspace.name}`} onClick={() => setClosedWorkspaces((current) => closed ? current.filter((id) => id !== workspace.id) : [...current, workspace.id])}>{closed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button>
              <button className="workspace-select" onClick={() => onWorkspaceSelect(workspace.id)} title={workspace.path}><Folder size={14} /><span>{workspace.name}</span></button>
              <button className="session-more" aria-label={`管理工作区 ${workspace.name}`} onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ kind: 'workspace', item: workspace, x: rect.right + 5, y: rect.top }); }}><MoreHorizontal size={15} /></button>
            </div>
            {!closed && <div className="workspace-sessions">{members.length ? grouped(members) : <button className="workspace-empty" onClick={() => onNew(workspace.id)} disabled={!ready}><Plus size={12} />在这里开始会话</button>}</div>}
          </div>;
        })}
        {workspaces.length === 0 && <button className="workspace-add-empty" onClick={onAddWorkspace} disabled={!ready}><FolderPlus size={15} /><span>添加本地目录</span></button>}
      </section>
      <section className="sidebar-section"><div className="sidebar-label"><span>会话</span><span className="section-count">{loose.length}</span></div>{loose.length ? grouped(loose) : <p className="sessions-empty">新会话会出现在这里</p>}</section>
    </div>
    <footer className="sidebar-footer"><button className="sidebar-settings" onClick={onSettings} title="设置" aria-label="设置"><Settings2 size={16} /><span>设置</span></button></footer>
  </aside>;
}
