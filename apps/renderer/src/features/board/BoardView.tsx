import { useMemo, useRef, useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useApp, useData } from '@/stores/app'
import {
  columnRoots,
  focusByTask,
  nestedChildren,
  projectById,
  projectColor,
  STATUS_LABEL,
  STATUS_NOTE,
  STATUS_ORDER,
} from '@/lib/selectors'
import type { Task, TaskStatus } from '@white-box/core/types'
import { Chip, ProgressBar, Segmented } from '@/components/ui'
import { formatDuration } from '@white-box/core/engine'
import { TaskDetail } from './TaskDetail'
import { GoalTasks } from '@/features/goals/GoalTasks'
import { TaskWarnings } from '@/features/task-control/TaskWarnings'
import { taskControl } from '@white-box/core/task-priority'
import { TaskRiskSummary } from '@/features/task-control/TaskRiskSummary'
import { ExternalWaiting } from './ExternalWaiting'
import { taskBlockReasons, unfinishedPredecessors } from '@white-box/core/task-control'

export function BoardView({ onJumpGoal = () => {}, initialView = 'board', initialTaskId = null, onTaskJumpHandled }: {
  onJumpGoal?: (id: string) => void; initialView?: 'board' | 'list'; initialTaskId?: string | null
  onTaskJumpHandled?: () => void
}) {
  const state = useData()
  const now = useApp((s) => s.now)
  const [filter, setFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<{ status: TaskStatus; index: number } | null>(null)
  const [newProject, setNewProject] = useState('')
  const [addingProject, setAddingProject] = useState(false)
  const [view, setView] = useState<'board' | 'list'>(initialView)
  const [error, setError] = useState('')

  const spent = useMemo(() => focusByTask(state, now), [state.sessions, now])

  function visible(tasks: Task[]): Task[] {
    return filter ? tasks.filter((t) => t.projectId === filter) : tasks
  }

  async function createProject() {
    const name = newProject.trim()
    if (!name) return
    setError('')
    try {
      await invoke('project:create', { name })
      setNewProject('')
      setAddingProject(false)
    } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')) }
  }

  return (
    <div className="board">
      <header className="board-head">
        <div className="board-projects">
          <button type="button" className={`board-proj disp ${filter === null ? 'is-active' : ''}`} onClick={() => setFilter(null)}>
            すべて
          </button>
          {state.projects.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`board-proj disp ${filter === p.id ? 'is-active' : ''}`}
              onClick={() => setFilter(filter === p.id ? null : p.id)}
            >
              <i style={{ background: projectColor(p) }} />
              {p.name}
            </button>
          ))}
          {addingProject ? (
            <input
              className="input board-proj-input"
              placeholder="プロジェクト名"
              value={newProject}
              autoFocus
              onChange={(e) => setNewProject(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createProject()
                if (e.key === 'Escape') setAddingProject(false)
              }}
              onBlur={() => void createProject()}
            />
          ) : (
            <button type="button" className="board-proj-add" title="プロジェクトを追加" onClick={() => setAddingProject(true)}>
              +
            </button>
          )}
        </div>
        <Segmented value={view} onChange={setView} options={[{ value: 'board', label: 'ボード' }, { value: 'list', label: '一覧' }]} />
      </header>

      <TaskWarnings state={state} now={now} projectId={filter} onOpenTask={(id) => { setView('board'); setSelected(id) }} />

      {error && <p className="task-command-error" role="alert">{error}</p>}
      <ExternalWaiting projectId={filter} onSelect={setSelected} />
      {view === 'list' ? <GoalTasks onJump={onJumpGoal} initialTaskId={initialTaskId} onJumpHandled={onTaskJumpHandled} projectId={filter} /> : <>
      <div className="board-cols">
        {STATUS_ORDER.map((status) => {
          const roots = visible(columnRoots(state, status))
          return (
            <section
              key={status}
              className={`col ${dropAt?.status === status ? 'is-over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                const cards = [...e.currentTarget.querySelectorAll('[data-card]')] as HTMLElement[]
                const index = cards.findIndex((c) => e.clientY < c.getBoundingClientRect().top + c.offsetHeight / 2)
                setDropAt({ status, index: index < 0 ? cards.length : index })
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const id = dragId ?? e.dataTransfer.getData('text/task')
                if (id) { setError(''); void invoke('task:move', { id, status, index: dropAt?.index ?? 999 }).catch((cause) => setError(String(cause).replace(/^(Error:\s*)+/, ''))) }
                setDropAt(null)
                setDragId(null)
              }}
            >
              <header className="col-head">
                <span className="col-title disp">{STATUS_LABEL[status]}</span>
                <span className="col-count num">{roots.length}</span>
                <span className="col-note">{STATUS_NOTE[status]}</span>
              </header>

              <QuickAdd status={status} projectId={filter} />

              <div className="col-body">
                {roots.map((task, i) => (
                  <div key={task.id}>
                    {dropAt?.status === status && dropAt.index === i && <div className="drop-line" />}
                    <Card task={task} depth={0} spent={spent} selectedId={selected} onSelect={setSelected} onDragStart={setDragId} dragId={dragId} />
                  </div>
                ))}
                {dropAt?.status === status && dropAt.index >= roots.length && <div className="drop-line" />}
                {roots.length === 0 && <div className="col-empty">まだ何もない</div>}
              </div>
            </section>
          )
        })}
      </div>

      </>}
      {selected && <TaskDetail key={selected} taskId={selected} onClose={() => setSelected(null)} onSelectTask={setSelected} />}
    </div>
  )
}

function QuickAdd({ status, projectId }: { status: TaskStatus; projectId: string | null }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const saving = useRef(false)
  async function submit() {
    const title = value.trim()
    if (!title || saving.current) return
    saving.current = true
    setError('')
    try {
      await invoke('task:create', { title, status, projectId })
      setValue('')
    } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')) } finally { saving.current = false }
  }
  return (
    <div className="col-add-area"><input
      className="col-add"
      placeholder="+ 追加"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void submit()
        if (e.key === 'Escape') setValue('')
      }}
      onBlur={() => void submit()}
    />{error && <p className="task-command-error" role="alert">{error}</p>}</div>
  )
}

function Card({
  task,
  depth,
  spent,
  selectedId,
  onSelect,
  onDragStart,
  dragId,
}: {
  task: Task
  depth: number
  spent: Map<string, number>
  selectedId: string | null
  onSelect: (id: string) => void
  onDragStart: (id: string | null) => void
  dragId: string | null
}) {
  const state = useData()
  const now = useApp((s) => s.now)
  const project = projectById(state, task.projectId)
  const children = nestedChildren(state, task)
  const [open, setOpen] = useState(true)
  const time = spent.get(task.id) ?? 0
  const selected = selectedId === task.id
  const dragging = dragId === task.id
  const blockers = taskBlockReasons(state, task)
  const recommended = unfinishedPredecessors(state, task, 'recommended')

  return (
    <>
      <article
        data-card
        data-task-id={task.id}
        className={`card ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''} ${task.status === 'done' ? 'is-done' : ''}`}
        style={{ marginLeft: depth * 14 }}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/task', task.id)
          e.dataTransfer.effectAllowed = 'move'
          onDragStart(task.id)
        }}
        onDragEnd={() => onDragStart(null)}
        onClick={() => onSelect(task.id)}
      >
        {task.priority === 'high' && <span className="card-flag" title="重要" />}
        <div className="card-title-row">
          {children.length > 0 && (
            <button
              type="button"
              className="card-fold"
              onClick={(e) => {
                e.stopPropagation()
                setOpen((v) => !v)
              }}
            >
              {open ? '▾' : '▸'}
            </button>
          )}
          <span className="card-title">{task.title}</span>
        </div>

        <div className="card-meta">
          {blockers.length > 0 && <Chip title={blockers.join(' / ')}>Blocked</Chip>}
          {recommended.length > 0 && <Chip title={recommended.map((item) => item.task?.title ?? '削除されたタスク').join(' / ')}>推奨順序あり</Chip>}
          {project && <Chip color={projectColor(project)}>{project.name}</Chip>}
          {task.due && <Chip title="締切">{task.due}</Chip>}
          {task.goalNodeId && state.goalMap.nodes[task.goalNodeId] && <Chip title="道標の目標">{state.goalMap.nodes[task.goalNodeId]!.goal || '未入力の目標'}</Chip>}
          {time > 0 && <span className="num card-time">{formatDuration(time, 'compact')}</span>}
          {children.length > 0 && (
            <span className="card-sub disp">
              {children.filter((c) => c.status === 'done').length}/{children.length}
            </span>
          )}
        </div>

        {task.status !== 'done' && task.status !== 'inbox' && <TaskRiskSummary control={taskControl(task, state.sessions, now, state.settings.stallWarningDays)} />}

        {task.status !== 'done' && (task.progress > 0 || task.status === 'doing') && (
          <div className="card-progress">
            <ProgressBar value={task.progress} height={3} />
            <span className="num card-pct">{task.progress}%</span>
          </div>
        )}
      </article>

      {open &&
        children.map((child) => (
          <Card
            key={child.id}
            task={child}
            depth={depth + 1}
            spent={spent}
            selectedId={selectedId}
            onSelect={onSelect}
            onDragStart={onDragStart}
            dragId={dragId}
          />
        ))}
    </>
  )
}
