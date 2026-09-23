/**
 * 画面 story 専用: 本体では IPC が埋める zustand store に、固定スナップショットを入れる。
 *
 * Storybook の beforeEach（描画の前に走り、story を離れると戻り値の後始末が走る）から使うこと。
 * レンダー中に store を書くと、同じページに複数の story が載ったとき最後の 1 つが全部を上書きする。
 * 渡すのは結果の状態だけ（タイマー・IPC などの機構を story に持ち込まない）。
 */
import type { AppState, LiveTick } from '@white-box/core/types'
import { useApp } from '@/stores/app'

export function seedApp(state: AppState, tick: LiveTick | null = null) {
  return () => {
    useApp.setState({ state, tick, ready: true })
    // シードを書き忘れた story は起動中の画面のままになり、入れ忘れが目で見える
    return () => useApp.setState({ state: null, tick: null, ready: false })
  }
}
