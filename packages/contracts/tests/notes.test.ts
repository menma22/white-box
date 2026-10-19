import { describe, expect, it } from 'vitest'
import { NOTE_COMMANDS, NoteSchema } from '../src/notes.js'

describe('ノートの契約', () => {
  it('新規作成に既定値を任せられ、本文のみ・nullの関連先を許す', () => {
    expect(NOTE_COMMANDS['note:create'].args.parse({})).toEqual({})
    expect(NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { body: '本文', taskId: null } })).toEqual({ id: 'n', patch: { body: '本文', taskId: null } })
  })
  it('綴り違い・識別子の書き換え・通知済みの直接変更を拒否する', () => {
    expect(() => NOTE_COMMANDS['note:create'].args.parse({ boddy: '本文' })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { id: 'other' } })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ id: 'n', patch: { remindedAt: 1 } })).toThrow()
    expect(() => NOTE_COMMANDS['note:archive'].args.parse({ id: 'n', archived: true, delete: true })).toThrow()
  })
  it('項目ごとの期待値を受け取り、その型とキーを厳密に検証する', () => {
    const args = { id: 'n', patch: { body: '自分の本文' }, expected: { body: '元の本文', taskId: null } }
    expect(NOTE_COMMANDS['note:update'].args.parse(args)).toEqual(args)
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ ...args, expected: { body: 1 } })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ ...args, expected: { updatedAt: 1 } })).toThrow()
    expect(() => NOTE_COMMANDS['note:update'].args.parse({ ...args, expected: { boddy: '元の本文' } })).toThrow()
  })
  it('不正な日時と予定日時を持たない通知完了を拒否する', () => {
    for (const remindAt of [-1, 1.5, Infinity, NaN, 8_640_000_000_000_001]) expect(() => NOTE_COMMANDS['note:create'].args.parse({ remindAt })).toThrow()
    expect(() => NOTE_COMMANDS['note:markReminded'].args.parse({ id: 'n' })).toThrow()
  })
  it('予定のない旧ノートに日時の初期値を補い、本文と関連先を保持する', () => {
    const legacy = { id: 'n', title: '続き', body: '本文', projectId: 'p', taskId: 't', pinned: true, archived: false, createdAt: 0, updatedAt: 0 }
    expect(NoteSchema.parse(legacy)).toEqual({ ...legacy, remindAt: null, remindedAt: null })
  })
  it('保存されたノートの形を検証する', () => {
    expect(NoteSchema.safeParse({ id: 'n', title: '', body: '', projectId: null, taskId: null, pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 0, updatedAt: 0 }).success).toBe(true)
    expect(NoteSchema.safeParse({ id: 'n', title: '古い形' }).success).toBe(false)
  })
})
