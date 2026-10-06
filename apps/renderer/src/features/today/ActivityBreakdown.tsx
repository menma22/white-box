import type { AppState } from '@white-box/core/types'
import type { ActivitySummary } from '@white-box/core/activity'
import { formatDuration } from '@white-box/core/engine'
import { ProgressBar } from '@/components/ui'
import { projectById, projectColor, taskById } from '@/lib/selectors'

export function ActivityBreakdown({ state, summary }: { state: AppState; summary: ActivitySummary }) {
  const projects = [...summary.projectMs].sort((a, b) => b[1] - a[1])
  const tasks = [...summary.taskMs].sort((a, b) => b[1] - a[1])
  return (
    <div className="activity-breakdown">
      <section className="activity-panel" aria-label="プロジェクト別時間">
        <h2>プロジェクト別時間</h2>
        {projects.length === 0 && <p className="activity-empty">実作業の記録はまだない。</p>}
        {projects.map(([id, ms]) => {
          const project = projectById(state, id)
          return <div className="activity-entry" key={id ?? 'none'}>
            <span className="activity-name"><i className="srow-dot" style={{ background: projectColor(project) }} />{project?.name ?? 'プロジェクトなし・削除済み'}</span>
            <span className="num">{formatDuration(ms, 'compact')}</span>
          </div>
        })}
      </section>
      <section className="activity-panel" aria-label="進めたタスク">
        <h2>進めたタスク</h2>
        {tasks.length === 0 && <p className="activity-empty">実作業の記録はまだない。</p>}
        {tasks.map(([id, ms]) => {
          const task = taskById(state, id)
          return <div className="activity-task" key={id ?? 'none'}>
            <div className="activity-entry"><span>{task?.title ?? (id === null ? '未割当の記録' : '（削除されたタスク）')}</span><span className="num">{formatDuration(ms, 'compact')}</span></div>
            {task && <div className="activity-progress"><ProgressBar value={task.progress} /><span className="num">現在 {task.progress}%{task.status === 'done' ? '・完了' : ''}</span></div>}
          </div>
        })}
      </section>
    </div>
  )
}
