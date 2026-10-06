import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Database } from '@white-box/core/types'
import { createDataIO } from '../src/infra/dataio.js'
import { normalizeDatabase, Store } from '../src/infra/store.js'
import { newRuntime } from '../src/app/state.js'
import { emptyDb, task } from './helpers.js'

const dialogs = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  showMessageBox: vi.fn(),
  showSaveDialog: vi.fn(),
}))
vi.mock('electron', () => ({
  app: { getPath: () => '' },
  dialog: dialogs,
  shell: { openPath: vi.fn() },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function importedDatabase(): Database {
  const db = emptyDb()
  db.settings.onboardedAt = 1
  db.projects = [{ id: 'p', name: 'Imported project', hue: 18, archived: false, priority: 'high', order: 0, createdAt: 10, updatedAt: 20 }]
  db.tasks = [task({ id: 'imported', projectId: 'p', notes: 'original notes', problems: 'problem', decisions: 'decision', nextContext: 'restart here' })]
  const plan = { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 60, allocations: [{ projectId: 'p', mode: 'range' as const, minimumMinutes: 60, maximumMinutes: 120 }] }
  db.weeklyBudgets = [{ ...plan, weekStart: '2026-10-05', createdAt: 10, updatedAt: 20 }]
  db.weeklyBudgetDefaults = structuredClone(plan)
  db.fixedWork = [{ id: 'f', taskId: 'imported', startedAt: 1_000_000, endedAt: 1_060_000, externalReason: 'meeting', cancelled: true, createdAt: 10, updatedAt: 20 }]
  return db
}

let directory: string
let store: Store
let importPath: string
let originalData: Database
let originalFile: string

beforeEach(() => {
  vi.resetAllMocks()
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-dataio-'))
  store = new Store(directory)
  store.data.settings.onboardedAt = 1
  store.data.tasks = [task({ id: 'saved', progress: 70, notes: 'keep this' })]
  store.data.dayNotes = { '2026-10-05': 'keep this day' }
  store.save()
  originalData = structuredClone(store.data)
  originalFile = fs.readFileSync(store.dbPath, 'utf8')
  importPath = path.join(directory, 'import.json')
  fs.writeFileSync(importPath, JSON.stringify(importedDatabase()), 'utf8')
  dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [importPath] })
  dialogs.showMessageBox.mockResolvedValue({ response: 0 })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(directory, { recursive: true, force: true })
})

function expectUnchanged() {
  expect(store.data).toEqual(originalData)
  expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  expect(new Store(directory).data).toEqual(originalData)
}

describe('atomic export', () => {
  it('rejects writing over app-managed data without changing the file', async () => {
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: store.dbPath })
    await expect(createDataIO(store).exportData()).rejects.toThrow('保存ファイル')
    expectUnchanged()
  })

  it('protects the sole pre-import backup while retaining the imported database', async () => {
    store.data.tasks[0]!.notes = 'unique work added after the daily backup'
    store.save()
    const preImport = structuredClone(store.data)
    store.replace(importedDatabase())
    const backups = path.join(directory, 'backups')
    const target = path.join(backups, fs.readdirSync(backups).find((name) => name.startsWith('before-import-'))!)
    const savedBackup = fs.readFileSync(target, 'utf8')
    expect(JSON.parse(savedBackup)).toEqual(preImport)
    expect(fs.readdirSync(backups).filter((name) => JSON.parse(fs.readFileSync(path.join(backups, name), 'utf8')).tasks[0]?.notes === preImport.tasks[0]!.notes)).toHaveLength(1)
    const current = structuredClone(store.data)
    const currentFile = fs.readFileSync(store.dbPath, 'utf8')
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    await expect(createDataIO(store).exportData()).rejects.toThrow('保存ファイル')
    expect(fs.readFileSync(target, 'utf8')).toBe(savedBackup)
    expect(store.data).toEqual(current)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(currentFile)
  })

  it('protects a daily backup selected with different Windows path casing', async () => {
    const backups = path.join(directory, 'backups')
    const target = path.join(backups, fs.readdirSync(backups).find((name) => name.startsWith('data-'))!)
    const savedBackup = fs.readFileSync(target, 'utf8')
    store.data.dayNotes['2026-10-06'] = 'changes newer than the daily backup'
    store.save()
    const currentFile = fs.readFileSync(store.dbPath, 'utf8')
    const selected = process.platform === 'win32' ? target.toUpperCase() : target
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: selected })
    await expect(createDataIO(store).exportData()).rejects.toThrow('保存ファイル')
    expect(fs.readFileSync(target, 'utf8')).toBe(savedBackup)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(currentFile)
  })

  it('protects a managed backup reached through a directory alias', async () => {
    const backups = path.join(directory, 'backups')
    const name = fs.readdirSync(backups).find((item) => item.startsWith('data-'))!
    const target = path.join(backups, name)
    const savedBackup = fs.readFileSync(target, 'utf8')
    const alias = path.join(directory, 'backup-alias')
    fs.symlinkSync(backups, alias, 'junction')
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(alias, name) })
    await expect(createDataIO(store).exportData()).rejects.toThrow('保存ファイル')
    expect(fs.readFileSync(target, 'utf8')).toBe(savedBackup)
    expectUnchanged()
  })

  it('preserves the previous export when replacement fails', async () => {
    const target = path.join(directory, 'previous-export.json')
    fs.writeFileSync(target, 'previous export', 'utf8')
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw new Error('export replacement failed') })
    await expect(createDataIO(store).exportData()).rejects.toThrow('export replacement failed')
    expect(fs.readFileSync(target, 'utf8')).toBe('previous export')
    expect(fs.readdirSync(directory).some((name) => name.includes('.whitebox-'))).toBe(false)
    expectUnchanged()
  })

  it('writes the complete database and rejects completion after quit preparation', async () => {
    const target = path.join(directory, 'export.json')
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: target })
    await expect(createDataIO(store).exportData()).resolves.toBe(target)
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual(originalData)
    await expect(createDataIO(store, () => false).exportData()).rejects.toThrow('終了中')
    expectUnchanged()
  })
})

describe('DataIO import readiness after asynchronous dialogs', () => {
  it('refuses a late file selection during quit preparation before opening confirmation', async () => {
    const selection = deferred<{ canceled: boolean; filePaths: string[] }>()
    dialogs.showOpenDialog.mockReturnValueOnce(selection.promise)
    const runtime = newRuntime()
    const replace = vi.spyOn(store, 'replace')
    const importing = createDataIO(store, () => !runtime.preparingQuit && !runtime.quitting).importData()
    const rejection = expect(importing).rejects.toThrow('アプリを終了中です')
    runtime.preparingQuit = true
    selection.resolve({ canceled: false, filePaths: [importPath] })
    await rejection
    expect(dialogs.showMessageBox).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
    expectUnchanged()
  })

  it.each(['preparingQuit', 'quitting'] as const)('refuses a late positive confirmation while %s without replacing saved data', async (flag) => {
    const confirmation = deferred<{ response: number }>()
    dialogs.showMessageBox.mockReturnValueOnce(confirmation.promise)
    const runtime = newRuntime()
    const replace = vi.spyOn(store, 'replace')
    const importing = createDataIO(store, () => !runtime.preparingQuit && !runtime.quitting).importData()
    const rejection = expect(importing).rejects.toThrow('アプリを終了中です')
    await Promise.resolve()
    expect(dialogs.showMessageBox).toHaveBeenCalledTimes(1)
    runtime[flag] = true
    store.save()
    confirmation.resolve({ response: 0 })
    await rejection
    expect(replace).not.toHaveBeenCalled()
    expectUnchanged()
  })

  it('can retry an import with all planning fields after failed quit preparation restores readiness', async () => {
    const confirmation = deferred<{ response: number }>()
    dialogs.showMessageBox.mockReturnValueOnce(confirmation.promise)
    const runtime = newRuntime()
    const dataIO = createDataIO(store, () => !runtime.preparingQuit && !runtime.quitting)
    const importing = dataIO.importData()
    const rejection = expect(importing).rejects.toThrow('アプリを終了中です')
    await Promise.resolve()
    runtime.preparingQuit = true
    confirmation.resolve({ response: 0 })
    await rejection
    expectUnchanged()
    runtime.preparingQuit = false
    await expect(dataIO.importData()).resolves.toBe(importPath)
    const expected = normalizeDatabase(importedDatabase())
    expect(store.data).toEqual(expected)
    expect(JSON.parse(fs.readFileSync(store.dbPath, 'utf8'))).toEqual(expected)
    expect(new Store(directory).data).toEqual(expected)
  })

  it('rejects malformed JSON before replacing memory or the saved file', async () => {
    fs.writeFileSync(importPath, '{broken', 'utf8')
    const replace = vi.spyOn(store, 'replace')
    await expect(createDataIO(store, () => true).importData()).rejects.toBeInstanceOf(SyntaxError)
    expect(replace).not.toHaveBeenCalled()
    expectUnchanged()
  })

  it('retains file-selection cancellation while readiness is false', async () => {
    dialogs.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    await expect(createDataIO(store, () => false).importData()).resolves.toBeNull()
    expect(dialogs.showMessageBox).not.toHaveBeenCalled()
    expectUnchanged()
  })

  it('retains confirmation cancellation when quit preparation starts while confirmation is open', async () => {
    const confirmation = deferred<{ response: number }>()
    dialogs.showMessageBox.mockReturnValueOnce(confirmation.promise)
    const runtime = newRuntime()
    const importing = createDataIO(store, () => !runtime.preparingQuit && !runtime.quitting).importData()
    await Promise.resolve()
    expect(dialogs.showMessageBox).toHaveBeenCalledTimes(1)
    runtime.preparingQuit = true
    confirmation.resolve({ response: 1 })
    await expect(importing).resolves.toBeNull()
    expectUnchanged()
  })

  it('imports normally when no readiness predicate is supplied', async () => {
    await expect(createDataIO(store).importData()).resolves.toBe(importPath)
    const expected = normalizeDatabase(importedDatabase())
    expect(store.data).toEqual(expected)
    expect(JSON.parse(fs.readFileSync(store.dbPath, 'utf8'))).toEqual(expected)
    expect(new Store(directory).data).toEqual(expected)
  })
})
