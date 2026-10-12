import { Check, ChevronRight, X } from 'lucide-react';

const TOOL_LABELS = { list_directory: '列目录', read_file: '读文件', write_file: '写文件', run_command: '执行命令' };

// 来自现有 src/App.tsx 的 Message 结构；样式使用应用的 message / tool-card 类。
export function Message({ message }) {
  if (message.role === 'tool') return <details className={`tool-card ${message.isError ? 'tool-error' : 'tool-success'}`}>
    <summary><span className="tool-card-icon">{message.isError ? <X size={14} /> : <Check size={14} />}</span><span>{TOOL_LABELS[message.toolName] ?? message.toolName ?? '工具'}</span><span className="tool-state">{message.isError ? '失败' : '完成'}</span><ChevronRight size={14} className="detail-chevron" /></summary>
    <pre>{message.text}</pre>
  </details>;
  return <article className={`message message-${message.role}`}>
    <div className="message-label">{message.role === 'user' ? '你' : <><span className="small-mark">m</span>M1TERA</>}</div>
    <div className="message-body">{message.text || <span className="thinking"><span /> <span /> <span /></span>}</div>
  </article>;
}
