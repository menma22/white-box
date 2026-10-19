const { app, ipcMain } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const root = process.argv[2]
const output = process.argv[3]
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(output, 'userdata'))
let state = { settings: { showSessionCard: true }, breakTimer: null, live: null }
ipcMain.handle('whitebox:cmd', () => ({ ok: true, data: state }))
app.on('window-all-closed', () => {})
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  const { openWindow } = await import(pathToFileURL(path.join(root, 'dist-electron/infra/windows.js')).href)
  const win = openWindow('hud', false)
  const errors = []
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message) })
  await new Promise(resolve => win.once('ready-to-show', resolve))
  const results = []
  for (const fixture of [
    { name: 'full', remaining: 3000000, elapsed: 0, fraction: 1 },
    { name: '75', remaining: 2250000, elapsed: 750000, fraction: .75 },
    { name: '50', remaining: 1500000, elapsed: 1500000, fraction: .5 },
    { name: 'paused', remaining: 1500000, elapsed: 1500000, fraction: .5, paused: true },
    { name: 'over', remaining: -60000, elapsed: 3060000, fraction: 0 },
    { name: 'stopwatch', remaining: 0, elapsed: 36000000, fraction: 0, mode: 'stopwatch' },
    { name: 'break', remaining: 0, elapsed: 3000000, fraction: .5, break: true },
  ]) {
    const now = Date.now()
    state = {
      ...state,
      live: { sessionId: 'fixture', mode: fixture.mode || 'timer', state: fixture.paused || fixture.break ? 'paused' : 'running', elapsedMs: fixture.elapsed, remainingMs: fixture.remaining, plannedMs: 3000000, activeTaskId: 'fixture' },
      breakTimer: fixture.break ? { startedAt: now - 60000, endsAt: now + 60000, notifiedAt: null } : null,
    }
    win.webContents.send('whitebox:state', state)
    win.webContents.send('whitebox:tick', state.live)
    await wait(1200)
    const result = await win.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.hud-card');
      const gauge = document.querySelector('.hud-gauge-fill');
      const number = document.querySelector('.hud-slot-value');
      const bounds = card.getBoundingClientRect();
      return { text: document.body.innerText.trim(), width: bounds.width, height: bounds.height, radius: getComputedStyle(card).borderRadius, stroke: getComputedStyle(gauge).stroke, strokeWidth: getComputedStyle(gauge).strokeWidth, fraction: Number(gauge.getAttribute('stroke-dasharray').split(' ')[0]), offset: Number(gauge.getAttribute('stroke-dashoffset')), clipped: number.getBoundingClientRect().width > bounds.width - 16, paused: card.classList.contains('is-paused'), labels: document.querySelectorAll('.hud-slot-label').length };
    })()`)
    const delta = fixture.break ? .03 : .00001
    if (result.width !== 88 || result.height !== 26 || result.radius !== '9px' || result.stroke !== 'rgb(255, 149, 0)' || result.strokeWidth !== '2.5px' || Math.abs(result.fraction - fixture.fraction) > delta || Math.abs(result.offset - (result.fraction - 1)) > .00001 || result.clipped || result.labels || !/^\d+:\d{2}(?::\d{2})?$/.test(result.text)) throw new Error(JSON.stringify({fixture,result}))
    fs.writeFileSync(path.join(output, `hud-${fixture.name}.png`), (await win.webContents.capturePage()).toPNG())
    results.push({ name: fixture.name, ...result, window: win.getBounds() })
  }
  if (errors.length) throw new Error(JSON.stringify(errors))
  fs.writeFileSync(path.join(output, 'render-checks.json'), JSON.stringify({ passed: true, results, errors }, null, 2))
  console.log(`PASS ${results.length} rendered HUD states; orange, geometry, gauge, numbers, no clipping/errors`)
  app.quit()
}).catch(error => { console.error(error); app.exit(1) })
