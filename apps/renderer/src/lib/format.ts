/**
 * 画面をまたいで使う表示用の整形。同じ書式を各画面で手書きしない（ずれると画面ごとに表記が割れる）。
 */
import { formatDuration } from '@white-box/core/engine'

/** 残り時間の表示。満了後は超過を + 付きで出す（例: 12:34 / +03:21）。 */
export function remainingLabel(remainingMs: number): string {
  return remainingMs < 0 ? `+${formatDuration(-remainingMs, 'hms')}` : formatDuration(remainingMs, 'hms')
}

/** ショートカットの人間向け表記（例: Control+Alt+S → Ctrl + Alt + S）。 */
export function shortcutLabel(accel: string): string {
  return accel.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ')
}
