import { randomUUID } from 'node:crypto'
import type { ArgsOf, ResultOf } from '@white-box/contracts'
import type { NOTE_COMMANDS } from '@white-box/contracts'
import * as ops from '../domain/note-ops.js'
import type { Ctx } from './ports.js'

type NoteHandlers = { [N in keyof typeof NOTE_COMMANDS]: (args: ArgsOf<N>) => ResultOf<N> }

export function createNoteHandlers(ctx: Ctx): NoteHandlers {
  const db = () => ctx.store.data
  return {
    'note:create': (args) => {
      const result = ops.createNote(db(), args, ctx.now(), randomUUID())
      db().notes = result.notes
      ctx.publish()
      return result.note
    },
    'note:update': (args) => {
      db().notes = ops.updateNote(db(), args.id, args.patch, ctx.now())
      ctx.publish()
      return null
    },
    'note:archive': (args) => {
      db().notes = ops.archiveNote(db(), args.id, args.archived, ctx.now())
      ctx.publish()
      return null
    },
    'note:markReminded': (args) => {
      db().notes = ops.markNoteReminded(db(), args.id, args.remindAt, ctx.now())
      ctx.publish()
      return null
    },
  }
}
