import { useEffect, useState } from 'react';
import { FlaskConical, LoaderCircle, Play, RefreshCw, Square, X } from 'lucide-react';
import type { BenchmarkReport, BenchmarkStatus, BenchmarkSuiteId } from '../../shared/protocol';
import { useDialogFocus } from './use-dialog-focus';

interface Props {
  status: BenchmarkStatus;
  report?: BenchmarkReport;
  reportId?: string;
  loading: boolean;
  busy: boolean;
  error: string | null;
  canStart: boolean;
  model: string;
  onStart: (suite: BenchmarkSuiteId, limit: number) => Promise<boolean>;
  onCancel: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLoad: (runId: string) => Promise<void>;
  onOpenURL: (url: string) => void;
  onClose: () => void;
}

const suiteName = (suite: BenchmarkSuiteId) => suite === 'bfcl-v4' ? 'BFCL v4 工具调用' : 'SimpleQA 事实问答';
const percent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '未知';
const count = (value: number | null | undefined) => value === null || value === undefined ? '未知' : value.toLocaleString('zh-CN');
const elapsed = (milliseconds: number | null) => milliseconds === null ? '未知' : milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} 秒`;

export function BenchmarksDialog({ status, report, reportId, loading, busy, error, canStart, model, onStart, onCancel, onRefresh, onLoad, onOpenURL, onClose }: Props) {
  const [suite, setSuite] = useState<BenchmarkSuiteId>('bfcl-v4');
  const [limit, setLimit] = useState(20);
  const [validation, setValidation] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  useEffect(() => { void onRefresh(); }, [onRefresh]);
  const running = status.running;

  async function start() {
    setValidation(null);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) { setValidation('题数应为 1 到 20 的整数。'); return; }
    await onStart(suite, limit);
  }

  return <div className="modal-backdrop" onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="benchmarks-dialog" role="dialog" aria-modal="true" aria-labelledby="benchmarks-title">
      <header className="dialog-header"><h2 id="benchmarks-title"><FlaskConical size={17} />模型与 Harness 评测</h2><button type="button" className="icon-button" aria-label="关闭评测" onClick={onClose}><X size={18} /></button></header>
      <div className="benchmarks-scroll">
        <form className="benchmark-controls" onSubmit={(event) => event.preventDefault()}>
          <div className="benchmark-model">当前模型<strong title={model}>{model || '尚未选择模型'}</strong></div>
          <div className="benchmark-inputs"><label className="field">评测集<select name="benchmarkSuite" data-dialog-autofocus value={suite} disabled={busy || !!running} onChange={(event) => setSuite(event.target.value as BenchmarkSuiteId)}><option value="bfcl-v4">BFCL v4 工具调用</option><option value="simpleqa">SimpleQA 事实问答</option></select></label><label className="field">题数<input name="benchmarkLimit" type="number" min={1} max={20} step={1} value={limit} disabled={busy || !!running} onChange={(event) => setLimit(Number(event.target.value))} /></label></div>
          <p className="benchmark-note">{suite === 'bfcl-v4' ? 'BFCL v4 原题子集，AST 评分规则在本地移植。测试函数只记录调用。' : 'SimpleQA 原题子集，无浏览；作答与另次评分请求使用同一模型。'} 每题空历史，最多 20 题；结果不对标官方排行榜。</p>
          <div className="benchmark-actions"><span className="helper">使用当前连接发送真实模型请求。</span><button type="button" className="primary-button" onClick={() => void start()} disabled={!canStart || busy || loading || !!running}>{busy && !running ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}开始评测</button></div>
          {!canStart && !running && <p className="helper">连接并启用模型、结束运行中的任务后开始评测。</p>}
        </form>
        {running && <section className="benchmark-progress" aria-label="评测进度" role="status"><div><strong>{suiteName(running.suite)}</strong><span>{running.completed} / {running.total}</span></div><progress value={running.completed} max={Math.max(1, running.total)} /><button type="button" className="secondary-button" disabled={busy} onClick={() => void onCancel()}><Square size={12} />停止评测</button></section>}
        {(error || validation) && <p className="inline-error" role="alert">{validation || error}</p>}
        {!!status.reports.length && <section className="benchmark-history"><div className="settings-section-heading">历史报告<button type="button" className="text-button" aria-label="刷新评测报告" disabled={loading} onClick={() => void onRefresh()}>{loading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}</button></div><div className="benchmark-history-list">{status.reports.map((item) => <button type="button" className={`benchmark-history-item ${item.runId === reportId ? 'selected' : ''}`} key={item.runId} disabled={loading} onClick={() => void onLoad(item.runId)}><span><strong>{suiteName(item.suite)}</strong><small>{item.model} · {item.mode === 'fixture' ? '模拟验证' : '真实请求'}{item.status === 'cancelled' ? ' · 已停止' : ''}</small></span><span>{percent(item.mode === 'fixture' ? null : item.accuracy)}<small>已判分 {item.graded} / {item.total} · 未知 {item.unknown}</small></span></button>)}</div></section>}
        {report && <BenchmarkResult report={report} onOpenURL={onOpenURL} />}
        {!running && !report && !status.reports.length && <p className="benchmark-empty">尚无评测报告。</p>}
      </div>
    </section>
  </div>;
}

function BenchmarkResult({ report, onOpenURL }: { report: BenchmarkReport; onOpenURL: (url: string) => void }) {
  const fixture = report.mode === 'fixture';
  return <section className="benchmark-result" aria-label="评测结果">
    <div className="benchmark-result-heading"><h3>{report.name}</h3><span>{fixture ? '模拟验证 · 不计模型成绩' : '真实模型请求'}{report.status === 'cancelled' ? ' · 已停止' : ''}</span></div>
    <p className="benchmark-note">{report.model} · {new Date(report.measuredAt).toLocaleString('zh-CN')}</p>
    <div className="benchmark-metrics"><div><span>准确率</span><strong>{percent(fixture ? null : report.metrics.accuracy)}</strong><small>分母为已判分题目</small></div><div><span>已判分 / 全部</span><strong>{report.metrics.graded} / {report.total}</strong><small>正确 {report.metrics.correct} · 错误 {report.metrics.incorrect}</small></div><div><span>未知</span><strong>{report.metrics.unknown}</strong><small>未作答 {report.metrics.notAttempted}</small></div></div>
    <p className="benchmark-note">运行或评分出错计为未知；未知题目不计入准确率分母。{report.suite === 'simpleqa' && '同模型评分可能存在偏差。'}{fixture && '模拟数据只用于验证评测流程。'}</p>
    <dl className="benchmark-usage"><div><dt>服务商总输入</dt><dd>{count(report.metrics.totalInputTokens)} tokens</dd></div>{report.metrics.inputUsageUnknown && <div><dt>已报告的部分输入</dt><dd>{count(report.metrics.knownInputTokens)} tokens</dd></div>}<div><dt>本地预计输入</dt><dd>{count(report.metrics.estimatedInputTokens)} tokens</dd></div><div><dt>评测耗时</dt><dd>{elapsed(report.metrics.elapsedMs)}</dd></div></dl>
    <div className="benchmark-case-table"><table><thead><tr><th>题目</th><th>结果</th><th>耗时</th><th>输入 usage</th></tr></thead><tbody>{report.cases.map((item) => <tr key={item.id}><th>{item.id}</th><td>{item.status === 'unknown' ? '未知' : item.grade === 'NOT_ATTEMPTED' ? '未作答' : item.status === 'passed' ? '正确' : '未通过'}</td><td>{elapsed(item.elapsedMs)}</td><td>{count(item.usage?.totalInput)}</td></tr>)}</tbody></table></div>
    <details className="benchmark-details"><summary>逐题详情</summary>{report.cases.map((item) => <details className="benchmark-case-detail" key={item.id}><summary>{item.id}<span>{item.status === 'unknown' ? '未知' : item.status === 'passed' ? '通过' : '未通过'}</span></summary>{item.error && <p className="benchmark-case-error">{item.error}</p>}{item.answer !== undefined && <pre>{item.answer || '未返回作答文本'}</pre>}{!!item.calls?.length && <pre>{JSON.stringify(item.calls, null, 2)}</pre>}{item.grade && <p className="benchmark-note">评分：{item.grade}</p>}</details>)}</details>
    <details className="benchmark-details"><summary>来源与评分规则</summary><p>{report.suite === 'bfcl-v4' ? 'BFCL v4 原题；单调用 Python AST 规则的本地 TypeScript 移植。' : `SimpleQA 官方原题与评分提示词；${report.settings.sameModelForGrader ? '同一模型' : '单独模型'}另次请求评分。`} 本次为固定子集，不对标官方完整榜单。</p><p>{report.grader}</p><a href={report.source.upstream} onClick={(event) => { event.preventDefault(); onOpenURL(report.source.upstream); }}>查看原题来源</a><dl><div><dt>版本</dt><dd>{report.source.revision}</dd></div><div><dt>采样</dt><dd>{report.source.sampling}</dd></div><div><dt>许可</dt><dd>{report.source.license}</dd></div><div><dt>子集 SHA-256</dt><dd>{report.source.subsetSha256}</dd></div></dl></details>
  </section>;
}
