import { describe, expect, it } from 'vitest'
import { createNote, updateNote, archiveNote } from '../src/domain/note-ops.js'
import { createNoteHandlers } from '../src/app/note-handlers.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('ノートの変更', () => {
  it('古いデータを変更せず新規ノートを作れる', () => {
    const db = emptyDb()
    const result = createNote(db, { body: '考えたこと' }, 100, 'n')
    expect(db.notes).toBeUndefined()
    expect(result.notes).toEqual([result.note])
    expect(result.note).toMatchObject({ id: 'n', title: '', body: '考えたこと', pinned: false, archived: false, createdAt: 100, updatedAt: 100 })
  })

  it('タスクのプロジェクトを導き、存在しない関連先と矛盾した関連先を拒む', () => {
    const db = emptyDb()
    db.projects = [{ id: 'p', name: 'P', hue: 1, archived: false, order: 0, createdAt: 0, updatedAt: 0 }]
    db.tasks = [task({ id: 't', projectId: 'p' })]
    const result = createNote(db, { taskId: 't' }, 100, 'n')
    expect(result.note.projectId).toBe('p')
    expect(() => createNote(db, { taskId: 'missing' }, 100, 'n')).toThrow('タスク')
    expect(() => createNote(db, { projectId: 'missing' }, 100, 'n')).toThrow('プロジェクト')
    expect(() => createNote(db, { projectId: null, taskId: 't' }, 100, 'n')).toThrow('一致')
    db.notes = result.notes
    expect(() => updateNote(db, 'n', { projectId: null }, 200)).toThrow('関連するタスク')
    expect(updateNote(db, 'n', { projectId: null, taskId: null }, 200)[0]).toMatchObject({ projectId: null, taskId: null })
  })

  it('後で関連先が消えても本文を変更でき、他のノートと元の値を保存する', () => {
    const db = emptyDb()
    db.notes = createNote(db, { body: '元の本文' }, 100, 'n').notes
    db.notes[0]!.taskId = 'removed'
    const next = updateNote(db, 'n', { body: '新しい本文', title: undefined }, 200)
    expect(next[0]).toMatchObject({ body: '新しい本文', taskId: 'removed', updatedAt: 200, createdAt: 100 })
    expect(db.notes[0]!.body).toBe('元の本文')
    expect(() => updateNote(db, 'missing', {}, 200)).toThrow('ノート')
  })

  it('アーカイブは本文とピンを残し、復元できる', () => {
    const db = emptyDb()
    db.notes = createNote(db, { body: '残す', pinned: true }, 10, 'n').notes
    const original = db.notes
    db.notes = archiveNote(db, 'n', true, 100)
    expect(db.notes[0]).toMatchObject({ body: '残す', pinned: true, archived: true })
    expect(original[0]!.archived).toBe(false)
    db.notes = archiveNote(db, 'n', false, 110)
    expect(db.notes[0]!.archived).toBe(false)
  })



  it('全ノート操作が状態を配布し、失敗した入力ではデータを変更しない', () => {
    const ctx = fakeCtx()
    const handlers = createNoteHandlers(ctx)
    const note = handlers['note:create']({ title: '開始' })
    handlers['note:update']({ id: note.id, patch: { body: '続き', pinned: true } })
    handlers['note:archive']({ id: note.id, archived: true })
    expect(ctx.calls.filter((call) => call === 'publish')).toHaveLength(3)
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['note:update']({ id: note.id, patch: { taskId: 'missing' } })).toThrow()
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })
})
