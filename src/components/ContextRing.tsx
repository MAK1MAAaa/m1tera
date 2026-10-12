import type { ContextEstimate } from '../../shared/protocol';

interface Props { estimate?: ContextEstimate; onOpen: () => void }
const format = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString('zh-CN');

export function ContextRing({ estimate, onOpen }: Props) {
  const maximum = estimate?.contextWindow;
  const known = typeof maximum === 'number' && maximum > 0 && !!estimate;
  const fraction = known ? estimate.total / maximum : undefined;
  const percentage = fraction === undefined ? undefined : Math.round(fraction * 100);
  const circumference = 2 * Math.PI * 10;
  return <div className="context-ring-wrap">
    <button type="button" className={`context-ring ${fraction !== undefined && fraction >= .9 ? 'context-ring-warning' : ''} ${known ? '' : 'context-ring-unknown'}`} onClick={onOpen} aria-label={`上下文占用：预计 ${format(estimate?.total)} / ${format(maximum)} tokens`} aria-describedby="context-ring-details">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true"><circle className="ring-track" cx="14" cy="14" r="10" /><circle className="ring-fill" cx="14" cy="14" r="10" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - Math.min(1, Math.max(0, fraction ?? 0)))} transform="rotate(-90 14 14)" /></svg>
      <span className="ring-center" aria-hidden="true">{known ? percentage && percentage > 0 ? percentage < 100 ? percentage : '!' : '·' : '?'}</span>
    </button>
    <div className="context-ring-tooltip" id="context-ring-details" role="tooltip"><strong>上下文占用</strong><span>预计输入 <b>{format(estimate?.total)}</b> tokens</span><span>当前可用上限 <b>{format(maximum)}</b>{maximum ? ' tokens' : ''}</span><span className="ring-tooltip-note">{known ? `${percentage}% · 本地估算` : '尚无法计算占用比例'} · 点击查看详情</span></div>
  </div>;
}
