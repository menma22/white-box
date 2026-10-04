import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startAgentServer } from '../src/infra/agent-api.js'
import { createAgentHandlers } from '../src/app/agent-handlers.js'
import type { Handlers } from '../src/app/handlers.js'
import { fakeCtx } from './helpers.js'

let server: Awaited<ReturnType<typeof startAgentServer>> | null = null
let directory: string
let token: string
const headers = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })
const url = () => `http://127.0.0.1:${server!.port}/command`

beforeEach(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-agent-test-'))
  server = await startAgentServer(directory, createAgentHandlers(fakeCtx()) as unknown as Handlers)
  const connection = JSON.parse(fs.readFileSync(path.join(directory, 'agent-connection.json'), 'utf8'))
  token = connection.token
})
afterEach(() => { server?.close(); server = null; vi.restoreAllMocks() })

describe('本物のローカルHTTP', () => {
  it('接続情報を作り、認証済みの文脈参照だけを受ける', async () => {
    const connection = JSON.parse(fs.readFileSync(path.join(directory, 'agent-connection.json'), 'utf8'))
    expect(connection.port).toBe(server!.port)
    expect(connection.pid).toBe(process.pid)
    expect(typeof connection.token).toBe('string')
    expect(connection.token.length).toBe(64)
    const response = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'agent:context', args: {} }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true, data: { projects: [], tasks: [], goals: [], sessions: [] } })
  })

  it('認証なしと間違った認証を拒否する', async () => {
    for (const authorization of ['', 'Bearer wrong']) {
      const response = await fetch(url(), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: authorization }, body: '{}' })
      expect(response.status).toBe(401)
    }
  })

  it('Origin付きのブラウザ要求と違うHostを拒否する', async () => {
    const origin = await fetch(url(), { method: 'POST', headers: { ...headers(), Origin: 'http://example.test' }, body: '{}' })
    expect(origin.status).toBe(403)
    const host = await fetch(url(), { method: 'POST', headers: { ...headers(), Host: 'localhost' }, body: '{}' })
    expect(host.status).toBe(403)
  })

  it('外部から本人確認・削除・アプリ終了を実行できない', async () => {
    for (const name of ['agent:resolve', 'task:delete', 'app:quit']) {
      const response = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name, args: {} }) })
      expect(response.status).toBe(403)
    }
  })

  it('文字列でないコマンド名をプロセスを落とさず拒否する', async () => {
    const response = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: { toString: 0 }, args: {} }) })
    expect(response.status).toBe(403)
    const next = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'agent:context', args: {} }) })
    expect(next.status).toBe(200)
  })

  it('不正JSON・異なる形式・大きすぎる本文を拒否する', async () => {
    expect((await fetch(url(), { method: 'POST', headers: headers(), body: '{' })).status).toBe(400)
    expect((await fetch(url(), { method: 'POST', headers: { ...headers(), 'Content-Type': 'text/plain' }, body: '{}' })).status).toBe(415)
    expect((await fetch(url(), { method: 'POST', headers: headers(), body: ' '.repeat(65537) })).status).toBe(413)
    expect((await fetch(url(), { method: 'GET', headers: headers() })).status).toBe(404)
  })

  it('strict契約の拒否をHTTPで返し、正しい登録と再送は1回だけ保存する', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'agent:applyPlan', args: { requestId: 'http', tasks: [{ title: '保存しない', boddy: '誤字' }] } }) })
    expect((await bad.json()).ok).toBe(false)
    const request = () => fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'agent:applyPlan', args: { requestId: 'http', tasks: [{ title: '保存する' }] } }) })
    const first = await (await request()).json(), retry = await (await request()).json()
    expect(first.ok).toBe(true)
    expect(retry.data.map((task: { id: string }) => task.id)).toEqual(first.data.map((task: { id: string }) => task.id))
    const response = await fetch(url(), { method: 'POST', headers: headers(), body: JSON.stringify({ name: 'agent:context', args: {} }) })
    expect((await response.json()).data.tasks).toHaveLength(1)
  })
})
