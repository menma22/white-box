import { describe, expect, it } from 'vitest'
import type { Session } from '@white-box/core/types'
import { HOUR, MINUTE, focusMs } from '@white-box/core/engine'
import { ribbonRows } from '../src/lib/day-ribbon.js'

const T0 = new Date(2026, 9, 3, 9).getTime()
function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's', startedAt: T0, endedAt: T0 + 4 * HOUR, plannedMs: 4 * HOUR, state: 'ended',
    segments: [{ id: 'seg', taskId: 'task', startedAt: T0, endedAt: T0 + 4 * HOUR }],
    pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null,
    createdAt: T0, ...overrides,
  }
}

describe('2行のタイムライン', () => {
  it('同じ縮尺の2行へ分割し、境界をまたぐ作業を欠落・二重計上させない', () => {
    const s = session()
    const rows = ribbonRows([s], T0)
    expect(rows.map((r) => [r.startedAt, r.endedAt])).toEqual([[T0, T0 + 2 * HOUR], [T0 + 2 * HOUR, T0 + 4 * HOUR]])
    expect(rows.flatMap((r) => r.items).reduce((sum, i) => sum + i.focusMs, 0)).toBe(focusMs(s, T0))
  })

  it('境界をまたぐ停止と除外をそれぞれ切り分け、実作業から一度だけ引く', () => {
    const s = session({ pauses: [
      { startedAt: T0 + 110 * MINUTE, endedAt: T0 + 130 * MINUTE, reason: 'manual' },
      { startedAt: T0 + 180 * MINUTE, endedAt: T0 + 200 * MINUTE, reason: 'excluded' },
    ] })
    const items = ribbonRows([s], T0).flatMap((r) => r.items)
    expect(items.filter((i) => i.kind === 'pause').map((i) => i.endedAt - i.startedAt)).toEqual([10 * MINUTE, 10 * MINUTE])
    expect(items.filter((i) => i.kind === 'excluded')).toHaveLength(1)
    expect(items.reduce((sum, i) => sum + i.focusMs, 0)).toBe(200 * MINUTE)
  })

  it('編集されたセッション境界の外側を描画しない', () => {
    const s = session({ startedAt: T0 + MINUTE, endedAt: T0 + 30 * MINUTE })
    const items = ribbonRows([s], T0).flatMap((r) => r.items)
    expect(items[0]?.startedAt).toBe(s.startedAt)
    expect(items[0]?.endedAt).toBe(s.endedAt)
    expect(items[0]?.focusMs).toBe(29 * MINUTE)
  })

  it('開始・終了を広げた編集後の帯と集計を一致させる', () => {
    const s = session({ startedAt: T0 - HOUR, endedAt: T0 + 5 * HOUR })
    const items = ribbonRows([s], T0).flatMap((r) => r.items)
    expect(items[0]?.startedAt).toBe(s.startedAt)
    expect(items.at(-1)?.endedAt).toBe(s.endedAt)
    expect(items.reduce((sum, i) => sum + i.focusMs, 0)).toBe(focusMs(s, T0))
  })

  it('編集で広げた境界を最初と最後のタスクへ割り当て、停止を差し引く', () => {
    const s = session({
      startedAt: T0 - HOUR, endedAt: T0 + 5 * HOUR,
      segments: [
        { id: 'first', taskId: 'a', startedAt: T0, endedAt: T0 + 2 * HOUR },
        { id: 'last', taskId: 'b', startedAt: T0 + 2 * HOUR, endedAt: T0 + 4 * HOUR },
      ],
      pauses: [
        { startedAt: T0 - 30 * MINUTE, endedAt: T0, reason: 'manual' },
        { startedAt: T0 + 4 * HOUR, endedAt: T0 + 270 * MINUTE, reason: 'excluded' },
      ],
    })
    const items = ribbonRows([s], T0).flatMap((r) => r.items)
    for (const taskId of ['a', 'b']) {
      expect(items.filter((i) => i.kind === 'work' && i.taskId === taskId).reduce((sum, i) => sum + i.focusMs, 0)).toBe(150 * MINUTE)
    }
    expect(items.reduce((sum, i) => sum + i.focusMs, 0)).toBe(focusMs(s, T0))
  })

  it('開始直後の0秒の記録で無限値や架空の作業区間を作らない', () => {
    const rows = ribbonRows([session({ endedAt: null })], T0)
    expect(rows).toHaveLength(2)
    expect(rows.flatMap((r) => r.items)).toEqual([])
    expect(rows.every((r) => Number.isFinite(r.endedAt) && r.endedAt > r.startedAt)).toBe(true)
  })

  it('開いたタスクと停止区間をnowで切り、停止中の実作業を増やさない', () => {
    const s = session({ endedAt: null, segments: [{ id: 'seg', taskId: 'task', startedAt: T0, endedAt: null }], pauses: [{ startedAt: T0 + MINUTE, endedAt: null, reason: 'manual' }] })
    const items = ribbonRows([s], T0 + 3 * HOUR).flatMap((r) => r.items)
    expect(items.reduce((sum, i) => sum + i.focusMs, 0)).toBe(MINUTE)
    expect(items.filter((i) => i.kind === 'work' && i.live)).toHaveLength(0)
    expect(items.filter((i) => i.kind === 'pause' && i.live)).toHaveLength(1)
  })

  it('日付をまたぐ記録を連続した時刻で保持する', () => {
    const start = new Date(2026, 9, 3, 23, 30).getTime()
    const s = session({ startedAt: start, endedAt: start + 3 * HOUR, segments: [{ id: 'night', taskId: 'task', startedAt: start, endedAt: start + 3 * HOUR }] })
    const rows = ribbonRows([s], start)
    expect(new Date(rows[1]!.endedAt).getDate()).toBe(4)
    expect(rows.flatMap((r) => r.items).reduce((sum, i) => sum + i.focusMs, 0)).toBe(3 * HOUR)
  })

  it('記録がない場合は帯を作らない', () => {
    expect(ribbonRows([], T0)).toEqual([])
  })
})
