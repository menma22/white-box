const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const childProcess = require('node:child_process')
const { pathToFileURL } = require('node:url')
const electron = require('electron')
const root = path.dirname(__dirname)

if (typeof electron === 'string') {
  const outputRoot = path.join(root, '.e2e')
  fs.mkdirSync(outputRoot, { recursive: true })
  const output = fs.mkdtempSync(path.join(outputRoot, 'note-reminders-run-'))
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const child = childProcess.spawn(electron, [__filename, `--note-reminders-output=${output}`], {
    cwd: root, env, windowsHide: true, stdio: 'inherit',
  })
  const timeout = setTimeout(() => child.kill(), 55_000)
  child.on('error', error => { clearTimeout(timeout); console.error(error); process.exitCode = 1 })
  child.on('exit', code => {
    clearTimeout(timeout)
    console.log(`Note reminder verification: ${path.join(output, 'result.json')}`)
    process.exitCode = code ?? 1
  })
} else {
  const { app, BrowserWindow, Notification } = electron
  const outputArgument = process.argv.find(value => value.startsWith('--note-reminders-output='))
  if (!outputArgument) throw new Error('Run this harness with node so it creates an isolated output directory')
  const output = path.resolve(outputArgument.slice('--note-reminders-output='.length))
  assert.equal(path.dirname(output), path.join(root, '.e2e'))
  const profile = path.join(output, 'profile')
  fs.mkdirSync(profile, { recursive: true })
  app.setPath('userData', profile)
  app.setPath('sessionData', path.join(profile, 'session'))
  app.setPath('crashDumps', path.join(profile, 'crashes'))
  app.setAppLogsPath(path.join(output, 'logs'))
  const checks = [], errors = [], notices = []
  let services
  const originalShow = Notification.prototype.show
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
  const check = (name, condition, detail) => {
    checks.push({ name, passed: Boolean(condition), ...(detail === undefined ? {} : { detail }) })
    assert.ok(condition, name)
  }
  const finish = code => {
    services?.stop()
    Notification.prototype.show = originalShow
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      exitCode: code, checks, errors, notifications: notices, realNotification: true,
      createdBrowserWindows: BrowserWindow.getAllWindows().length, usedRealUserData: false,
    }, null, 2) + '\n')
    console.log(JSON.stringify({ exitCode: code, checks: checks.length, notificationShowCalls: notices.length,
      nativeShowEvents: notices.filter(value => value.showEvent).length, nativeFailures: notices.filter(value => value.failed).length }))
    app.exit(code)
  }
  app.whenReady().then(async () => {
    app.setAppUserModelId('dev.whitebox.app')
    check('Runs on real Windows', process.platform === 'win32')
    const source = path.join(root, 'apps', 'desktop', 'src', 'infra', 'note-reminders.ts')
    const compiled = path.join(root, 'dist-electron', 'infra', 'note-reminders.js')
    check('Note reminders were compiled from current source', fs.statSync(compiled).mtimeMs >= fs.statSync(source).mtimeMs)
    const importBuilt = relative => import(pathToFileURL(path.join(root, 'dist-electron', `${relative}.js`)).href)
    const { Store } = await importBuilt('infra/store')
    const { newRuntime, liveSession } = await importBuilt('app/state')
    const { createNoteReminders } = await importBuilt('infra/note-reminders')
    const directory = path.join(output, 'data')
    let store = new Store(directory)
    const startedAt = Date.now()
    let clock = startedAt
    const note = (id, remindAt, extra = {}) => ({
      id, title: `White Box verification ${id}`, body: 'Isolated background reminder verification',
      projectId: null, taskId: null, pinned: false, archived: false,
      remindAt, remindedAt: null, createdAt: startedAt, updatedAt: startedAt, ...extra,
    })
    store.data.notes = [
      note('due', startedAt - 1000), note('future', startedAt + 86_400_000),
      note('archived', startedAt - 1000, { archived: true }),
      note('delivered', startedAt - 1000, { remindedAt: startedAt - 500 }),
    ]
    const legacy = { id: 'legacy', title: 'Saved before reminders', body: 'Preserve the editor content', projectId: null, taskId: null, pinned: true, archived: false, createdAt: startedAt, updatedAt: startedAt }
    fs.writeFileSync(store.dbPath, JSON.stringify({ ...store.data, notes: [...store.data.notes, legacy] }))
    store = new Store(directory)
    check('Disk Store migrates editor-only notes while preserving their content', require('node:util').isDeepStrictEqual(store.data.notes.at(-1), { ...legacy, remindAt: null, remindedAt: null }))
    store.save()
    const originalNotes = structuredClone(store.data.notes)
    const originalRest = structuredClone({ ...store.data, notes: undefined })
    let publishes = 0
    const windowCalls = []
    const ctx = {
      get store() { return store }, runtime: newRuntime(), now: () => clock,
      publish: () => { publishes++; store.save() },
      windows: {
        open: (...args) => windowCalls.push(['open', ...args]),
        close: (...args) => windowCalls.push(['close', ...args]),
        toggle: (...args) => windowCalls.push(['toggle', ...args]),
        minimizeFocused() {}, closeLater() {},
      },
      ticker: { start() {}, stop() {} }, system: { applyShortcuts: () => [], applyLoginItem() {}, quit() {} },
      dataIO: { exportData: async () => null, importData: async () => null, revealDataDir() {} },
    }
    Notification.prototype.show = function (...args) {
      const record = { title: this.title, showEvent: false, closed: false, failed: null,
        persistedBeforeShow: JSON.parse(fs.readFileSync(store.dbPath, 'utf8')).notes.find(value => value.id === 'due').remindedAt === startedAt }
      notices.push(record)
      this.on('show', () => { record.showEvent = true })
      this.on('close', () => { record.closed = true })
      this.on('failed', (_event, error) => { record.failed = String(error ?? 'Native notification failed') })
      return originalShow.apply(this, args)
    }
    check('Electron native notifications are supported', Notification.isSupported())
    check('No ordinary window or live session exists', BrowserWindow.getAllWindows().length === 0 && liveSession(store.data) === null)
    services = createNoteReminders(ctx)
    const persisted = JSON.parse(fs.readFileSync(store.dbPath, 'utf8'))
    check('Due reminder is saved and real Notification.show is called without a window',
      notices.length === 1 && notices[0].persistedBeforeShow && persisted.notes.find(value => value.id === 'due').remindedAt === startedAt)
    check('Future, archived and previously delivered notes remain unchanged',
      JSON.stringify(persisted.notes.slice(1)) === JSON.stringify(originalNotes.slice(1)))
    await delay(10_500)
    check('Two real five-second timer ticks do not show the same reminder again', notices.length === 1 && publishes === 1)
    check('Background operation does not create or request any application window', BrowserWindow.getAllWindows().length === 0 && windowCalls.length === 0)
    check('Background operation leaves all other stored data unchanged', JSON.stringify({ ...store.data, notes: undefined }) === JSON.stringify(originalRest))
    services.stop()
    services = undefined
    store = new Store(directory)
    check('A new Store reads the persisted delivery marker', store.data.notes.find(value => value.id === 'due').remindedAt === startedAt)
    services = createNoteReminders(ctx)
    await delay(5200)
    check('Restarted background service does not repeat the persisted reminder', notices.length === 1 && publishes === 1)
    services.stop()
    services = undefined
    clock = startedAt + 86_400_001
    await delay(5200)
    check('stop removes the timer even when a future reminder becomes due', notices.length === 1 && store.data.notes.find(value => value.id === 'future').remindedAt === null)
    const native = notices[0]
    checks.push({ name: 'Native OS display event observation', passed: native.showEvent && !native.failed,
      detail: { showEvent: native.showEvent, failed: native.failed,
        limit: native.showEvent ? 'Electron reported native display; toast pixels were not captured' : 'No native show event was observed; Notification.show call and persistence were verified' } })
    assert.ok(native.showEvent && !native.failed, 'Native display event was not observed or failed')
    finish(0)
  }).catch(error => {
    errors.push(error.stack ?? String(error))
    console.error(error)
    finish(1)
  })
  setTimeout(() => { errors.push('Note reminder verification timed out'); finish(1) }, 50_000).unref()
}
