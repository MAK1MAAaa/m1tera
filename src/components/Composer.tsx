import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUp, BookOpen, Check, FileText, Globe, ListChecks, LoaderCircle, MessageSquarePlus, Square, Trash2, X } from 'lucide-react';
import type { ComposerDraft, ContextEstimate, SkillSummary, WorkspaceFile } from '../../shared/protocol';
import { ContextRing } from './ContextRing';

interface Props {
  controls: ReactNode;
  estimate?: ContextEstimate;
  disabled: boolean;
  canSend: boolean;
  running: boolean;
  busy: boolean;
  placeholder: string;
  skills: SkillSummary[];
  skillsLoading: boolean;
  hasWorkspace: boolean;
  onFiles: (query: string) => Promise<WorkspaceFile[]>;
  onSend: (draft: ComposerDraft) => Promise<boolean>;
  onDraft: (draft: ComposerDraft) => void;
  onCancel: () => Promise<void>;
  onNew: () => Promise<void>;
  onSkills: () => void;
  onContext: () => void;
}
type Trigger = { symbol: '/' | '@' | '$'; query: string; start: number; end: number };
type Candidate = { id: string; title: string; description: string; type: 'command' | 'file' | 'skill'; icon: typeof FileText };
const COMMANDS: Candidate[] = [
  { id: 'plan', title: '做计划', description: '/plan · 分解目标、步骤和验证方式', type: 'command', icon: ListChecks },
  { id: 'websearch', title: '联网搜索', description: '/websearch · 查询网页并引用来源', type: 'command', icon: Globe },
  { id: 'new', title: '新会话', description: '/new', type: 'command', icon: MessageSquarePlus },
  { id: 'clear', title: '清空草稿', description: '/clear', type: 'command', icon: Trash2 },
  { id: 'skills', title: '管理 Skills', description: '/skills', type: 'command', icon: BookOpen },
];

/** Resolve only the token before the caret. Email addresses and selected text never open a picker. */
function findTrigger(text: string, caret: number, selectionEnd = caret): Trigger | null {
  if (caret !== selectionEnd) return null;
  const match = /(^|\s)([/@$])([^\s@$]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const start = caret - match[3].length - 1;
  const symbol = match[2] as Trigger['symbol'];
  // A slash inside prose or a path remains ordinary text.
  if (symbol === '/' && text.slice(0, start).trim()) return null;
  return { symbol, query: match[3], start, end: caret };
}

function leadingCommand(text: string): { command: NonNullable<ComposerDraft['command']>; length: number } | null {
  const match = /^\s*\/(plan|websearch)(?=\s)/.exec(text);
  return match ? { command: match[1] as NonNullable<ComposerDraft['command']>, length: match[0].length } : null;
}

export function Composer({ controls, estimate, disabled, canSend, running, busy, placeholder, skills, skillsLoading, hasWorkspace, onFiles, onSend, onDraft, onCancel, onNew, onSkills, onContext }: Props) {
  const [text, setText] = useState('');
  const [command, setCommand] = useState<ComposerDraft['command']>();
  const [attachments, setAttachments] = useState<string[]>([]);
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [trigger, setTrigger] = useState<Trigger | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const draft = useMemo<ComposerDraft>(() => ({ text, ...(command ? { command } : {}), ...(attachments.length ? { attachments } : {}), ...(skillIds.length ? { skillIds } : {}) }), [text, command, attachments, skillIds]);
  const triggerKey = trigger ? `${trigger.symbol}:${trigger.start}:${trigger.end}:${trigger.query}` : '';
  const open = !!trigger && triggerKey !== dismissed && !disabled;
  const query = trigger?.query.toLowerCase() ?? '';
  const candidates = useMemo<Candidate[]>(() => {
    if (!trigger) return [];
    if (trigger.symbol === '/') return COMMANDS.filter((item) => `${item.id} ${item.title}`.toLowerCase().includes(query));
    if (trigger.symbol === '$') return skills.filter((item) => item.enabled && !skillIds.includes(item.id) && `${item.name} ${item.description} ${item.triggers.join(' ')}`.toLowerCase().includes(query)).map((item) => ({ id: item.id, title: item.name, description: item.description, type: 'skill', icon: BookOpen }));
    return files.filter((item) => !attachments.includes(item.path)).map((item) => ({ id: item.path, title: item.path, description: `${item.size.toLocaleString('zh-CN')} bytes`, type: 'file', icon: FileText }));
  }, [trigger, query, skills, skillIds, files, attachments]);

  useEffect(() => { onDraft(draft); }, [draft, onDraft]);
  useEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);
  useEffect(() => {
    const request = ++requestRef.current;
    if (!open || trigger?.symbol !== '@' || !hasWorkspace) return;
    let disposed = false;
    const timer = window.setTimeout(() => {
      setFilesLoading(true); setFilesError(null); setFiles([]);
      void onFiles(trigger.query).then((result) => {
        if (!disposed && requestRef.current === request) setFiles(result);
      }).catch((cause: unknown) => {
        if (!disposed && requestRef.current === request) setFilesError(cause instanceof Error ? cause.message : String(cause));
      }).finally(() => { if (!disposed && requestRef.current === request) setFilesLoading(false); });
    }, 100);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [open, trigger?.symbol, trigger?.query, hasWorkspace, onFiles]);
  useEffect(() => {
    const list = listRef.current;
    const option = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !option) return;
    const listRect = list.getBoundingClientRect();
    const optionRect = option.getBoundingClientRect();
    if (optionRect.top < listRect.top) list.scrollTop -= listRect.top - optionRect.top;
    else if (optionRect.bottom > listRect.bottom) list.scrollTop += optionRect.bottom - listRect.bottom;
  }, [active]);

  function cursor(element: HTMLTextAreaElement) {
    const next = findTrigger(element.value, element.selectionStart, element.selectionEnd);
    const nextKey = next ? `${next.symbol}:${next.start}:${next.end}:${next.query}` : '';
    if (nextKey !== triggerKey) {
      setActive(0);
      if (next?.symbol === '@') { setFilesLoading(true); setFilesError(null); setFiles([]); }
    }
    setTrigger(next);
  }
  function replaceToken(value: string) {
    if (!trigger) return;
    const position = trigger.start + value.length;
    setText((current) => `${current.slice(0, trigger.start)}${value}${current.slice(trigger.end)}`);
    setTrigger(null); setDismissed(null);
    requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(position, position); });
  }
  function choose(candidate: Candidate) {
    if (!trigger) return;
    replaceToken('');
    if (candidate.type === 'file') setAttachments((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
    else if (candidate.type === 'skill') setSkillIds((current) => current.includes(candidate.id) ? current : [...current, candidate.id]);
    else if (candidate.id === 'plan' || candidate.id === 'websearch') setCommand(candidate.id);
    else if (candidate.id === 'new') void onNew();
    else if (candidate.id === 'skills') onSkills();
    else if (candidate.id === 'clear') { setText(''); setCommand(undefined); setAttachments([]); setSkillIds([]); }
  }
  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    const prefix = command ? null : leadingCommand(text);
    const content = prefix ? text.slice(prefix.length).trimStart() : text;
    if (!content.trim() || !canSend || running || busy) return;
    const original = draft;
    const success = await onSend({ ...draft, text: content.trim(), ...(prefix ? { command: prefix.command } : {}) });
    if (success) {
      setText((current) => current === original.text ? '' : current);
      setCommand((current) => current === original.command ? undefined : current);
      setAttachments((current) => current === original.attachments ? [] : current);
      setSkillIds((current) => current === original.skillIds ? [] : current);
      setTrigger(null);
    }
    inputRef.current?.focus();
  }
  const loading = trigger?.symbol === '@' ? hasWorkspace && filesLoading : trigger?.symbol === '$' ? skillsLoading : false;
  const noMatches = trigger?.symbol === '@' && !hasWorkspace ? '先为当前会话选择工作区' : filesError && trigger?.symbol === '@' ? filesError : trigger?.symbol === '$' && !skills.some((item) => item.enabled) ? '没有已启用的 Skill' : '没有匹配的结果';
  return <div className="composer-wrap"><form className={`composer ${running ? 'is-running' : ''}`} onSubmit={(event) => void submit(event)}>
    {open && <section className="composer-suggestions" aria-label={trigger.symbol === '/' ? '快捷命令' : trigger.symbol === '@' ? '工作区文件' : '选择 Skill'}>
      <div className="suggestion-heading">{trigger.symbol === '/' ? '快捷命令' : trigger.symbol === '@' ? '工作区文件' : 'Skills'}{trigger.symbol === '$' && <button type="button" onClick={() => { setDismissed(triggerKey); onSkills(); }}>管理</button>}</div>
      <div ref={listRef} id={listId} className="suggestion-options" role="listbox">{loading ? <div className="suggestion-empty"><LoaderCircle size={14} className="spin" />正在查找…</div> : candidates.length ? candidates.map((item, index) => { const Icon = item.icon; return <button type="button" role="option" id={`${listId}-${index}`} aria-selected={active === index} className={`suggestion-option ${active === index ? 'active' : ''}`} key={item.id} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(item)}><Icon size={16} /><span><strong>{item.title}</strong><small>{item.description}</small></span>{active === index && <Check size={13} />}</button>; }) : <div className="suggestion-empty">{noMatches}</div>}</div>
    </section>}
    {(command || attachments.length > 0 || skillIds.length > 0) && <div className="draft-chips">{command && <span className="draft-chip draft-command">{command === 'plan' ? <ListChecks size={13} /> : <Globe size={13} />}<span>{command === 'plan' ? '做计划' : '联网搜索'}</span><button type="button" aria-label="移除命令" onClick={() => setCommand(undefined)}><X size={12} /></button></span>}{attachments.map((path) => <span className="draft-chip" key={path} title={path}><FileText size={13} /><span>{path}</span><button type="button" aria-label={`移除文件 ${path}`} onClick={() => setAttachments((current) => current.filter((item) => item !== path))}><X size={12} /></button></span>)}{skillIds.map((id) => <span className="draft-chip draft-skill" key={id}><BookOpen size={13} /><span>{skills.find((item) => item.id === id)?.name ?? id}</span><button type="button" aria-label={`移除 Skill ${skills.find((item) => item.id === id)?.name ?? id}`} onClick={() => setSkillIds((current) => current.filter((item) => item !== id))}><X size={12} /></button></span>)}</div>}
    <textarea ref={inputRef} name="message" aria-label="发送消息" placeholder={placeholder} value={text} onChange={(event) => {
      const prefix = command ? null : leadingCommand(event.target.value);
      if (prefix) { setCommand(prefix.command); setText(event.target.value.slice(prefix.length).trimStart()); setTrigger(null); }
      else { setText(event.target.value); cursor(event.target); }
      setDismissed(null);
    }} onSelect={(event) => cursor(event.currentTarget)} onClick={(event) => cursor(event.currentTarget)} onBlur={() => setTrigger(null)} aria-controls={open ? listId : undefined} aria-expanded={open} aria-autocomplete="list" aria-activedescendant={open && candidates[active] ? `${listId}-${active}` : undefined} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (open && ['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'Escape') setDismissed(triggerKey);
        else if (event.key === 'ArrowUp') setActive((current) => candidates.length ? (current - 1 + candidates.length) % candidates.length : 0);
        else if (event.key === 'ArrowDown') setActive((current) => candidates.length ? (current + 1) % candidates.length : 0);
        else if (!loading && candidates[active]) choose(candidates[active]);
        return;
      }
      if (open && event.key === ' ' && trigger?.symbol === '/') {
        const exact = COMMANDS.find((item) => item.id === trigger.query);
        if (exact) { event.preventDefault(); choose(exact); return; }
      }
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); }
    }} disabled={disabled} rows={2} />
    <div className="composer-footer"><div className="composer-controls">{controls}</div><div className="composer-send-controls"><ContextRing estimate={estimate} onOpen={onContext} />{running ? <button type="button" className="stop-button" onClick={() => void onCancel()} aria-label="停止运行" title="停止运行"><Square size={12} fill="currentColor" /></button> : <button type="submit" className="send-button" disabled={!text.trim() || !canSend || busy} aria-label="发送消息">{busy ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={18} />}</button>}</div></div>
  </form></div>;
}
