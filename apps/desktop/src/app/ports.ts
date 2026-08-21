/**
 * ユースケース（app 層）が外の世界に触るための口。実装は infra / presentation が注入する。
 * app 層はここにある型だけに依存し、electron を import しない（テストは偽物の Port で回す）。
 */
import type { Database, WindowKind } from '@white-box/core/types'
import type { RuntimeState } from './state.js'

export interface StorePort {
  readonly data: Database
  save(): void
  replace(next: Database): void
  /** 実行中セッションの復旧用。生きている時刻の記録。 */
  markAlive(): void
  readLastAlive(): number | null
}

export interface WindowPort {
  open(kind: WindowKind, focus?: boolean): void
  close(kind: WindowKind): void
  toggle(kind: WindowKind): void
  minimizeFocused(): void
  /** 返事を返してから閉じる（150ms 待ち）。先に閉じると呼び出し側の await が永久に返らない。 */
  closeLater(...kinds: WindowKind[]): void
}

export interface TickerPort {
  start(): void
  stop(): void
}

export interface SystemPort {
  applyShortcuts(): void
  applyLoginItem(): void
  quit(): void
}

export interface DataIOPort {
  /** 保存先を選ばせて書き出す。キャンセルなら null。 */
  exportData(): Promise<string | null>
  /** ファイルを選ばせ、確認の上で置き換える。キャンセルなら null。 */
  importData(): Promise<string | null>
  revealDataDir(): void
}

export interface Ctx {
  store: StorePort
  windows: WindowPort
  ticker: TickerPort
  system: SystemPort
  dataIO: DataIOPort
  runtime: RuntimeState
  now(): number
  /** 状態を保存し、全ウィンドウとトレイへ配る。 */
  publish(): void
}
