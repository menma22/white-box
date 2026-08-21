import type { ReactNode } from 'react'
import type { AppState, LiveTick } from '@white-box/core/types'
import { useApp } from '@/stores/app'

/**
 * 画面 story 専用: 本体では IPC 経由で埋まる zustand store に、固定スナップショットを注入するだけの薄いラッパー。
 * タイマー等の機構は持たない（渡すのは結果の状態だけ）。
 */
export function AppStateSeed({
  state,
  tick = null,
  children,
}: {
  state: AppState
  tick?: LiveTick | null
  children: ReactNode
}) {
  useApp.setState({ state, tick, ready: true })
  return <>{children}</>
}
