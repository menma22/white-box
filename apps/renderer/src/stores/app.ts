import { create } from 'zustand'
import type { AppState, LiveTick } from '@white-box/core/types'
import { invoke, onState, onTick } from '@/lib/bridge'

interface UiState {
  state: AppState | null
  tick: LiveTick | null
  /** 秒表示を動かすためだけの値。状態そのものではない。 */
  now: number
  ready: boolean
}

export const useApp = create<UiState>(() => ({ state: null, tick: null, now: Date.now(), ready: false }))

export async function initStore(): Promise<void> {
  const state = await invoke('state:get')
  useApp.setState({ state, tick: state.live, ready: true })

  onState((next) => useApp.setState({ state: next, tick: next.live }))
  onTick((tick) => useApp.setState({ tick }))

  setInterval(() => useApp.setState({ now: Date.now() }), 1000)
}

export function useData(): AppState {
  const state = useApp((s) => s.state)
  if (!state) throw new Error('状態の初期化前に useData が呼ばれた')
  return state
}
