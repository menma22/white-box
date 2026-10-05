/**
 * 1 秒間隔の刻み。何をするかは呼び出し側（presentation の配線）が決める。
 */
import type { TickerPort } from '../app/ports.js'

export function createTicker(onTick: () => void, enabled = () => true): TickerPort {
  let timer: NodeJS.Timeout | null = null
  return {
    start() {
      if (!timer && enabled()) timer = setInterval(() => { if (enabled()) onTick() }, 1000)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
