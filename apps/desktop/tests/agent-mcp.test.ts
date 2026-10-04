import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

function messages(input: unknown[]) {
  const result = spawnSync(process.execPath, [path.resolve('scripts/white-box-mcp.mjs')], {
    input: input.map((message) => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', timeout: 5000,
  })
  expect(result.status).toBe(0)
  expect(result.stderr).toBe('')
  return result.stdout.trim().split('\n').map((line) => JSON.parse(line))
}

describe('MCPのstdio境界', () => {
  it('不正なメッセージとリクエストIDを拒否し、その後の正常な初期化を受ける', () => {
    const replies = messages([
      null, [], { jsonrpc: '2.0', id: {}, method: 'initialize', params: {} },
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ])
    expect(replies.slice(0, 3)).toEqual(Array.from({ length: 3 }, () => ({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })))
    expect(replies[3]).toMatchObject({ id: 1, result: { protocolVersion: '2025-11-25' } })
    expect(replies[4]).toMatchObject({ id: 2, result: { tools: expect.any(Array) } })
    expect(replies).toHaveLength(5)
  })

  it('不正な初期化を状態へ反映せず、リクエスト形式の通知と不正ツール名を拒否する', () => {
    const replies = messages([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', id: 4, method: 'notifications/initialized' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: { toString: 0 } } },
      { jsonrpc: '2.0', method: 'tools/call', params: { name: 'white_box_register_tasks', arguments: {} } },
    ])
    expect(replies[0]).toMatchObject({ id: 1, error: { code: -32602 } })
    expect(replies[1]).toMatchObject({ id: 2, error: { code: -32000 } })
    expect(replies[2]).toMatchObject({ id: 3, result: { protocolVersion: '2025-11-25' } })
    expect(replies[3]).toMatchObject({ id: 4, error: { code: -32600 } })
    expect(replies[4]).toMatchObject({ id: 5, error: { code: -32602 } })
    expect(replies).toHaveLength(5)
  })
})
