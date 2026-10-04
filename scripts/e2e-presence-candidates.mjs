import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { emptyGoalMap } from '@white-box/core/goal-map'
import { dayKey } from '@white-box/core/engine'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
fs.mkdirSync(path.join(ROOT, '.e2e'), { recursive: true })
const DATA = fs.mkdtempSync(path.join(ROOT, '.e2e', 'presence-candidates-'))
const SHOTS = path.join(DATA, 'shots')
fs.mkdirSync(SHOTS)
const now = Date.now()
const begin = now - 60_000
const seed = {
  version: 1, projects: [], tasks: [{ id: 'task', title: '候補確認の検証', projectId: null, parentId: null, status: 'todo', progress: 0, priority: 'normal', order: 0, notes: '', createdAt: begin, updatedAt: begin, doneAt: null, createdInSessionId: null }], dayNotes: {}, goalMap: emptyGoalMap(),
  sessions: [{ id: 'session', startedAt: begin, endedAt: null, state: 'paused', plannedMs: 1_000_000,
    segments: [{ id: 'segment', taskId: 'task', startedAt: begin, endedAt: null }],
    pauses: [[10_000,20_000,'manual'],[15_000,25_000,'excluded'],[30_000,35_000,'lock'],[40_000,50_000,'break'],[55_000,null,'manual']].map(([from,to,reason])=>({startedAt:begin+from,endedAt:to===null?null:begin+to,reason})),
    events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: begin }],
  presenceCandidates: ['accept','dismiss'].map(id=>({id,sessionId:'session',startedAt:begin+5_000,endedAt:begin+55_000,status:'pending',createdAt:now,reviewedAt:null})),
  settings: { shortcuts: { startPause: '', currentWork: '', dashboard: '' }, soundOnExpire: false, lastWelcomeDate: dayKey(now,4), onboardedAt: now },
}
const file = path.join(DATA, 'data.json')
fs.writeFileSync(file, JSON.stringify(seed))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const errors = []
const checks = []
let child
let main
const clients = new Set()
let port
const packaged = process.env.WHITEBOX_EXE ? path.resolve(process.env.WHITEBOX_EXE) : null
const electron = packaged || createRequire(import.meta.url)('electron')
const expected = pathToFileURL(path.join(packaged ? path.join(path.dirname(packaged), 'resources', 'app') : ROOT, 'dist', 'index.html')).href

function check(name, condition, details) {
  if (!condition) throw new Error(`${name}: ${JSON.stringify(details)}`)
  checks.push(name)
  console.log(`PASS ${name}`)
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const pending = new Map()
    let sequence = 0
    socket.addEventListener('error', reject)
    socket.addEventListener('close', () => {
      for (const callback of pending.values()) callback.reject(new Error('CDP接続が閉じた'))
      pending.clear()
    })
    socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data)
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails)
      const callback = pending.get(message.id)
      if (!callback) return
      pending.delete(message.id)
      if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
      else callback.resolve(message.result)
    })
    socket.addEventListener('open', () => {
      const client = {
        close: () => socket.close(),
        send: (method, params = {}) => new Promise((res, rej) => {
          const id = ++sequence
          pending.set(id, { resolve: res, reject: rej })
          socket.send(JSON.stringify({ id, method, params }))
        }),
        async evaluate(expression) {
          const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
          if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
          return result.result.value
        },
      }
      clients.add(client)
      resolve(client)
    })
  })
}

async function page(kind) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => [])
    const target = pages.find((p) => p.type === 'page' && decodeURI(p.url) === decodeURI(`${expected}#${kind}`))
    if (target) {
      const client = await connect(target.webSocketDebuggerUrl)
      await client.send('Runtime.enable')
      for (let ready = 0; ready < 30; ready++) {
        if (await client.evaluate('document.readyState === "complete" && typeof window.whitebox === "object" && !document.querySelector(".boot")').catch(() => false)) return client
        await wait(100)
      }
      throw new Error(`${kind} の描画が完了しない`)
    }
    await wait(100)
  }
  throw new Error(`${kind} の実ウィンドウが見つからない`)
}

async function command(name, args = {}) {
  const result = await main.evaluate(`window.whitebox.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`)
  if (!result.ok) throw new Error(`${name}: ${result.error}`)
  return result.data
}

async function screenshot(client, name) {
  await client.send('Page.bringToFront')
  await wait(250)
  const { data } = await client.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64'))
}

async function startApp() {
  const server = net.createServer()
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  const env = { ...process.env, WHITEBOX_DATA_DIR: DATA }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const args = ['--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--hidden', '--open=main', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(DATA, 'userdata')}`]
  if (!packaged) args.unshift('.')
  child = spawn(electron, args, { cwd: ROOT, env, windowsHide: true, stdio: ['ignore', fs.openSync(path.join(DATA, 'app.log'), 'a'), fs.openSync(path.join(DATA, 'app.log'), 'a')] })
  main = await page('main')
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { if (error.code === 'ESRCH') return false; throw error }
}
async function stopApp() {
  const owned = child
  void main.evaluate('window.whitebox.call("app:quit", {}); true').catch(() => undefined)
  for(let i=0;i<100 && alive(owned.pid);i++) await wait(100)
  const stopped = !alive(owned.pid)
  for (const client of clients) client.close()
  clients.clear()
  if(!stopped) { owned.kill(); throw new Error('検証対象のアプリが終了しなかった') }
  child = null
  check('アプリの終了とPID消滅を確認',stopped)
}
const read = () => JSON.parse(fs.readFileSync(file,'utf-8'))
async function until(test) {
  for(let i=0;i<100;i++) { if(await test()) return; await wait(100) }
  throw new Error('候補確認のUIが更新されなかった')
}

try {
  await startApp()
  check('このビルドの実画面へ接続',(await command('state:get')).presenceCandidates.length===2)
  const original = JSON.stringify(read().sessions)
  const rejected = await main.evaluate('window.whitebox.call("presence:resolve",{id:"accept",decision:"accept"})')
  check('実行中の除外反映を拒否',!rejected.ok && JSON.stringify(read().sessions)===original)
  await command('session:end')
  const review = await page('review')
  await until(()=>review.evaluate('document.querySelectorAll(".presence-candidate").length===2'))
  check('候補内の実作業だけを表示',await review.evaluate('document.querySelector(".presence-candidate").textContent.includes("20秒")'))
  const before = JSON.stringify(read().sessions)
  await screenshot(review,'01-pending')
  check('未確認の候補は作業記録を変更しない',JSON.stringify(read().sessions)===before)
  await review.evaluate('document.querySelector(".presence-candidate button").click(); true')
  await until(()=>read().presenceCandidates[0].status==='accepted')
  const accepted = read()
  check('確認後に停止済み区間を保持',accepted.sessions[0].pauses.filter(p=>p.reason!=='excluded').length===4)
  const ranges=accepted.sessions[0].pauses.filter(p=>p.reason==='excluded').map(p=>[p.startedAt-begin,p.endedAt-begin])
  check('4つの実作業区間だけを追加',JSON.stringify(ranges)===JSON.stringify([[5_000,10_000],[15_000,25_000],[25_000,30_000],[35_000,40_000],[50_000,55_000]]))
  await review.evaluate('document.querySelectorAll(".presence-candidate button")[1].click(); true')
  await until(()=>read().presenceCandidates[1].status==='dismissed')
  const confirmed = JSON.stringify(read().sessions)
  await command('presence:resolve',{id:'accept',decision:'accept'})
  check('見送りと再確認で記録を変えない',JSON.stringify(read().sessions)===confirmed)
  await screenshot(review,'02-reviewed')
  await stopApp()
  await startApp()
  const restored=await command('state:get')
  check('再起動後も確認結果と作業記録を保持',restored.presenceCandidates.every(c=>c.status!=='pending') && JSON.stringify(read().sessions)===confirmed)
  await main.evaluate('window.dispatchEvent(new KeyboardEvent("keydown",{key:"3",ctrlKey:true,bubbles:true})); true')
  await until(()=>main.evaluate('document.querySelector(".presence-reviewed summary")?.textContent.includes("2")'))
  check('再起動後も記録画面から確認結果を読める',await main.evaluate('document.querySelector(".presence-candidates").textContent.includes("離席候補")'))
  await screenshot(main,'03-history-restart')
  await command('session:delete',{id:'session'})
  await until(()=>main.evaluate('document.body.textContent.includes("まだ記録がない")'))
  check('セッションがない記録画面でも確認結果へ戻れる',await main.evaluate('document.querySelector(".presence-candidates")!==null'))
  check('renderer例外なし',errors.length===0,errors)
  await stopApp()
  fs.writeFileSync(path.join(DATA,'result.json'),JSON.stringify({checks,errors,passed:true},null,2))
  console.log('Evidence:',DATA)
} catch(error) {
  console.error(error)
  process.exitCode=1
} finally {
  for(const client of clients) client.close()
  if(child) { try { await stopApp() } catch(error) { console.error(error);process.exitCode=1 } }
}
