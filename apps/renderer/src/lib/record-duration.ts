import { formatDuration, MINUTE } from '@white-box/core/engine'

export function formatRecordDuration(ms: number): string {
  return ms < MINUTE ? `${Math.floor(ms / 1000)}s` : formatDuration(ms, 'compact')
}
