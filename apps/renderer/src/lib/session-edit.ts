export function toLocalInput(ts: number): string {
  const d = new Date(ts - new Date(ts).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export function changedSessionTimes(
  session: { startedAt: number; endedAt: number | null },
  startedAt: string,
  endedAt: string,
): { startedAt?: number; endedAt?: number } {
  return {
    ...(startedAt !== toLocalInput(session.startedAt) ? { startedAt: new Date(startedAt).getTime() } : {}),
    ...(endedAt && endedAt !== (session.endedAt === null ? '' : toLocalInput(session.endedAt))
      ? { endedAt: new Date(endedAt).getTime() }
      : {}),
  }
}
