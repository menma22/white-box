import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Note } from '@white-box/core/notes'
import type { Project, Task } from '@white-box/core/types'
import { Button } from '@/components/ui'
import { invoke } from '@/lib/bridge'
import { NoteAutosave } from './note-autosave'

export interface NoteEditorHandle { flush(): Promise<boolean> }

export function localDateTime(timestamp: number | null): string {
  if (timestamp === null) return ''
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const NoteEditor = forwardRef<NoteEditorHandle, {
  note: Note; projects: Project[]; tasks: Task[]; now: number; onArchive: (archived: boolean) => void; compact?: boolean
}>(function NoteEditor({ note, projects, tasks, now, onArchive, compact = false }, ref) {
  const controller = useRef<NoteAutosave | null>(null)
  if (!controller.current) controller.current = new NoteAutosave(note, (patch) => invoke('note:update', { id: note.id, patch }))
  const autosave = controller.current
  const [state, setState] = useState(() => autosave.snapshot())
  useImperativeHandle(ref, () => ({ flush: () => autosave.flush() }), [autosave])
  useEffect(() => {
    const unsubscribe = autosave.subscribe(setState)
    return () => { unsubscribe(); void autosave.flush() }
  }, [autosave])
  useEffect(() => { autosave.receive(note) }, [autosave, note])
  const draft = state.draft
  const linkedProject = projects.find((project) => project.id === draft.projectId)
  const linkedTask = tasks.find((task) => task.id === draft.taskId)
  const options = tasks.filter((task) => task.projectId === draft.projectId || task.id === draft.taskId)
  const savingText = { saved: '保存済み', dirty: '保存待ち', saving: '保存中…', error: '保存できなかった' }[state.status]
  return <section className="note-editor" aria-label="ノートを編集" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) void autosave.flush()
  }} onKeyDown={(event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void autosave.flush() }
  }}>
    <div className="note-editor-toolbar">
      <label className="note-pin"><input type="checkbox" checked={draft.pinned} onChange={(event) => autosave.update({ pinned: event.target.checked })} />気に留めておく</label>
      <span role="status" className={`note-save-status note-save-${state.status}`}>{savingText}</span>
      <Button size="sm" onClick={() => onArchive(!note.archived)}>{note.archived ? '一覧に戻す' : 'アーカイブ'}</Button>
    </div>
    {state.error && <div className="note-error" role="alert"><span>保存できなかった：{state.error}。入力はこの画面に残っている。</span><Button size="sm" onClick={() => void autosave.flush()}>もう一度保存</Button></div>}
    {note.archived && <p className="note-archive-label">アーカイブ中。リマインドは止まっている。</p>}
    <input className="note-title-input" aria-label="ノートのタイトル" placeholder="タイトル" value={draft.title} autoFocus onChange={(event) => autosave.update({ title: event.target.value })} />
    {!compact && <div className="note-links">
      <label>プロジェクト<select className="input" aria-label="ノートのプロジェクト" value={draft.projectId ?? ''} onChange={(event) => autosave.update({ projectId: event.target.value || null, taskId: null })}>
        <option value="">関連付けなし</option>
        {draft.projectId && !linkedProject && <option value={draft.projectId}>（削除されたプロジェクト）</option>}
        {projects.filter((project) => !project.archived || project.id === draft.projectId).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select></label>
      <label>タスク<select className="input" aria-label="ノートのタスク" value={draft.taskId ?? ''} onChange={(event) => {
        const task = tasks.find((item) => item.id === event.target.value)
        autosave.update({ taskId: task?.id ?? null, ...(task ? { projectId: task.projectId } : {}) })
      }}>
        <option value="">関連付けなし</option>
        {draft.taskId && !linkedTask && <option value={draft.taskId}>（削除されたタスク）</option>}
        {options.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
      </select></label>
    </div>}
    <textarea className="note-body-input" aria-label="ノートの本文" placeholder="浮かんだこと、次に戻る場所を書いておく。" value={draft.body} onChange={(event) => autosave.update({ body: event.target.value })} />
    <div className="note-reminder-control"><label>思い出す日時<input className="input" type="datetime-local" aria-label="リマインドの日時" value={localDateTime(draft.remindAt)} onChange={(event) => {
      if (!event.target.value) autosave.update({ remindAt: null })
      else { const timestamp = new Date(event.target.value).getTime(); if (Number.isFinite(timestamp)) autosave.update({ remindAt: timestamp }) }
    }} /></label>
      <Button size="sm" onClick={() => autosave.update({ remindAt: now + 60 * 60 * 1000 })}>1時間後</Button>
      <Button size="sm" onClick={() => autosave.update({ remindAt: now + 24 * 60 * 60 * 1000 })}>明日</Button>
      {draft.remindAt !== null && <Button size="sm" onClick={() => autosave.update({ remindAt: null })}>日時を外す</Button>}
    </div>
    <p className="note-editor-hint">入力は自動で保存する。Ctrl + S でも保存できる。</p>
  </section>
})
