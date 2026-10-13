import { useEffect, useState } from 'react';
import { FlaskConical, LoaderCircle, Play, RefreshCw, Square, X } from 'lucide-react';
import type { BenchmarkProfile, BenchmarkReport, BenchmarkStatus, BenchmarkSuiteId } from '../../shared/protocol';
import { BENCHMARK_SUITES, benchmarkSuite } from '../../shared/benchmark-catalog';
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
  onStart: (suite: BenchmarkSuiteId, limit: number, profile?: BenchmarkProfile) => Promise<boolean>;
  onCancel: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onLoad: (runId: string) => Promise<void>;
  onOpenURL: (url: string) => void;
  onClose: () => void;
}

const suiteName = (suite: BenchmarkSuiteId) => benchmarkSuite(suite)?.name ?? suite;
const profileName = (profile: BenchmarkProfile) => profile === 'direct' ? '完整上下文' : '文件检索 Agent';
const percent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '未知';
const count = (value: number | null | undefined) => value === null || value === undefined ? '未知' : value.toLocaleString('zh-CN');
const elapsed = (milliseconds: number | null) => milliseconds === null ? '未知' : milliseconds < 1000 ? `${Math.round(milliseconds)} ms` : `${(milliseconds / 1000).toFixed(1)} 秒`;

export function BenchmarksDialog({ status, report, reportId, loading, busy, error, canStart, model, onStart, onCancel, onRefresh, onLoad, onOpenURL, onClose }: Props) {
  const [suite, setSuite] = useState<BenchmarkSuiteId>('bfcl-v4');
  const [limit, setLimit] = useState(20);
  const [profile, setProfile] = useState<BenchmarkProfile>('agent');
  const [validation, setValidation] = useState<string | null>(null);
  const dialogRef = useDialogFocus<HTMLElement>(onClose);
  useEffect(() => { void onRefresh(); }, [onRefresh]);
  const running = status.running;
  const selectedSuite = benchmarkSuite(suite)!;
  const supportsDirect = suite.startsWith('longharness-');

  function selectSuite(value: string) {
    const next = benchmarkSuite(value);
    if (!next) return;
    setSuite(next.id); setLimit(next.defaultLimit); setProfile('agent'); setValidation(null);
  }

  async function start() {
    setValidation(null);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > selectedSuite.total) { setValidation(`题数应为 1 到 ${selectedSuite.total} 的整数。`); return; }
    await onStart(suite, limit, supportsDirect ? profile : undefined);
  }

  return <div className="modal-backdrop" onClick={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="benchmarks-dialog" role="dialog" aria-modal="true" aria-labelledby="benchmarks-title">
      <header className="dialog-header"><h2 id="benchmarks-title"><FlaskConical size={17} />模型与 Harness 评测</h2><button type="button" className="icon-button" aria-label="关闭评测" onClick={onClose}><X size={18} /></button></header>
      <div className="benchmarks-scroll">
        <form className="benchmark-controls" onSubmit={(event) => event.preventDefault()}>
          <div className="benchmark-model">当前模型<strong title={model}>{model || '尚未选择模型'}</strong></div>
          <div className="benchmark-inputs"><label className="field">评测集<select name="benchmarkSuite" data-dialog-autofocus value={suite} disabled={busy || !!running} onChange={(event) => selectSuite(event.target.value)}>{BENCHMARK_SUITES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field">题数<input name="benchmarkLimit" type="number" min={1} max={selectedSuite.total} step={1} value={limit} disabled={busy || !!running} onChange={(event) => setLimit(Number(event.target.value))} /></label></div>
          {supportsDirect && <label className="field">运行方式<select name="benchmarkProfile" value={profile} disabled={busy || !!running} onChange={(event) => setProfile(event.target.value as BenchmarkProfile)}><option value="agent">文件检索 Agent · 按需只读工具</option><option value="direct">完整上下文 · 单次请求</option></select></label>}
          <p className="benchmark-note">{selectedSuite.description} {suite === 'simpleqa' && '作答与另次评分请求使用同一模型。'} 每题空历史，最多 {selectedSuite.total} 题；结果只对比相同版本、样本和运行方式。</p>
          <div className="benchmark-actions"><span className="helper">使用当前连接发送真实模型请求。</span><button type="button" className="primary-button" onClick={() => void start()} disabled={!canStart || busy || loading || !!running}>{busy && !running ? <LoaderCircle size={14} className="spin" /> : <Play size={14} />}开始评测</button></div>
          {!canStart && !running && <p className="helper">连接并启用模型、结束运行中的任务后开始评测。</p>}
        </form>
        {running && <section className="benchmark-progress" aria-label="评测进度" role="status"><div><strong>{suiteName(running.suite)}{running.profile && ` · ${profileName(running.profile)}`}</strong><span>{running.completed} / {running.total}</span></div><progress value={running.completed} max={Math.max(1, running.total)} /><button type="button" className="secondary-button" disabled={busy} onClick={() => void onCancel()}><Square size={12} />停止评测</button></section>}
        {(error || validation) && <p className="inline-error" role="alert">{validation || error}</p>}
        {!!status.reports.length && <section className="benchmark-history"><div className="settings-section-heading">历史报告<button type="button" className="text-button" aria-label="刷新评测报告" disabled={loading} onClick={() => void onRefresh()}>{loading ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}</button></div><div className="benchmark-history-list">{status.reports.map((item) => <button type="button" className={`benchmark-history-item ${item.runId === reportId ? 'selected' : ''}`} key={item.runId} disabled={loading} onClick={() => void onLoad(item.runId)}><span><strong>{suiteName(item.suite)}</strong><small>{item.model} · {item.protocolInvalid ? '调试记录 · 输出协议不完整' : item.mode === 'fixture' ? '模拟验证' : '真实请求'}{item.profile && ` · ${profileName(item.profile)}`}{item.status === 'cancelled' ? ' · 已停止' : ''}</small></span><span>{item.suite === 'letta-context' && '平均奖励 '}{percent(item.mode === 'fixture' || item.protocolInvalid ? null : item.suite === 'letta-context' ? item.meanReward : item.accuracy)}<small>已判分 {item.graded} / {item.total} · 未知 {item.unknown}</small></span></button>)}</div></section>}
        {report && <BenchmarkResult report={report} onOpenURL={onOpenURL} />}
        {!running && !report && !status.reports.length && <p className="benchmark-empty">尚无评测报告。</p>}
      </div>
    </section>
  </div>;
}

function BenchmarkResult({ report, onOpenURL }: { report: BenchmarkReport; onOpenURL: (url: string) => void }) {
  const fixture = report.mode === 'fixture';
  const protocolInvalid = report.suite === 'longharness-tracing' && report.source.adapterProtocol !== 'longharness-task-contract-v3';
  const scoresUnavailable = fixture || protocolInvalid;
  const partialRewards = report.suite === 'letta-context';
  const caseResult = (item: BenchmarkReport['cases'][number]) => {
    if (item.status === 'unknown') return '未知';
    if (typeof item.reward === 'number') return item.reward === 1 ? '正确' : item.reward > 0 ? `部分奖励 ${percent(item.reward)}` : '未通过';
    return item.grade === 'NOT_ATTEMPTED' ? '未作答' : item.status === 'passed' ? '正确' : '未通过';
  };
  return <section className="benchmark-result" aria-label="评测结果">
    <div className="benchmark-result-heading"><h3>{report.name}</h3><span>{protocolInvalid ? '调试记录 · 输出协议不完整' : fixture ? '模拟验证 · 不计模型成绩' : '真实模型请求'}{report.status === 'cancelled' ? ' · 已停止' : ''}</span></div>
    <p className="benchmark-note">{report.model} · {new Date(report.measuredAt).toLocaleString('zh-CN')}</p>
    {protocolInvalid && <p className="inline-error" role="note">此记录未完整说明原题的 answer 对象类型与 evidence 要求，不计入能力成绩；原始逐题输出保留用于调试审查。</p>}
    <div className="benchmark-metrics">{partialRewards && <div><span>平均奖励</span><strong>{percent(scoresUnavailable ? null : report.metrics.meanReward)}</strong><small>部分奖励按原评分值计算</small></div>}<div><span>{partialRewards ? '全正确比例' : '准确率'}</span><strong>{percent(scoresUnavailable ? null : report.metrics.accuracy)}</strong><small>分母为已判分题目</small></div><div><span>已判分 / 全部</span><strong>{report.metrics.graded} / {report.total}</strong><small>正确 {report.metrics.correct} · 错误 {report.metrics.incorrect}</small></div><div><span>未知</span><strong>{report.metrics.unknown}</strong><small>未作答 {report.metrics.notAttempted}</small></div></div>
    <p className="benchmark-note">运行或评分出错计为未知；未知题目不计入准确率{partialRewards && '或平均奖励'}分母。{report.settings.sameModelForGrader && '同模型评分可能存在偏差。'}{fixture && '模拟数据只用于验证评测流程。'}</p>
    <dl className="benchmark-usage"><div><dt>服务商总输入</dt><dd>{count(report.metrics.totalInputTokens)} tokens</dd></div>{report.metrics.inputUsageUnknown && <div><dt>已报告的部分输入</dt><dd>{count(report.metrics.knownInputTokens)} tokens</dd></div>}<div><dt>服务商总输出</dt><dd>{count(report.metrics.totalOutputTokens)} tokens</dd></div><div><dt>本地预计输入</dt><dd>{count(report.metrics.estimatedInputTokens)} tokens</dd></div><div><dt>模型请求 / 工具调用</dt><dd>{count(report.metrics.requestCount)} / {count(report.metrics.toolCallCount)}</dd></div><div><dt>评测耗时</dt><dd>{elapsed(report.metrics.elapsedMs)}</dd></div></dl>
    <details className="benchmark-details"><summary>实际运行配置</summary><dl><div><dt>运行方式</dt><dd>{report.settings.profile ? profileName(report.settings.profile) : '未记录（旧报告）'}</dd></div><div><dt>浏览</dt><dd>{report.settings.browsing ? '启用' : '禁用'}</dd></div><div><dt>每题最多模型轮数</dt><dd>{report.settings.maxAnswerTurns}</dd></div><div><dt>每题独立上下文</dt><dd>{report.settings.freshContextPerTask ? '是' : '否'}</dd></div><div><dt>工具</dt><dd>{report.settings.tools ? report.settings.tools.join('、') || '无工具' : '未记录（旧报告）'}</dd></div><div><dt>推理档位</dt><dd>{report.settings.reasoningEffort || '未记录（旧报告）'}</dd></div><div><dt>每题时限</dt><dd>{report.settings.runTimeoutSeconds === undefined ? '未记录（旧报告）' : `${report.settings.runTimeoutSeconds} 秒`}</dd></div>{report.settings.tokenBudget !== undefined && <div><dt>作答 token 预算</dt><dd>{count(report.settings.tokenBudget)}，完整响应后检查；评分另计，usage 缺失时无法证明遵从</dd></div>}</dl></details>
    <div className="benchmark-case-table"><table><thead><tr><th>题目</th><th>结果</th><th>耗时</th><th>输入 usage</th></tr></thead><tbody>{report.cases.map((item) => <tr key={item.id}><th>{item.id}</th><td>{caseResult(item)}</td><td>{elapsed(item.elapsedMs)}</td><td>{count(item.usage?.totalInput)}</td></tr>)}</tbody></table></div>
    <details className="benchmark-details"><summary>逐题详情</summary>{report.cases.map((item) => <details className="benchmark-case-detail" key={item.id}><summary>{item.id}<span>{caseResult(item)}</span></summary>{item.error && <p className="benchmark-case-error">{item.error}</p>}{item.terminationReason && <p className="benchmark-note">结束原因：{item.terminationReason}</p>}{(item.requestCount !== undefined || item.toolCallCount !== undefined) && <p className="benchmark-note">模型请求 {count(item.requestCount)} · 工具调用 {count(item.toolCallCount)}</p>}{item.answer !== undefined && <pre>{item.answer || '未返回作答文本'}</pre>}{!!item.calls?.length && <pre>{JSON.stringify(item.calls, null, 2)}</pre>}{item.grade && <p className="benchmark-note">评分：{item.grade}</p>}</details>)}</details>
    <details className="benchmark-details"><summary>来源与评分规则</summary><p>{report.suite === 'bfcl-v4' ? 'BFCL v4 原题；单调用 Python AST 规则的本地 TypeScript 移植。' : benchmarkSuite(report.suite)?.description} 本次为固定子集，不对标官方完整榜单。</p><p>{report.grader}</p><a href={report.source.upstream} onClick={(event) => { event.preventDefault(); onOpenURL(report.source.upstream); }}>查看原题来源</a><dl><div><dt>版本</dt><dd>{report.source.revision}</dd></div><div><dt>采样</dt><dd>{report.source.sampling}</dd></div><div><dt>许可</dt><dd>{report.source.license}</dd></div><div><dt>子集 SHA-256</dt><dd>{report.source.subsetSha256}</dd></div></dl></details>
  </section>;
}
