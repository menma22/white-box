import { randomUUID } from 'node:crypto'
import type { ArgsOf, ResultOf } from '@white-box/contracts'
import type { NOTE_COMMANDS } from '@white-box/contracts'
import { commitChanges } from './commit.js'
import * as ops from '../domain/note-ops.js'
import type { Ctx } from './ports.js'

type NoteHandlers = { [N in keyof typeof NOTE_COMMANDS]: (args: ArgsOf<N>) => ResultOf<N> }

export function createNoteHandlers(ctx: Ctx): NoteHandlers {
  const db = () => ctx.store.data
  return {
    'note:create': (args) => {
      const result = ops.createNote(db(), args, ctx.now(), randomUUID())
      commitChanges(ctx, { notes: result.notes })
      return result.note
    },
    'note:update': (args) => {
      commitChanges(ctx, { notes: ops.updateNote(db(), args.id, args.patch, ctx.now()) })
      return null
    },
    'note:archive': (args) => {
      commitChanges(ctx, { notes: ops.archiveNote(db(), args.id, args.archived, ctx.now()) })
      return null
    },
    'note:markReminded': (args) => {
      commitChanges(ctx, { notes: ops.markNoteReminded(db(), args.id, args.remindAt, ctx.now()) })
      return null
    },
  }
}
