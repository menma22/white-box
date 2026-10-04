/**
 * アプリ／トレイのアイコンを生成する（assets/*.png と assets/icon.ico）。
 * 画像ライブラリを入れずに済ませるため、PNG と ICO を直接組み立てている。
 *
 * 意匠「White Box」: 細い稜線の立方体。中心から3本の線が面を分け、右面だけamberにする。
 * ヘッダーのSVGと同じ24単位の座標を使う。
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
const GREEN = [30, 57, 50]
const CREAM = [255, 254, 251]
const AMBER = [184, 129, 58]
const OUTLINE = [[12, 2.5], [20.5, 7.3], [20.5, 16.7], [12, 21.5], [3.5, 16.7], [3.5, 7.3]]
const RIGHT_FACE = [[12, 12], [20.5, 7.3], [20.5, 16.7], [12, 21.5]]
const CENTER = [12, 12]
const EDGES = [
  ...OUTLINE.map((point, index) => [point, OUTLINE[(index + 1) % OUTLINE.length]]),
  [CENTER, OUTLINE[1]], [CENTER, OUTLINE[3]], [CENTER, OUTLINE[5]],
]

function insidePolygon(x, y, points) {
  return points.every(([ax, ay], index) => {
    const [bx, by] = points[(index + 1) % points.length]
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= 0
  })
}

function distanceToEdge(x, y, [[ax, ay], [bx, by]]) {
  const dx = bx - ax
  const dy = by - ay
  const position = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(x - ax - position * dx, y - ay - position * dy)
}

function draw(S) {
  const px = Buffer.alloc(S * S * 4)
  const SS = 4

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let hits = 0
      const sum = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = (x + (sx + 0.5) / SS) * 24 / S
          const fy = (y + (sy + 0.5) / SS) * 24 / S
          const edge = EDGES.some((line) => distanceToEdge(fx, fy, line) <= 1.25 / 2)
          if (!edge && !insidePolygon(fx, fy, OUTLINE)) continue
          const color = edge ? GREEN : insidePolygon(fx, fy, RIGHT_FACE) ? AMBER : CREAM
          hits++
          for (let k = 0; k < 3; k++) sum[k] += color[k]
        }
      }
      if (hits === 0) continue
      const i = (y * S + x) * 4
      for (let k = 0; k < 3; k++) px[i + k] = Math.round(sum[k] / hits)
      px[i + 3] = Math.round(hits / (SS * SS) * 255)
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
