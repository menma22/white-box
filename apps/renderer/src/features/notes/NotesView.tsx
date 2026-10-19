import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { AppState } from '@white-box/core/types'
import { noteTitle, selectNotes, type Note } from '@white-box/core/notes'
import { Button } from '@/components/ui'
import { invoke } from '@/lib/bridge'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'

export interface NotesViewHandle { flush(): Promise<boolean> }

export const NotesView = forwardRef<NotesViewHandle, {
  data: AppState; now?: number; initialNoteId?: string | null; onJumpHandled?: () => void
}>(function NotesView({ data, now = Date.now(), initialNoteId, onJumpHandled }, ref) {
  const [query, setQuery] = useState('')
  const [project, setProject] = useState('all')
  const [pinned, setPinned] = useState(false)
  const [archived, setArchived] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(initialNoteId ?? null)
  const [createdNote, setCreatedNote] = useState<Note | null>(null)
  const [creating, setCreating] = useState(false)
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const handledJump = useRef<string | null>(null)
  const editor = useRef<NoteEditorHandle | null>(null)
  useImperativeHandle(ref, () => ({ flush: () => editor.current?.flush() ?? Promise.resolve(true) }), [])
  const notes = selectNotes(data.notes, { query, archived, pinnedOnly: pinned, projectId: project === 'all' ? undefined : project === 'none' ? null : project })
  const selected = data.notes?.find((note) => note.id === selectedId) ?? (createdNote?.id === selectedId ? createdNote : null)

  useEffect(() => {
    if (!initialNoteId) { handledJump.current = null; return }
    if (handledJump.current === initialNoteId || busy.current) return
    void (async () => {
      busy.current = true
      setChanging(true)
      handledJump.current = initialNoteId
      try {
        if (await editor.current?.flush() === false) return
        setSelectedId(initialNoteId)
      } finally { busy.current = false; setChanging(false); onJumpHandled?.() }
    })()
  }, [initialNoteId, selectedId, onJumpHandled, changing])

  async function choose(id: string): Promise<void> {
    if (busy.current || id === selectedId) return
    busy.current = true
    setChanging(true)
    try { if (await editor.current?.flush() !== false) { setSelectedId(id); setError('') } }
    finally { busy.current = false; setChanging(false) }
  }

  async function create(): Promise<void> {
    if (busy.current) return
    busy.current = true
    setChanging(true)
    setCreating(true)
    try {
      if (await editor.current?.flush() === false) return
      const note = await invoke('note:create', { projectId: project === 'all' || project === 'none' ? null : project })
      if (!note) throw new Error('ノートの作成は White Box アプリで使える')
      setCreatedNote(note)
      setSelectedId(note.id)
      setArchived(false)
      setQuery('')
      setPinned(false)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setCreating(false); busy.current = false; setChanging(false) }
  }

  async function archive(value: boolean): Promise<void> {
    if (!selected || busy.current) return
    busy.current = true
    setChanging(true)
    try {
      if (await editor.current?.flush() === false) return
      await invoke('note:archive', { id: selected.id, archived: value })
      setSelectedId(null)
      setCreatedNote(null)
      setError('')
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { busy.current = false; setChanging(false) }
  }

  return <div className="notes-view" inert={changing} aria-busy={changing}>
    <header className="notes-header"><div><h1>ノート</h1><p>思考を残して、続きへ戻る。</p></div><Button variant="solid" size="sm" disabled={creating} onClick={() => void create()}>{creating ? '作成中…' : 'ノートを追加'}</Button></header>
    {error && <div className="note-error" role="alert">{error}</div>}
    <div className="notes-workspace">
      <aside className="notes-sidebar" aria-label="ノート一覧">
        <input type="search" className="input" aria-label="ノートを検索" placeholder="タイトル・本文を検索" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="input" aria-label="プロジェクトで絞り込み" value={project} onChange={(event) => setProject(event.target.value)}><option value="all">すべてのプロジェクト</option><option value="none">関連付けなし</option>{data.projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <div className="notes-filters"><label><input type="checkbox" checked={pinned} onChange={(event) => setPinned(event.target.checked)} />気に留めている</label><label><input type="checkbox" checked={archived} onChange={(event) => setArchived(event.target.checked)} />アーカイブ</label></div>
        <span className="notes-count">{notes.length}件</span>
        <div className="notes-list">{notes.map((note) => <button key={note.id} type="button" className={`note-list-item${selectedId === note.id ? ' note-list-selected' : ''}`} aria-pressed={selectedId === note.id} onClick={() => void choose(note.id)}>
          <span className="note-list-title">{note.pinned && <span className="note-list-pin" aria-label="ピン留め">● </span>}{noteTitle(note)}</span>
          <span className="note-list-preview">{note.body.trim() || '本文はまだない'}</span>
          <span className="note-list-meta">{new Date(note.updatedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}{note.remindAt !== null && ' · リマインドあり'}</span>
        </button>)}{!notes.length && <p className="notes-empty-list">{query || pinned || project !== 'all' ? '条件に合うノートはない。' : archived ? 'アーカイブしたノートはない。' : 'まだノートはない。浮かんだことを残しておこう。'}</p>}</div>
      </aside>
      {selected ? <NoteEditor key={selected.id} ref={editor} note={selected} projects={data.projects} tasks={data.tasks} now={now} onArchive={(value) => void archive(value)} /> : <div className="notes-empty-editor"><h2>続きへ戻る場所</h2><p>ノートを選ぶか、新しく書き始めよう。</p><Button variant="primary" disabled={creating} onClick={() => void create()}>ノートを書く</Button></div>}
    </div>
  </div>
})
