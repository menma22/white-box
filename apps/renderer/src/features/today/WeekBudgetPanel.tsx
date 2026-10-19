import type { AppState, ProjectAllocation } from '@white-box/core/types'
import { weeklyBudgetSummary, allocationBounds } from '@white-box/core/weekly-budget'
import { calendarProjectUsage } from '@white-box/core/calendar'
import { formatDuration } from '@white-box/core/engine'
import { projectColor } from '@/lib/selectors'

const duration = (minutes: number) => (minutes < 0 ? '−' : '') + formatDuration(Math.abs(minutes) * 60_000, 'compact')
function allocationLabel(item: ProjectAllocation) {
  if (item.mode === 'unlimited') return '上限なし'
  if (item.mode === 'minimum') return '最低 ' + duration(item.minutes)
  if (item.mode === 'maximum') return '上限 ' + duration(item.minutes)
  if (item.mode === 'range') return duration(item.minimumMinutes) + '〜' + duration(item.maximumMinutes)
  return ''
}
export function WeekBudgetPanel({ state, start, now, onEdit }: { state: AppState; start: string; now: number; onEdit: () => void }) {
  const summary = weeklyBudgetSummary(state, start)
  const budget = state.weeklyBudgets?.find((item) => item.weekStart === start)
  const usage = calendarProjectUsage(state, start, now)
  const projects = [...new Set([...(budget?.allocations.map((item) => item.projectId) ?? []), ...usage.keys()])]
  return <aside className="week-budget-panel" aria-label="週の時間予算とプロジェクト">
    <header><div><span className="label">168 HOURS / WEEK</span><h2>時間の配分</h2></div><button type="button" className="week-budget-edit" aria-label="時間予算を編集" onClick={onEdit}>編集</button></header>
    {summary ? <>
      <div className="week-capacity"><strong className="num">{duration(summary.availableMinutes)}</strong><span>配分できる時間</span></div>
      <div className={'week-unallocated' + (summary.overcommitted ? ' is-over' : '')}><i /><span>{summary.overcommitted ? '最低配分が ' + duration(-summary.unallocatedMinutes) + ' 超過' : '最低配分のあと ' + duration(summary.unallocatedMinutes) + ' 残る'}</span></div>

    </> : <div className="week-budget-empty"><p>この週に、何時間ずつ使う？</p><span>生活時間を確保してから、プロジェクトへ時間を配分できる。</span><button type="button" className="btn btn-solid btn-sm" onClick={onEdit}>時間予算を決める</button></div>}
    <section className="week-projects"><header><h3>プロジェクト</h3><span>予定 / 実績</span></header>
      {projects.length ? projects.map((id) => {
        const project = state.projects.find((item) => item.id === id)
        const item = budget?.allocations.find((allocation) => allocation.projectId === id)
        const used = usage.get(id) ?? { plannedMinutes: 0, actualMinutes: 0, flexibleActualMinutes: 0 }
        const bounds = item ? allocationBounds(item) : null
        const scale = bounds?.maximumMinutes ?? bounds?.minimumMinutes ?? Math.max(used.plannedMinutes, used.actualMinutes)
        const ratio = scale > 0 ? Math.min(100, used.flexibleActualMinutes / scale * 100) : 0
        const over = bounds?.maximumMinutes !== null && bounds?.maximumMinutes !== undefined && used.flexibleActualMinutes > bounds.maximumMinutes
        return <article key={id ?? 'none'} className={'week-project' + (over ? ' is-over' : '')}>
          <div className="week-project-name"><i style={{ background: projectColor(project ?? null) }} /><strong>{project?.name ?? (id ? '削除されたプロジェクト' : 'プロジェクトなし')}</strong></div>
          <div className="week-project-numbers num"><span>{duration(used.plannedMinutes)} <small>予定</small></span><strong>{duration(used.actualMinutes)} <small>実績</small></strong></div>
          {item && <><div className="week-project-progress"><i style={{ width: ratio + '%', background: over ? 'var(--amber)' : projectColor(project ?? null) }} /></div><div className="week-project-allocation"><span>{allocationLabel(item)}</span><span>配分対象 {duration(used.flexibleActualMinutes)}</span></div>{over && <p className="week-budget-note">上限を {duration(used.flexibleActualMinutes - bounds!.maximumMinutes!)} 超過</p>}</>}
        </article>
      }) : <p className="week-budget-note">予定や記録のあるプロジェクトがここに並ぶ。</p>}
      {budget?.allocations.length ? <p className="week-budget-note">配分対象は、外部固定予定の時間帯を除く実作業。</p> : null}
    </section>
    {summary && <details className="week-life-details"><summary><span>生活・固定時間の内訳</span><span className="num">{duration(168 * 60 - summary.availableMinutes)}</span></summary>
      <dl className="week-life-time"><div><dt>睡眠</dt><dd>{duration(summary.sleepMinutes)}</dd></div><div><dt>食事</dt><dd>{duration(summary.mealMinutes)}</dd></div><div><dt>その他の固定時間</dt><dd>{duration(summary.fixedMinutes)}</dd></div><div><dt>外部固定作業</dt><dd>{duration(summary.fixedWorkMinutes)}</dd></div></dl>
      <p className="week-budget-note">生活・外部固定予定の重なりは一度だけ確保。定型時間を含む週の総量。</p>
    </details>}
    <button type="button" className="week-budget-bottom" onClick={onEdit}>配分・生活時間を調整 <span aria-hidden>↗</span></button>
  </aside>
}
