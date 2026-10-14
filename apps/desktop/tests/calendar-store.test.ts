import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Store, normalizeDatabase } from '../src/infra/store.js'
import { createDataIO } from '../src/infra/dataio.js'
import { createHandlers } from '../src/app/handlers.js'
import { buildState } from '../src/app/state.js'
import type { CalendarBlock, CalendarBlockInput } from '@white-box/core/types'
import { emptyDb, fakeCtx, task } from './helpers.js'

const dialogs = vi.hoisted(() => ({ showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), showMessageBox: vi.fn() }))
vi.mock('electron', () => ({ app: { getPath: () => '' }, dialog: dialogs, shell: { openPath: vi.fn() } }))
let directory: string
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-calendar-')) })
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); fs.rmSync(directory, { recursive: true, force: true }) })
const input: CalendarBlockInput = { title: 'Routine', category: 'sleep', taskId: null, projectId: null, startedAt: 100, endedAt: 200, repeat: 'weekly', weekdays: [0, 1, 2], until: '2026-10-20' }
const block: CalendarBlock = { ...input, id: 'b', cancelled: true, createdAt: 10, updatedAt: 20 }

function populated() {
  const db = emptyDb()
  db.tasks = [task({ id: 't' })]
  db.settings.onboardedAt = 1
  db.dayNotes = { '2026-10-05': 'unchanged' }
  db.calendarBlocks = [structuredClone(block)]
  db.fixedWork = [{ id: 'legacy', taskId: 't', startedAt: 30, endedAt: 40, externalReason: 'Meeting', cancelled: false, createdAt: 0, updatedAt: 0 }]
  return db
}

describe('calendar storage and import/export', () => {
  it('keeps old databases free of fabricated optional calendar values', () => {
    expect(normalizeDatabase({})).not.toHaveProperty('calendarBlocks')
    const store = new Store(directory)
    store.replace(emptyDb())
    expect(new Store(directory).data).not.toHaveProperty('calendarBlocks')
    expect(buildState(store.data, fakeCtx().runtime, 100).calendarBlocks).toBeUndefined()
  })
  it('roundtrips recurring/cancelled schedules, fixed work and unrelated data through export/import/restart', async () => {
    const store = new Store(directory)
    store.replace(populated())
    const before = structuredClone(store.data)
    const exported = path.join(directory, 'export.json')
    dialogs.showSaveDialog.mockResolvedValue({ canceled: false, filePath: exported })
    const dataIO = createDataIO(store)
    expect(await dataIO.exportData()).toBe(exported)
    expect(JSON.parse(fs.readFileSync(exported, 'utf8'))).toEqual(before)
    store.replace(emptyDb())
    dialogs.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [exported] })
    dialogs.showMessageBox.mockResolvedValue({ response: 0 })
    expect(await dataIO.importData()).toBe(exported)
    expect(store.data).toEqual(before)
    expect(new Store(directory).data).toEqual(before)
  })
  it('preserves stored snapshot associations after linked data is moved or deleted', () => {
    const db = populated()
    db.calendarBlocks = [{ ...block, category: 'work', taskId: 'deleted', projectId: 'deleted' }]
    const store = new Store(directory)
    store.replace(db)
    expect(new Store(directory).data.calendarBlocks).toEqual(db.calendarBlocks)
  })
  it('rejects duplicate IDs, inconsistent input and unknown persisted fields before replacing memory/disk', () => {
    const store = new Store(directory)
    store.replace(populated())
    const before = structuredClone(store.data)
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    const backups = fs.readdirSync(path.join(directory, 'backups'))
    for (const calendarBlocks of [[block, block], [{ ...block, weekdays: [1, 1] }], [{ ...block, endedAt: 99 }], [{ ...block, typo: 'bad' }]]) {
      expect(() => store.replace({ ...before, calendarBlocks })).toThrow()
      expect(store.data).toEqual(before)
      expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
      expect(fs.readdirSync(path.join(directory, 'backups'))).toEqual(backups)
    }
  })
  it('restores exact memory and file for create/update after real write and rename failures', () => {
    const store = new Store(directory)
    store.replace(populated())
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = () => store.save()
    const handlers = createHandlers(ctx)
    handlers['calendar:update']({ id: 'b', patch: { title: 'saved baseline' } })
    const before = structuredClone(store.data)
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    for (const operation of ['writeFileSync', 'renameSync'] as const) {
      const failure = vi.spyOn(fs, operation).mockImplementation(() => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }) })
      expect(() => handlers['calendar:create'](input)).toThrow('I/O failure')
      expect(() => handlers['calendar:update']({ id: 'b', patch: { title: 'unsaved', cancelled: false } })).toThrow('I/O failure')
      expect(store.data).toEqual(before)
      expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
      failure.mockRestore()
    }
  })
})
