import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Note } from '@white-box/core/notes'
import type { Project, Task } from '@white-box/core/types'
import { Button } from '@/components/ui'
import { invoke } from '@/lib/bridge'
import { NoteAutosave } from './note-autosave'

export interface NoteEditorHandle { flush(): Promise<boolean> }


export const NoteEditor = forwardRef<NoteEditorHandle, {
  note: Note; projects: Project[]; tasks: Task[]; onArchive: (archived: boolean) => void
}>(function NoteEditor({ note, projects, tasks, onArchive }, ref) {
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
    {note.archived && <p className="note-archive-label">アーカイブ中。</p>}
    <input className="note-title-input" aria-label="ノートのタイトル" placeholder="タイトル" value={draft.title} autoFocus onChange={(event) => autosave.update({ title: event.target.value })} />
    <div className="note-links">
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
    </div>
    <textarea className="note-body-input" aria-label="ノートの本文" placeholder="浮かんだこと、次に戻る場所を書いておく。" value={draft.body} onChange={(event) => autosave.update({ body: event.target.value })} />
    <p className="note-editor-hint">入力は自動で保存する。Ctrl + S でも保存できる。</p>
  </section>
})
