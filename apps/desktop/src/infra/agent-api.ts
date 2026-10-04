import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import type { Handlers } from '../app/handlers.js'
import { receive } from '../app/receive.js'

const ALLOWED = new Set(['agent:context', 'agent:applyPlan'])
const MAX_BODY = 64 * 1024

export async function startAgentServer(directory: string, handlers: Handlers) {
  const token = randomBytes(32).toString('hex')
  let port = 0
  let pending = Promise.resolve()
  const server = http.createServer((request, response) => {
    const reply = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify(body))
    }
    if (request.headers.origin !== undefined || request.headers.host !== `127.0.0.1:${port}`) return reply(403, { error: 'ローカルの認証済みクライアントだけが接続できます' })
    const received = Buffer.from(request.headers.authorization?.replace(/^Bearer /, '') ?? '')
    const expected = Buffer.from(token)
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return reply(401, { error: '認証が必要です' })
    if (request.method !== 'POST' || request.url !== '/command') return reply(404, { error: '見つかりません' })
    if (!request.headers['content-type']?.startsWith('application/json')) return reply(415, { error: 'application/jsonで送信してください' })
    const chunks: Buffer[] = []
    let size = 0
    let rejected = false
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (rejected) return
      if (size > MAX_BODY) {
        rejected = true
        chunks.length = 0
        reply(413, { error: 'タスク案が大きすぎます' })
      } else chunks.push(chunk)
    })
    request.on('error', () => { if (!response.headersSent) reply(400, { error: '送信が中断されました' }) })
    request.on('end', () => {
      if (rejected) return
      let input: { name?: unknown; args?: unknown }
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as typeof input } catch { return reply(400, { error: 'JSONを読めません' }) }
      if (!input || typeof input !== 'object' || typeof input.name !== 'string' || !ALLOWED.has(input.name)) return reply(403, { error: 'この操作は外部クライアントから実行できません' })
      pending = pending.then(async () => { reply(200, await receive(handlers, input.name, input.args)) }).catch(() => { if (!response.headersSent) reply(500, { error: '操作に失敗しました' }) })
    })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('AI連携の待受けを開始できません') }
  port = address.port
  const connection = { port, token, pid: process.pid }
  const file = path.join(directory, 'agent-connection.json')
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(connection), { mode: 0o600 })
    fs.renameSync(`${file}.tmp`, file)
  } catch (error) { server.close(); throw error }
  return { port, close: () => { server.closeAllConnections(); server.close() } }
}
