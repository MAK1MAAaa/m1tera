import { useState } from 'react';
import { BarChart3, LoaderCircle, X } from 'lucide-react';
import type { BaselineReport } from '../../shared/protocol';
import type { RuntimeClient } from '../lib/runtime-client';

const tokens = (value: number) => value.toLocaleString('zh-CN');
const elapsed = (value: number | null) => value === null ? '—' : value < 1000 ? `${Math.round(value)} ms` : `${(value / 1000).toFixed(1)} s`;

export function BaselinePanel({ client, connected, ready }: { client: RuntimeClient; connected: boolean; ready: boolean }) {
  const [report, setReport] = useState<BaselineReport | null>(null);
  const [measuring, setMeasuring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const browser = client.transport === 'browser';
  async function measure() {
    if (measuring || browser || !ready) return;
    setMeasuring(true);
    setError(null);
    try {
      setReport(await client.request('context.baseline', { live: connected }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setMeasuring(false); }
  }
  return <section className="context-section baseline-section">
    <div className="section-heading">首轮基线<span>0 / 4 / 20</span></div>
    <p className="panel-note">{browser ? '基线测量需在桌面应用中运行。' : connected ? '固定短消息，发送三次独立 API 请求。不会写入会话或执行工具。' : '查看定义的估算开销。连接模型后可测量服务商的实际输入。'}</p>
    <button className="manage-tools baseline-button" onClick={() => void measure()} disabled={measuring || browser || !ready}>
      {measuring ? <LoaderCircle className="spin" size={14} /> : <BarChart3 size={14} />}
      {measuring ? '正在测量…' : connected ? '测量首轮基线' : '查看估算基线'}
    </button>
    {measuring && <p className="panel-note" role="status">测量可能需要几分钟，你可以继续使用会话。</p>}
    {error && <div className="baseline-error" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError(null)} aria-label="关闭基线错误"><X size={13} /></button></div>}
    {report && <div className="baseline-results">
      <div className="baseline-mode"><span>{report.mode === 'live' ? '服务商实测' : '仅本地估算'}</span><span>{report.model}</span></div>
      <table aria-label="首轮上下文基线结果"><thead><tr><th scope="col">工具</th><th scope="col">估算</th><th scope="col">实际</th><th scope="col">耗时</th></tr></thead><tbody>{report.cases.map((item) => <tr key={item.toolCount}><th scope="row">{item.toolCount}</th><td>{tokens(item.estimate.total)}</td><td>{item.usage ? tokens(item.usage.totalInput) : '未知'}</td><td>{elapsed(item.elapsedMs)}</td></tr>)}</tbody></table>
      <p className="panel-note">输入单位为 tokens，实际值包含缓存输入。20 个工具为合成定义，仅测量声明开销。</p>
      {report.mode === 'estimate' && <p className="baseline-estimate-note">估算不是实际 usage。</p>}
      {report.cases.filter((item) => item.error).map((item) => <p className="baseline-case-error" key={item.toolCount}>{item.toolCount} 个工具：{item.error}</p>)}
      <details className="baseline-detail"><summary>测量明细</summary><p>{new Date(report.measuredAt).toLocaleString('zh-CN')}</p><p>固定消息：{report.prompt}</p>{report.cases.map((item) => <div key={item.toolCount}><strong>{item.toolCount} 个工具</strong><span>系统 {tokens(item.estimate.system)} · 工具 {tokens(item.estimate.tools)} · 消息 {tokens(item.estimate.history)}</span></div>)}</details>
    </div>}
  </section>;
}
