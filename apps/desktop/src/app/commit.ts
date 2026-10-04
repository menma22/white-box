import type { Database } from '@white-box/core/types'
import type { Ctx } from './ports.js'

export function commitChanges(ctx: Ctx, patch: Partial<Database>): void {
  const db = ctx.store.data
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, db[key as keyof Database]]))
  Object.assign(db, patch)
  try { ctx.publish() } catch (cause) { Object.assign(db, before); throw cause }
}
