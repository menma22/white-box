export interface InputActivity {
  startedAt: number | null
  lastInputAt: number | null
  presses: number
  lastReminderAt: number | null
}

export const emptyInputActivity = (): InputActivity => ({ startedAt: null, lastInputAt: null, presses: 0, lastReminderAt: null })

export function recordInputActivity(activity: InputActivity, presses: number, now: number, hasSession: boolean, thresholdMs: number) {
  if (hasSession) return { activity: { ...emptyInputActivity(), lastReminderAt: activity.lastReminderAt }, remind: false }
  if (presses <= 0) return { activity, remind: false }
  const fresh = activity.lastInputAt === null || now - activity.lastInputAt > 60_000
  const next: InputActivity = {
    startedAt: fresh ? now : activity.startedAt,
    lastInputAt: now,
    presses: (fresh ? 0 : activity.presses) + presses,
    lastReminderAt: activity.lastReminderAt,
  }
  const remind = next.startedAt !== null && now - next.startedAt >= thresholdMs && next.presses >= 12 && (next.lastReminderAt === null || now - next.lastReminderAt >= 30 * 60_000)
  if (remind) next.lastReminderAt = now
  return { activity: next, remind }
}
