import type { CalendarBlock, CalendarBlockInput, Database, ID, TimeRange } from './types.js'
import { activitySlices, weekRange } from './activity.js'
import { pausedMsWithin, totalRangeMs, unpausedRanges } from './engine.js'

const DAY_MS = 24 * 60 * 60_000

function localDate(key: string): Date {
  const date = new Date(`${key}T00:00:00`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || !Number.isFinite(date.getTime()) ||
      date.getFullYear() !== Number(key.slice(0, 4)) || date.getMonth() + 1 !== Number(key.slice(5, 7)) || date.getDate() !== Number(key.slice(8, 10))) {
    throw new Error('繰り返しの終了日は実在する日付で指定してください')
  }
  return date
}

export function validateCalendarBlock(input: CalendarBlockInput): void {
  if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('予定の名前を入力してください')
  if (!['work', 'sleep', 'meal', 'fixed'].includes(input.category)) throw new Error('予定の種類が不正です')
  for (const reference of [input.taskId, input.projectId]) {
    if (reference !== null && (typeof reference !== 'string' || !reference)) throw new Error('予定の関連付けが不正です')
  }
  if (input.category !== 'work' && (input.taskId !== null || input.projectId !== null)) throw new Error('生活予定にはタスクやプロジェクトを関連付けられません')
  for (const value of [input.startedAt, input.endedAt]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) throw new Error('予定の日時が不正です')
  }
  if (input.endedAt <= input.startedAt) throw new Error('予定の終了は開始より後にしてください')
  if (!Array.isArray(input.weekdays) || input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || new Set(input.weekdays).size !== input.weekdays.length) {
    throw new Error('繰り返しの曜日が不正です')
  }
  if (input.repeat === 'none') {
    if (input.weekdays.length || input.until !== null) throw new Error('単発予定には繰り返しの曜日や終了日を指定できません')
  } else if (input.repeat === 'weekly') {
    if (!input.weekdays.length) throw new Error('繰り返す曜日を選択してください')
    if (input.endedAt - input.startedAt > DAY_MS) throw new Error('繰り返し予定は24時間以内にしてください')
    if (input.until !== null) {
      const until = localDate(input.until)
      const startDay = new Date(input.startedAt)
      startDay.setHours(0, 0, 0, 0)
      if (until.getTime() < startDay.getTime()) throw new Error('繰り返しの終了日は開始日以降にしてください')
    }
  } else throw new Error('予定の繰り返しが不正です')
}

export interface CalendarOccurrence extends CalendarBlockInput { blockId: ID }

export function calendarOccurrences(blocks: CalendarBlock[], period: TimeRange): CalendarOccurrence[] {
  if (!Number.isFinite(new Date(period.startedAt).getTime()) || !Number.isFinite(new Date(period.endedAt).getTime()) || period.endedAt <= period.startedAt) return []
  const out: CalendarOccurrence[] = []
  for (const block of blocks) {
    if (block.cancelled) continue
    const { id: blockId, cancelled: _cancelled, createdAt: _createdAt, updatedAt: _updatedAt, ...input } = block
    const add = (startedAt: number, endedAt: number) => {
      if (startedAt < period.endedAt && endedAt > period.startedAt) out.push({ ...input, weekdays: [...input.weekdays], blockId, startedAt, endedAt })
    }
    if (block.repeat === 'none') { add(block.startedAt, block.endedAt); continue }
    const duration = block.endedAt - block.startedAt
    const anchor = new Date(block.startedAt)
    // 前日に始まって期間へ跨る予定も、元の開始・終了時刻のまま返す。
    const cursor = new Date(Math.max(block.startedAt, period.startedAt - duration))
    cursor.setHours(0, 0, 0, 0)
    const lastDay = block.until === null ? Infinity : localDate(block.until).getTime()
    for (; cursor.getTime() < period.endedAt && cursor.getTime() <= lastDay;) {
      if (block.weekdays.includes(cursor.getDay())) {
        const occurrence = new Date(cursor)
        occurrence.setHours(anchor.getHours(), anchor.getMinutes(), anchor.getSeconds(), anchor.getMilliseconds())
        const startedAt = occurrence.getTime()
        if (startedAt >= block.startedAt) add(startedAt, startedAt + duration)
      }
      const previous = cursor.getTime()
      cursor.setDate(cursor.getDate() + 1)
      if (!Number.isFinite(cursor.getTime()) || cursor.getTime() <= previous) break
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt || a.blockId.localeCompare(b.blockId))
}

export interface CalendarProjectUsage {
  plannedMinutes: number
  actualMinutes: number
  flexibleActualMinutes: number
}

export function calendarProjectUsage(state: Pick<Database, 'tasks' | 'sessions' | 'fixedWork' | 'calendarBlocks'>, weekStart: string, now: number): Map<ID | null, CalendarProjectUsage> {
  const period = weekRange(weekStart, 0)
  const taskProjects = new Map(state.tasks.map((task) => [task.id, task.projectId]))
  const fixed = (state.fixedWork ?? []).filter((work) => !work.cancelled && work.startedAt < period.endedAt && work.endedAt > period.startedAt)
  const planned = new Map<ID | null, TimeRange[]>()
  const usage = new Map<ID | null, CalendarProjectUsage>()
  const get = (projectId: ID | null) => {
    let value = usage.get(projectId)
    if (!value) { value = { plannedMinutes: 0, actualMinutes: 0, flexibleActualMinutes: 0 }; usage.set(projectId, value) }
    return value
  }
  const schedule = (projectId: ID | null, range: TimeRange) => {
    const ranges = planned.get(projectId) ?? []
    ranges.push(range)
    planned.set(projectId, ranges)
  }
  for (const occurrence of calendarOccurrences(state.calendarBlocks ?? [], period)) {
    if (occurrence.category === 'work') schedule(occurrence.projectId, occurrence)
  }
  for (const work of fixed) schedule(taskProjects.get(work.taskId) ?? null, work)
  for (const [projectId, ranges] of planned) {
    get(projectId).plannedMinutes = pausedMsWithin(ranges.map((range) => ({ ...range, reason: null })), period.startedAt, period.endedAt, now) / 60_000
  }
  for (const slice of activitySlices(state.sessions, now, period)) {
    const projectId = slice.taskId === null ? null : taskProjects.get(slice.taskId) ?? null
    const value = get(projectId)
    value.actualMinutes += (slice.endedAt - slice.startedAt) / 60_000
    value.flexibleActualMinutes += totalRangeMs(unpausedRanges(fixed.map((work) => ({ ...work, reason: null })), slice.startedAt, slice.endedAt, now)) / 60_000
  }
  return usage
}
