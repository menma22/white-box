import type { Database } from '@white-box/core/types'
import type { Ctx } from './ports.js'

export function commitChanges(ctx: Ctx, patch: Partial<Database>): void {
  const db = ctx.store.data
  const before = Object.fromEntries(Object.keys(patch).map((key) => [key, db[key as keyof Database]]))
  const absent = Object.keys(patch).filter((key) => !Object.hasOwn(db, key))
  Object.assign(db, patch)
  try {
    ctx.publish()
  } catch (cause) {
    Object.assign(db, before)
    for (const key of absent) Reflect.deleteProperty(db, key)
    throw cause
  }
}
