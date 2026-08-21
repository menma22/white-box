import type { AppState, LiveTick, WindowKind } from '@white-box/core/types'
import { devFixture } from './dev/fixture'

interface Bridge {
  call(name: string, args?: Record<string, unknown>): Promise<{ ok: boolean; data?: unknown; error?: string }>
  onState(cb: (state: AppState) => void): () => void
  onTick(cb: (tick: LiveTick | null) => void): () => void
  windowKind(): string
}

declare global {
  interface Window {
    whitebox?: Bridge
  }
}

const inElectron = typeof window !== 'undefined' && Boolean(window.whitebox)

/**
 * ブラウザで開いたときは見た目確認用の固定データを返すだけにする。
 * ここにコマンドの処理を書かないこと（本体と二重実装になり、静かにずれる）。
 */
const browserStub: Bridge = {
  call: async (name) => (name === 'state:get' ? { ok: true, data: devFixture() } : { ok: true, data: null }),
  onState: () => () => {},
  onTick: () => () => {},
  windowKind: () => location.hash.replace('#', '') || 'main',
}

const bridge: Bridge = inElectron ? window.whitebox! : browserStub

export const isBrowserPreview = !inElectron

export async function call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T> {
  const res = await bridge.call(name, args)
  if (!res.ok) throw new Error(res.error ?? name)
  return res.data as T
}

export const onState = bridge.onState
export const onTick = bridge.onTick
export const windowKind = () => bridge.windowKind() as WindowKind

export const cmd = {
  openWindow: (kind: WindowKind) => call('window:open', { kind }),
  closeWindow: (kind: WindowKind) => call('window:close', { kind }),
  closeSelf: () => call('window:close', { kind: windowKind() }),
  minimize: () => call('window:minimize'),
}
