import type { AppState, LiveTick, WindowKind } from '@white-box/core/types'
import type { ArgsOf, CommandName, ResultOf } from '@white-box/contracts'
import { devFixture } from './dev/fixture'

/** preload が公開する生の窓口。名前と引数の型付けは invoke() が契約で行う。 */
interface RawBridge {
  call(name: string, args?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string }>
  onState(cb: (state: AppState) => void): () => void
  onTick(cb: (tick: LiveTick | null) => void): () => void
  windowKind(): string
}

declare global {
  interface Window {
    whitebox?: RawBridge
  }
}

const inElectron = typeof window !== 'undefined' && Boolean(window.whitebox)

/**
 * ブラウザで開いたときは見た目確認用の固定データを返すだけにする。
 * ここにコマンドの処理を書かないこと（本体と二重実装になり、静かにずれる）。
 */
const browserStub: RawBridge = {
  call: async (name) => (name === 'state:get' ? { ok: true, data: devFixture() } : { ok: true, data: null }),
  onState: () => () => {},
  onTick: () => () => {},
  windowKind: () => location.hash.replace('#', '') || 'main',
}

const bridge: RawBridge = inElectron ? window.whitebox! : browserStub

export const isBrowserPreview = !inElectron

/**
 * 型付きのコマンド呼び出し。名前・引数・返り値は @white-box/contracts の契約から推論される。
 * 引数が全部省略可能なコマンドだけ、引数そのものを省略できる。
 */
export async function invoke<N extends CommandName>(
  name: N,
  ...rest: Record<string, never> extends ArgsOf<N> ? [args?: ArgsOf<N>] : [args: ArgsOf<N>]
): Promise<ResultOf<N>> {
  const res = await bridge.call(name, rest[0] ?? {})
  if (!res.ok) throw new Error(res.error ?? name)
  return res.data as ResultOf<N>
}

export const onState = bridge.onState
export const onTick = bridge.onTick
export const windowKind = () => bridge.windowKind() as WindowKind

export const cmd = {
  openWindow: (kind: WindowKind) => invoke('window:open', { kind }),
  closeWindow: (kind: WindowKind) => invoke('window:close', { kind }),
  closeSelf: () => invoke('window:close', { kind: windowKind() }),
  minimize: () => invoke('window:minimize'),
}
