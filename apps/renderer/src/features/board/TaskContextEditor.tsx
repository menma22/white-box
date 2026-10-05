import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Task } from '@white-box/core/types'
import { invoke } from '@/lib/bridge'
import type { NoteEditorHandle } from '@/features/notes/NoteEditor'
import { TaskLinkedNotes } from './TaskLinkedNotes'
import { useDraftParticipant } from '@/lib/useEditorFlush'

const fields = ['notes', 'problems', 'decisions', 'nextContext'] as const
type ContextDraft = Record<typeof fields[number], string>
const labels: Record<typeof fields[number], string> = { notes: 'メモ', problems: '問題', decisions: '決定', nextContext: '次にすること・再開の手がかり' }
const placeholders: Record<typeof fields[number], string> = { notes: 'このタスクについて残しておくこと', problems: 'まだ解けていないこと、試して分かったこと', decisions: '何を決めたか、その理由', nextContext: '戻ったら最初にすること、開く資料、覚えておく注意点' }

function contextDraft(task: Task): ContextDraft {
  return { notes: task.notes, problems: task.problems ?? '', decisions: task.decisions ?? '', nextContext: task.nextContext ?? '' }
}

export const TaskContextEditor = forwardRef<NoteEditorHandle, { task: Task }>(function TaskContextEditor({ task }, ref) {
  const [draft, setDraft] = useState(() => contextDraft(task))
  const saved = useRef(contextDraft(task))
  const currentDraft = useRef(draft)
  currentDraft.current = draft
  const [saving, setSaving] = useState(false)
  const [flushing, setFlushing] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<typeof fields[number] | null>(null)
  const running = useRef<Promise<boolean> | null>(null)
  const flushingRequest = useRef<Promise<boolean> | null>(null)
  const notes = useRef<NoteEditorHandle | null>(null)
  const dirty = fields.some((field) => draft[field] !== saved.current[field])

  useEffect(() => {
    const incoming = contextDraft(task)
    const previous = saved.current
    saved.current = incoming
    setDraft((current) => {
      const next = { ...current }
      for (const field of fields) if (current[field] === previous[field]) next[field] = incoming[field]
      return next
    })
  }, [task.notes, task.problems, task.decisions, task.nextContext])

  function save(): Promise<boolean> {
    if (running.current) return running.current
    const value = { ...currentDraft.current }
    const patch = Object.fromEntries(fields.filter((field) => value[field] !== saved.current[field]).map((field) => [field, value[field]])) as Partial<ContextDraft>
    if (!Object.keys(patch).length) return Promise.resolve(true)
    setSaving(true)
    setError('')
    running.current = invoke('task:update', { id: task.id, patch })
      .then(() => { saved.current = { ...saved.current, ...patch }; return true })
      .catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; setSaving(false) })
    return running.current
  }

  function flush(): Promise<boolean> {
    if (flushingRequest.current) return flushingRequest.current
    setFlushing(true)
    flushingRequest.current = (async () => await save() && await notes.current?.flush() !== false)()
      .finally(() => { flushingRequest.current = null; setFlushing(false) })
    return flushingRequest.current
  }
  useImperativeHandle(ref, () => ({ flush }))
  useDraftParticipant(flush)

  return <section className="task-context" aria-label="タスクの文脈" data-task-context-id={task.id}>
    <fieldset className="task-context-lock" disabled={flushing}>
    <h3 className="task-context-heading">続きへ戻る手がかり</h3>
    {(['nextContext', 'notes', 'problems', 'decisions'] as const).filter((key) => draft[key].trim()).map((key) => <details key={key} className="task-context-record" open={key === 'nextContext' ? true : undefined}><summary>{labels[key]}</summary><p>{draft[key]}</p><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(key)}>編集</button></details>)}
    {!fields.some((key) => draft[key].trim()) && <p className="phase2-hint">必要になったことだけ残せる。再開の手がかりは、開始するときにも見える。</p>}
    {!editing && <div className="phase2-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing('nextContext')}>手がかりを残す</button></div>}
    {editing && <div className="task-context-fields">
      <label>書く内容<select className="input" aria-label="文脈の種類" value={editing} onChange={(event) => setEditing(event.target.value as typeof fields[number])}>{fields.map((key) => <option key={key} value={key}>{labels[key]}</option>)}</select></label>
      <label>{labels[editing]}<textarea className="input" rows={4} aria-label={labels[editing]} placeholder={placeholders[editing]} value={draft[editing]} disabled={saving || flushing} onChange={(event) => { if (flushingRequest.current) return; setDraft({ ...draft, [editing]: event.target.value }); setError('') }} /></label>
    </div>}
    {error && <p className="task-command-error" role="alert">保存できなかった。{error} 入力は残っている。</p>}
    {(editing || dirty) && <div className="phase2-actions"><button type="button" className="btn btn-primary btn-sm" disabled={saving || !dirty} onClick={() => void save().then((ok) => { if (ok) setEditing(null) })}>{saving ? '保存中…' : '文脈を保存'}</button><span role="status">{saving ? '保存中' : error ? '未保存' : dirty ? '未保存の変更あり' : '保存済み'}</span>{!dirty && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(null)}>編集を閉じる</button>}</div>}
    <TaskLinkedNotes ref={notes} task={task} />
    </fieldset>
  </section>
})
