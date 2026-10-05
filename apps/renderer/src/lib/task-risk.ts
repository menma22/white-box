import { formatDuration, MINUTE } from '@white-box/core/engine'

export function slackLabel(slackMs: number | null): string {
  if (slackMs === null) return '不明'
  const duration = Math.abs(slackMs) > 0 && Math.abs(slackMs) < MINUTE ? '<1m' : formatDuration(Math.abs(slackMs), 'compact')
  return `${slackMs < 0 ? '−' : ''}${duration}`
}
