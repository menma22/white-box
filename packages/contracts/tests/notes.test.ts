import { describe, expect, it } from 'vitest'
import { NOTE_COMMANDS, NoteSchema } from '../src/notes.js'

describe('ノートの契約', () => {
  it('新規作成に既定値を任せられ、本文のみ・nullの関連先を許す', () => {
    expect(NOTE_COMMANDS['note:create'].args.parse({})).toEqual({})
    expect(NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { body: '本文', taskId: null } })).toEqual({ id: 'n', patch: { body: '本文', taskId: null } })
  })
  it('綴り違い・識別子の書き換え・未対応の予定日時を拒否する', () => {
    expect(() => NOTE_COMMANDS['note:create'].args.parse({ boddy: '本文' })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { id: 'other' } })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { remindAt: 1 } })).toThrow()
    expect(() => NOTE_COMMANDS['note:archive'].args.parse({ id: 'n', archived: true, delete: true })).toThrow()
  })

  it('保存されたノートの形を検証する', () => {
    expect(NoteSchema.safeParse({ id: 'n', title: '', body: '', projectId: null, taskId: null, pinned: false, archived: false, createdAt: 0, updatedAt: 0 }).success).toBe(true)
    expect(NoteSchema.safeParse({ id: 'n', title: '古い形' }).success).toBe(false)
  })
})
