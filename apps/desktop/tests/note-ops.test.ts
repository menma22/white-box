import { describe, expect, it } from 'vitest'
import { selectDueNotes } from '@white-box/core/notes'
import { createNote, updateNote, archiveNote, markNoteReminded } from '../src/domain/note-ops.js'
import { createNoteHandlers } from '../src/app/note-handlers.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('ノートの変更', () => {
  it('保存失敗では作成・更新・アーカイブのメモリ変更を戻し、同じ入力で再送できる', () => {
    const ctx = fakeCtx()
    ctx.store.data.notes = createNote(ctx.store.data, { body: '保存された本文' }, 100, 'n').notes
    const original = ctx.store.data.notes
    const handlers = createNoteHandlers(ctx)
    ctx.publish = () => { throw new Error('disk failed') }
    expect(() => handlers['note:create']({ body: '未保存の新規' })).toThrow('disk failed')
    expect(ctx.store.data.notes).toEqual(original)
    expect(() => handlers['note:update']({ id: 'n', patch: { body: '書きかけ' } })).toThrow('disk failed')
    expect(ctx.store.data.notes).toEqual(original)
    expect(() => handlers['note:archive']({ id: 'n', archived: true })).toThrow('disk failed')
    expect(ctx.store.data.notes).toEqual(original)
    ctx.publish = () => { ctx.calls.push('publish') }
    handlers['note:update']({ id: 'n', patch: { body: '書きかけ' } })
    expect(ctx.store.data.notes?.[0]!.body).toBe('書きかけ')
    expect(ctx.calls).toEqual(['publish'])
  })

  it('古いデータを変更せず新規ノートを作れる', () => {
    const db = emptyDb()
    const result = createNote(db, { body: '考えたこと' }, 100, 'n')
    expect(db.notes).toBeUndefined()
    expect(result.notes).toEqual([result.note])
    expect(result.note).toMatchObject({ id: 'n', title: '', body: '考えたこと', pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 100, updatedAt: 100 })
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

  it('アーカイブは本文と予定を残して通知から外し、復元できる', () => {
    const db = emptyDb()
    db.notes = createNote(db, { body: '残す', pinned: true, remindAt: 50 }, 10, 'n').notes
    const original = db.notes
    db.notes = archiveNote(db, 'n', true, 100)
    expect(selectDueNotes(db.notes, 100)).toEqual([])
    expect(db.notes[0]).toMatchObject({ body: '残す', pinned: true, archived: true, remindAt: 50 })
    expect(original[0]!.archived).toBe(false)
    db.notes = archiveNote(db, 'n', false, 110)
    expect(selectDueNotes(db.notes, 110)).toHaveLength(1)
  })

  it('通知の印は同じ期限だけに一度付け、日時変更を再び通知対象にする', () => {
    const db = emptyDb()
    db.notes = createNote(db, { remindAt: 100 }, 10, 'n').notes
    expect(markNoteReminded(db, 'n', 100, 99)[0]!.remindedAt).toBeNull()
    db.notes = markNoteReminded(db, 'n', 100, 110)
    expect(selectDueNotes(db.notes, 120)).toEqual([])
    expect(markNoteReminded(db, 'n', 100, 120)[0]!.remindedAt).toBe(110)
    db.notes = updateNote(db, 'n', { body: '本文のみ' }, 130)
    expect(db.notes[0]!.remindedAt).toBe(110)
    db.notes = updateNote(db, 'n', { remindAt: 150 }, 140)
    expect(db.notes[0]!.remindedAt).toBeNull()
    db.notes = markNoteReminded(db, 'n', 100, 160)
    expect(selectDueNotes(db.notes, 160)).toHaveLength(1)
    db.notes = updateNote(db, 'n', { remindAt: null }, 170)
    expect(selectDueNotes(db.notes, 180)).toEqual([])
  })

  it('全ノート操作が状態を配布し、失敗した入力ではデータを変更しない', () => {
    const ctx = fakeCtx()
    const handlers = createNoteHandlers(ctx)
    const note = handlers['note:create']({ title: '開始', remindAt: ctx.now() })
    handlers['note:update']({ id: note.id, patch: { body: '続き', pinned: true } })
    handlers['note:markReminded']({ id: note.id, remindAt: ctx.now() })
    handlers['note:archive']({ id: note.id, archived: true })
    expect(ctx.calls.filter((call) => call === 'publish')).toHaveLength(4)
    const before = JSON.stringify(ctx.store.data)
    expect(() => handlers['note:update']({ id: note.id, patch: { taskId: 'missing' } })).toThrow()
    expect(JSON.stringify(ctx.store.data)).toBe(before)
  })
})
