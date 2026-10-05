import { useState } from 'react'
import type { AppState, Task } from '@white-box/core/types'
import { RISK_LABEL, taskWarnings, type TaskControl } from '@white-box/core/task-priority'
import { taskExecutionProblem } from '@white-box/core/task-control'
import { invoke } from '@/lib/bridge'
import { TaskRiskSummary } from './TaskRiskSummary'
import type { TaskDetailTarget } from '@/features/board/TaskDetail'

export function TaskWarnings({ state, now, onOpenTask, onStarted, projectId = null, compact = false }: {
  state: AppState; now: number; onOpenTask?: (id: string, target?: TaskDetailTarget) => void; onStarted?: () => void
  projectId?: string | null; compact?: boolean
}) {
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const warnings = taskWarnings(state.tasks, state.sessions, now, state.settings.stallWarningDays)
    .filter((control) => !projectId || control.task.projectId === projectId)
    .filter((control) => !state.projects.some((project) => project.id === control.task.projectId && project.archived))
  const open = expanded ?? (!compact && !state.live && warnings.length <= 3)
  const highest = warnings[0]
  if (!highest) return null
  async function run(action: () => Promise<unknown>) {
    try { await action(); setError('') } catch (cause) { setError(cause instanceof Error ? cause.message : '保存できなかった'); setExpanded(true) }
  }
  return <section className="task-warnings" aria-label="タスクの警告">
    {error && <p className="task-control-error" role="alert">{error}</p>}
    <details data-warning-disclosure open={open} onToggle={(event) => {
      if (event.currentTarget.open !== open) setExpanded(event.currentTarget.open)
    }}>
      <summary className="task-warning-toggle" data-warning-toggle>
        <span className="task-warning-summary">
          <span className="label">現在の警告 · {warnings.length}件</span>
          <span className="task-warning-summary-reason">{RISK_LABEL[highest.risk]} · {warningReasons(highest)[0]}</span>
        </span>
        <span className="task-warning-toggle-action">{open ? '折り畳む' : '確認する'}</span>
      </summary>
      <div className="task-warning-list" onFocusCapture={() => setExpanded(true)}>
        {warnings.map((control) => {
          const problem = taskExecutionProblem(state, control.task.id) ?? (state.live ? 'すでにセッションが動いている' : null)
          return <article className="task-warning" key={control.task.id} data-warning-task={control.task.id}>
            <div className="task-warning-body">
              {onOpenTask ? <button type="button" className="task-warning-title" onClick={() => onOpenTask(control.task.id)}>{control.task.title}</button> : <strong className="task-warning-title">{control.task.title}</strong>}
              <TaskRiskSummary control={control} />
              <p className="task-warning-reasons">
                {warningReasons(control).join(' ')}
              </p>
              {problem && <p className="task-control-hint" data-warning-execution>開始できない理由: {problem}</p>}
            </div>
            <div className="task-warning-actions">
              <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(problem)} title={problem ?? ''} onClick={() => void run(async () => { const session = await invoke('session:start', { taskId: control.task.id, minutes: state.settings.defaultSessionMinutes }); if (session) onStarted?.() })}>今やる</button>
              <select className="input" aria-label={`${control.task.title}の重要度`} value={control.task.priority} onChange={(event) => void run(() => invoke('task:update', { id: control.task.id, patch: { priority: event.target.value as Task['priority'] } }))}>
                <option value="low">重要度: 低</option><option value="normal">重要度: 普通</option><option value="high">重要度: 重要</option>
              </select>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void run(() => invoke('task:move', { id: control.task.id, status: 'inbox', index: 0 }))}>Inbox へ戻す</button>
              {onOpenTask && <button type="button" className="btn btn-ghost btn-sm" data-warning-organize onClick={() => onOpenTask(control.task.id, { section: 'waiting' })}>待ち・先行タスクを整理</button>}
            </div>
          </article>
        })}
        <p className="task-control-hint">Slack は暦時間の余裕。休息・他の仕事・稼働可能時間は差し引かない。未入力の見積・安全余裕は不明として扱う。</p>
      </div>
    </details>
  </section>
}

function warningReasons(control: TaskControl): string[] {
  return [
    ...(control.reasons.includes('deadline-passed') ? [`締切 ${control.task.due} を過ぎている。`] : []),
    ...(control.reasons.includes('negative-slack') ? ['残作業と安全余裕が、締切までの暦時間を上回っている。'] : []),
    ...(control.reasons.includes('aging') ? [`Todo の作業・進捗の更新がない期間: ${Math.floor(control.agingDays!)}日。`] : []),
  ]
}
