import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import type { Task } from '@white-box/core/types'
import { noteTitle, type Note } from '@white-box/core/notes'
import { useApp, useData } from '@/stores/app'
import { invoke } from '@/lib/bridge'
import { NoteEditor, type NoteEditorHandle } from '@/features/notes/NoteEditor'

export const TaskLinkedNotes = forwardRef<NoteEditorHandle, { task: Task }>(function TaskLinkedNotes({ task }, ref) {
  const state = useData()
  const now = useApp((app) => app.now)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [created, setCreated] = useState<Note | null>(null)
  const [archived, setArchived] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const editor = useRef<NoteEditorHandle | null>(null)
  const disclosure = useRef<HTMLDetailsElement | null>(null)
  async function flush(): Promise<boolean> {
    const ok = await editor.current?.flush() !== false
    if (!ok && disclosure.current) disclosure.current.open = true
    return ok
  }
  useImperativeHandle(ref, () => ({ flush }))
  const notes = (state.notes ?? []).filter((note) => note.taskId === task.id && note.archived === archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt)
  const selected = state.notes?.find((note) => note.id === selectedId) ?? (created?.id === selectedId ? created : null)

  async function run(action: () => Promise<void>) {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    setError('')
    try { if (await flush()) await action() }
    catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')) }
    finally { busy.current = false; setSaving(false) }
  }

  return <details ref={disclosure} className="phase2-disclosure">
    <summary>このタスクの関連ノート <span>{notes.length} 件</span></summary>
    <div className="task-context-notes">
      <div className="phase2-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => void run(async () => {
        const note = await invoke('note:create', { taskId: task.id, projectId: task.projectId })
        setCreated(note)
        setSelectedId(note.id)
        setArchived(false)
      })}>関連ノートを書く</button>
        <label className="phase2-hint"><input type="checkbox" checked={archived} onChange={(event) => { const value = event.target.checked; void run(async () => { setArchived(value); setSelectedId(null) }) }} /> アーカイブを表示</label>
      </div>
      {error && <p className="task-command-error" role="alert">{error}</p>}
      {notes.map((note) => <button key={note.id} type="button" className={`task-context-note-title ${selectedId === note.id ? 'is-selected' : ''}`} aria-pressed={selectedId === note.id} onClick={() => void run(async () => { setSelectedId(note.id) })}>{note.pinned ? '● ' : ''}{noteTitle(note)}</button>)}
      {!notes.length && !selected && <p className="phase2-hint">長い記録や資料は、タスクに結び付けたノートに残せる。</p>}
      {selected && <NoteEditor key={selected.id} ref={editor} compact note={selected} projects={state.projects} tasks={state.tasks} now={now} onArchive={(value) => void run(async () => {
        await invoke('note:archive', { id: selected.id, archived: value })
        setSelectedId(null)
        setCreated(null)
      })} />}
    </div>
  </details>
})
