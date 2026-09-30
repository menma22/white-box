/**
 * 1 秒間隔の刻み。何をするかは呼び出し側（presentation の配線）が決める。
 */
import type { TickerPort } from '../app/ports.js'

export function createTicker(onTick: () => void): TickerPort {
  let timer: NodeJS.Timeout | null = null
  return {
    start() {
      if (!timer) timer = setInterval(onTick, 1000)
    },
    stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
