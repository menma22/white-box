/**
 * アプリ／トレイのアイコンを生成する（build/*.png と assets/icon.ico）。
 * 画像ライブラリを入れずに済ませるため、PNG と ICO を直接組み立てている。
 *
 * 意匠「White Box」: 上から覗いた開いた箱。四隅の斜めの筋が箱の角、
 * 内側の明るい面が中身で、長さの違う 3 本の帯が積み上がった記録。
 * 一番下の短いキャラメルの帯が「まだ書き終えていない今日」。
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.join(process.cwd(), 'assets')
fs.mkdirSync(OUT, { recursive: true })

// ── PNG ──────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 図形 ─────────────────────────────────────────────────────────
/** 角丸長方形の内側なら負、外なら正の距離。 */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(px - cx) - (halfW - r)
  const qy = Math.abs(py - cy) - (halfH - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const GREEN = [30, 57, 50]
const APRON = [0, 112, 74]
const CREAM = [251, 248, 242]
const CARAMEL = [192, 138, 62]
const SEAM = [74, 106, 95]

function draw(S) {
  const px = Buffer.alloc(S * S * 4)
  const SS = 4
  const c = S / 2
  const half = S / 2 - S * 0.065
  const radius = S * 0.215
  const rim = S * 0.1
  const ih = half - rim
  const innerRadius = Math.max(1, S * 0.085)

  // 内側の面に置く記録。長さが違うほど「積み上がってきた」ことが伝わる
  const barH = S * 0.105
  const gap = S * 0.075
  const inset = ih * 0.16
  const bars = [
    { w: 0.92, color: APRON },
    { w: 0.62, color: GREEN },
    { w: 0.34, color: CARAMEL },
  ]
  const stackH = bars.length * barH + (bars.length - 1) * gap
  const stackTop = c - stackH / 2
  const barLeft = c - ih + inset
  const usable = ih * 2 - inset * 2

  const put = (i, color, alpha) => {
    if (alpha <= 0) return
    const a = px[i + 3] / 255
    const na = alpha + a * (1 - alpha)
    for (let k = 0; k < 3; k++) {
      px[i + k] = Math.round((color[k] * alpha + px[i + k] * a * (1 - alpha)) / na)
    }
    px[i + 3] = Math.round(na * 255)
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let outer = 0
      let inner = 0
      let seam = 0
      const hits = bars.map(() => 0)

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x + (sx + 0.5) / SS
          const fy = y + (sy + 0.5) / SS
          if (sdRoundRect(fx, fy, c, c, half, half, radius) > 0) continue
          outer++

          if (sdRoundRect(fx, fy, c, c, ih, ih, innerRadius) <= 0) {
            inner++
            for (let b = 0; b < bars.length; b++) {
              const top = stackTop + b * (barH + gap)
              const w = usable * bars[b].w
              if (sdRoundRect(fx, fy, barLeft + w / 2, top + barH / 2, w / 2, barH / 2, barH / 2) <= 0) hits[b]++
            }
            continue
          }

          // 四隅へ走る斜めの筋＝箱の角の稜線
          const dx = Math.abs(fx - c)
          const dy = Math.abs(fy - c)
          if (Math.abs(dx - dy) < S * 0.026 && Math.min(dx, dy) > ih * 0.78) seam++
        }
      }

      const total = SS * SS
      const i = (y * S + x) * 4
      if (outer === 0) continue

      put(i, GREEN, outer / total)
      put(i, SEAM, seam / total)
      put(i, CREAM, inner / total)
      for (let b = 0; b < bars.length; b++) if (hits[b] > 0) put(i, bars[b].color, hits[b] / total)
    }
  }
  return px
}

// ── ICO ──────────────────────────────────────────────────────────
function encodeIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(entries.length, 4)

  let offset = 6 + entries.length * 16
  const dir = []
  for (const e of entries) {
    const d = Buffer.alloc(16)
    d[0] = e.size >= 256 ? 0 : e.size
    d[1] = e.size >= 256 ? 0 : e.size
    d.writeUInt16LE(1, 4)
    d.writeUInt16LE(32, 6)
    d.writeUInt32LE(e.png.length, 8)
    d.writeUInt32LE(offset, 12)
    dir.push(d)
    offset += e.png.length
  }
  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)])
}

// ── 出力 ─────────────────────────────────────────────────────────
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
fs.writeFileSync(
  path.join(OUT, 'icon.ico'),
  encodeIco(icoSizes.map((size) => ({ size, png: encodePng(size, draw(size)) }))),
)
console.log('wrote assets/icon.ico', icoSizes.join('/'))

for (const [name, size] of [
  ['icon.png', 256],
  ['tray.png', 32],
  ['tray@2x.png', 64],
  ['preview-16.png', 16],
  ['preview-32.png', 32],
  ['preview-48.png', 48],
]) {
  fs.writeFileSync(path.join(OUT, name), encodePng(size, draw(size)))
  console.log('wrote', path.join('assets', name), size + 'x' + size)
}
