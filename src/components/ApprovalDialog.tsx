import { useState } from 'react';
import { AlertTriangle, Check, LoaderCircle, X } from 'lucide-react';
import type { Approval } from '../../shared/protocol';

export function ApprovalDialog({ approval, count, onResolve }: { approval: Approval; count: number; onResolve: (id: string, approved: boolean) => Promise<void> }) {
  const [resolving, setResolving] = useState(false);
  async function resolve(approved: boolean) {
    setResolving(true);
    await onResolve(approval.id, approved);
    setResolving(false);
  }
  return <section className="approval-dialog" role="dialog" aria-modal="false" aria-labelledby="approval-title">
    <div className="approval-heading"><AlertTriangle size={19} /><h2 id="approval-title">需要你的批准</h2><span>{count > 1 ? `${count} 项待处理` : '当前操作'}</span></div>
    <p className="approval-description">{approval.description}</p>
    <div className="approval-tool">{approval.toolName}</div>
    <pre className="approval-arguments">{JSON.stringify(approval.arguments, null, 2)}</pre>
    {approval.toolName === 'run_command' && <p className="helper">命令会以你的用户权限在本机运行，可访问工作区以外的系统资源。</p>}
    <div className="approval-actions"><button className="secondary-button" disabled={resolving} onClick={() => void resolve(false)}><X size={15} />拒绝</button><button className="primary-button" disabled={resolving} onClick={() => void resolve(true)}>{resolving ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}批准这一次</button></div>
  </section>;
}
