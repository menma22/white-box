import type { CalendarBlock, CalendarBlockInput, Database } from '@white-box/core/types'
import { validateCalendarBlock } from '@white-box/core/calendar'
import { newId } from './session-ops.js'

function requireReferences(db: Database, input: CalendarBlockInput): void {
  if (input.projectId !== null && !db.projects.some((project) => project.id === input.projectId)) throw new Error('予定のプロジェクトが見つからない')
  if (input.taskId !== null) {
    const task = db.tasks.find((item) => item.id === input.taskId)
    if (!task) throw new Error('予定のタスクが見つからない')
    if (task.projectId !== input.projectId) throw new Error('予定のタスクとプロジェクトが一致していません')
  }
}

export function createCalendarBlock(db: Database, input: CalendarBlockInput, now: number): { calendarBlocks: CalendarBlock[]; block: CalendarBlock } {
  validateCalendarBlock(input)
  requireReferences(db, input)
  const block: CalendarBlock = { ...structuredClone(input), title: input.title.trim(), id: newId('calendar'), cancelled: false, createdAt: now, updatedAt: now }
  return { calendarBlocks: [...(db.calendarBlocks ?? []), block], block }
}

export function updateCalendarBlock(db: Database, id: string, patch: Partial<CalendarBlockInput & Pick<CalendarBlock, 'cancelled'>>, now: number): CalendarBlock[] {
  const previous = db.calendarBlocks?.find((block) => block.id === id)
  if (!previous) throw new Error('予定が見つからない')
  const changes = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
  const next: CalendarBlock = { ...previous, ...structuredClone(changes), id: previous.id, createdAt: previous.createdAt, updatedAt: now }
  validateCalendarBlock(next)
  if (['taskId', 'projectId'].some((key) => Object.hasOwn(changes, key))) requireReferences(db, next)
  next.title = next.title.trim()
  return db.calendarBlocks!.map((block) => block.id === id ? next : block)
}
