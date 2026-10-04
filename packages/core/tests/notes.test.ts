import { describe, expect, it } from 'vitest'
import { noteTitle, selectNotes, type Note } from '../src/notes.js'

function note(id: string, patch: Partial<Note> = {}): Note {
  return { id, title: id, body: '', projectId: null, taskId: null, pinned: false, archived: false, createdAt: 1, updatedAt: 1, ...patch }
}

describe('ノートを選ぶ', () => {
  it('古いデータの空一覧と無題に対応する', () => {
    expect(selectNotes(undefined)).toEqual([])
    expect(noteTitle(note('n', { title: ' ', body: ' 続きへ戻る\n詳細' }))).toBe('続きへ戻る')
    expect(noteTitle(note('n', { title: '', body: '' }))).toBe('無題のノート')
  })

  it('タイトルと本文を幅・大文字小文字に依存せず全語で検索する', () => {
    const notes = [note('a', { title: 'ＡＰＩ の設計', body: '次は Worker を実装' }), note('b', { body: 'API の変更' })]
    expect(selectNotes(notes, { query: ' api WORKER ' }).map((item) => item.id)).toEqual(['a'])
    expect(selectNotes(notes, { query: '設計' }).map((item) => item.id)).toEqual(['a'])
  })

  it('関連先とピンとアーカイブを絞り、ピン・更新日時順で返す（入力を並べ替えない）', () => {
    const notes = [note('old', { projectId: 'p' }), note('new', { projectId: 'p', updatedAt: 30 }), note('pin', { projectId: 'p', pinned: true }), note('archived', { projectId: 'p', pinned: true, archived: true })]
    expect(selectNotes(notes, { projectId: 'p' }).map((item) => item.id)).toEqual(['pin', 'new', 'old'])
    expect(selectNotes(notes, { pinnedOnly: true }).map((item) => item.id)).toEqual(['pin'])
    expect(selectNotes(notes, { archived: true }).map((item) => item.id)).toEqual(['archived'])
    expect(selectNotes(notes, { projectId: null })).toEqual([])
    expect(notes.map((item) => item.id)).toEqual(['old', 'new', 'pin', 'archived'])
  })




})
