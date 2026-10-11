import { useEffect, useState } from 'react'
import { invoke, isBrowserPreview } from '@/lib/bridge'
import type { GoogleCalendarState } from './google-calendar'

export function useGoogleCalendarRange(connected: boolean, startedAt: number, endedAt: number, status?: GoogleCalendarState) {
  const [error, setError] = useState('')
  useEffect(() => {
    if (status?.syncing || status?.lastSyncedAt != null && !status.error) setError('')
  }, [status?.syncing, status?.lastSyncedAt, status?.error])
  useEffect(() => {
    let active = true
    setError('')
    if (connected && !isBrowserPreview) void invoke('googleCalendar:sync', { startedAt, endedAt })
      .catch((cause) => { if (active) setError(String(cause).replace(/^(Error:\s*)+/, '')) })
    return () => { active = false }
  }, [connected, startedAt, endedAt])
  return error
}
