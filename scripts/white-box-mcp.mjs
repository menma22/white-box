import fs from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const CONFIG = process.env.WHITEBOX_AGENT_CONFIG || path.join(process.env.APPDATA || '', 'White Box', 'data', 'agent-connection.json')
const instructions = `White Boxは本人の目標・タスク・実行記録をつなぐローカルアプリです。
最初にwhite_box_contextで実在するプロジェクトと目標を確認してください。
タスク登録を頼まれたときは、音声の書き起こしも含め、本人の意図を保持し、具体的な行動単位に整理してください。
分解は親を先に並べ、子のparentIndexで参照します。登録したタスク案はInboxに入ります。
同じ登録依頼の再送には同じrequestIdを使い、異なる依頼には新しいrequestIdを使ってください。
本人が依頼していない登録・監視を行わず、ここで得た内容を外部に送信しないでください。`

const tools = [
  { name: 'white_box_context', description: '目標・プロジェクト・タスクと直近100セッションの作業時間を確認する。', inputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, additionalProperties: false }, annotations: { readOnlyHint: true } },
  { name: 'white_box_register_tasks', description: '本人が依頼したタスクを親子構造でInboxへ一括登録する。同じrequestIdの再送は重複しない。', inputSchema: { type: 'object', properties: { requestId: { type: 'string', minLength: 1 }, tasks: { type: 'array', minItems: 1, maxItems: 100, items: { type: 'object', properties: { title: { type: 'string', minLength: 1 }, notes: { type: 'string' }, projectId: { type: ['string', 'null'] }, parentId: { type: ['string', 'null'] }, parentIndex: { type: 'integer', minimum: 0 }, goalNodeId: { type: ['string', 'null'] }, priority: { type: 'string', enum: ['low', 'normal', 'high'] }, due: { type: ['string', 'null'], description: '期限の日付 YYYY-MM-DD' } }, required: ['title'], additionalProperties: false } } }, required: ['requestId', 'tasks'], additionalProperties: false }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } },
]
const commands = { white_box_context: 'agent:context', white_box_register_tasks: 'agent:applyPlan' }
const supported = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
let initialized = false
let ready = false

async function handle(message) {
  if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') throw Object.assign(new Error('Invalid Request'), { code: -32600 })
  const params = message.params || {}
  if (message.method === 'initialize') {
    initialized = true
    return { protocolVersion: supported.includes(params.protocolVersion) ? params.protocolVersion : supported[0], capabilities: { tools: {}, prompts: {} }, serverInfo: { name: 'white-box', version: '0.1.0' }, instructions }
  }
  if (message.method === 'notifications/initialized') { ready = initialized; return }
  if (message.method === 'ping') return {}
  if (!ready) throw Object.assign(new Error('Initialize before using White Box tools'), { code: -32000 })
  if (message.method === 'tools/list') return { tools }
  if (message.method === 'prompts/list') return { prompts: [{ name: 'white-box-task-planning', description: 'White Boxで本人の意図を保って登録・分解・記録確認するための手順' }] }
  if (message.method === 'prompts/get') {
    if (params.name !== 'white-box-task-planning') throw Object.assign(new Error('Unknown prompt'), { code: -32602 })
    return { messages: [{ role: 'user', content: { type: 'text', text: instructions } }] }
  }
  if (message.method === 'tools/call') {
    const command = Object.hasOwn(commands, params.name) ? commands[params.name] : null
    if (!command) throw Object.assign(new Error('Unknown tool'), { code: -32602 })
    try {
      const config = JSON.parse(await fs.readFile(CONFIG, 'utf8'))
      if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535 || typeof config.token !== 'string') throw new Error('AI連携の接続情報が不正です')
      const response = await fetch(`http://127.0.0.1:${config.port}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` }, body: JSON.stringify({ name: command, args: params.arguments || {} }), signal: AbortSignal.timeout(10000) })
      const result = await response.json()
      if (!response.ok || !result.ok) throw new Error(result.error || `HTTP ${response.status}`)
      return { content: [{ type: 'text', text: JSON.stringify(result.data) }] }
    } catch (error) { return { content: [{ type: 'text', text: `White Box: ${error.message}. アプリを起動し、設定のAI連携を有効にしてください。` }], isError: true } }
  }
  throw Object.assign(new Error('Method not found'), { code: -32601 })
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  let message
  try {
    if (Buffer.byteLength(line, 'utf8') > 65536) throw Object.assign(new Error('Request too large'), { code: -32600 })
    message = JSON.parse(line)
    const result = await handle(message)
    if (message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n')
  } catch (error) {
    if (!message || message.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message?.id ?? null, error: { code: error.code || -32700, message: error.message } }) + '\n')
  }
}
