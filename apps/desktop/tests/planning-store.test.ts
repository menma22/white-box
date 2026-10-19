import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { normalizeDatabase, Store } from '../src/infra/store.js'
import { createHandlers } from '../src/app/handlers.js'
import { buildState } from '../src/app/state.js'
import { weekBounds } from '@white-box/core/weekly-budget'
import { emptyDb, fakeCtx, task } from './helpers.js'

vi.mock('electron', () => ({ app: { getPath: () => '' } }))
let directory: string
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'white-box-planning-')) })
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(directory, { recursive: true, force: true }) })

const project = { id: 'p', name: 'P', hue: 18, archived: false, order: 0, createdAt: 0, updatedAt: 0 }
const plan = { sleepMinutes: 3360, mealMinutes: 840, fixedMinutes: 60, allocations: [{ projectId: 'p', mode: 'range' as const, minimumMinutes: 60, maximumMinutes: 120 }] }
const monday = weekBounds('2026-10-05').startedAt

describe('phase 2 planning persistence', () => {
  it('does not fabricate old-data project priority, weekly budget or task context', () => {
    const db = normalizeDatabase({ projects: [project], tasks: [task({ id: 'old' })] })
    expect(db.projects[0]).not.toHaveProperty('priority')
    expect(db.tasks[0]).not.toHaveProperty('nextContext')
    expect(db).not.toHaveProperty('weeklyBudgets')
    expect(db).not.toHaveProperty('weeklyBudgetDefaults')
    expect(db).not.toHaveProperty('fixedWork')
  })
  it('saves and reloads exact plans, contexts, linked notes and cancelled fixed registrations', () => {
    const store = new Store(directory)
    const db = emptyDb()
    db.projects = [{ ...project, priority: 'high' }]
    db.tasks = [task({ id: 't', notes: 'original', problems: 'problem', decisions: 'decision', nextContext: 'restart step' })]
    db.notes = [{ id: 'n', title: 'linked', body: 'body', projectId: null, taskId: 't', pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 0, updatedAt: 0 }]
    db.weeklyBudgets = [{ ...plan, weekStart: '2026-10-05', createdAt: 10, updatedAt: 20 }]
    db.weeklyBudgetDefaults = structuredClone(plan)
    db.fixedWork = [{ id: 'f', taskId: 't', startedAt: monday, endedAt: monday + 60_000, externalReason: 'meeting', cancelled: true, createdAt: 10, updatedAt: 20 }]
    store.replace(db)
    const restarted = new Store(directory)
    expect(restarted.data.tasks).toEqual(db.tasks)
    expect(restarted.data.projects).toEqual(db.projects)
    expect(restarted.data.weeklyBudgets).toEqual(db.weeklyBudgets)
    expect(restarted.data.weeklyBudgetDefaults).toEqual(db.weeklyBudgetDefaults)
    expect(restarted.data.fixedWork).toEqual(db.fixedWork)
    expect(buildState(restarted.data, fakeCtx().runtime, monday).notes![0]!.taskId).toBe('t')
  })
  it('retains planned references after a task/project disappears', () => {
    const db = normalizeDatabase({ weeklyBudgets: [{ ...plan, weekStart: '2026-10-05', createdAt: 0, updatedAt: 0 }], fixedWork: [{ id: 'f', taskId: 'deleted', startedAt: monday, endedAt: monday + 60_000, externalReason: 'meeting', cancelled: false, createdAt: 0, updatedAt: 0 }] })
    expect(db.weeklyBudgets![0]!.allocations[0]!.projectId).toBe('p')
    expect(db.fixedWork![0]!.taskId).toBe('deleted')
  })
  it('preserves a priority on rename and persists an explicitly unset priority as absent', () => {
    const store = new Store(directory)
    store.replace({ ...emptyDb(), projects: [{ ...project, priority: 'high' }], tasks: [task({ id: 't', priority: 'low' })] })
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = () => store.save()
    const handlers = createHandlers(ctx)
    handlers['project:update']({ id: 'p', patch: { name: 'Renamed' } })
    expect(store.data.projects[0]!.priority).toBe('high')
    handlers['project:update']({ id: 'p', patch: { priority: undefined } })
    expect(new Store(directory).data.projects[0]).not.toHaveProperty('priority')
    expect(store.data.tasks[0]!.priority).toBe('low')
  })
  it('rejects malformed new fields and duplicate persistent records', () => {
    const budget = { ...plan, weekStart: '2026-10-05', createdAt: 0, updatedAt: 0 }
    expect(() => normalizeDatabase({ weeklyBudgets: [budget, budget] })).toThrow('重複')
    expect(() => normalizeDatabase({ projects: [{ ...project, priority: 'invalid' as never }] })).toThrow()
    expect(() => normalizeDatabase({ tasks: [task({ id: 't', nextContext: 1 as never })] })).toThrow('文脈')
    expect(() => normalizeDatabase({ weeklyBudgetDefaults: { ...plan, sleepMinutes: -1 } })).toThrow()
  })
  it('restores memory and the exact previous file when a planning transaction cannot save', () => {
    const store = new Store(directory)
    store.replace({ ...emptyDb(), projects: [project], tasks: [task({ id: 't' })] })
    const ctx = fakeCtx(store.data)
    ctx.store = store
    ctx.publish = () => store.save()
    const originalData = structuredClone(store.data)
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    vi.spyOn(fs, 'renameSync').mockImplementation(() => { throw Object.assign(new Error('I/O failure'), { code: 'EIO' }) })
    const handlers = createHandlers(ctx)
    expect(() => handlers['weeklyBudget:set']({ weekStart: '2026-10-05', plan, reuseAsDefault: true })).toThrow('I/O failure')
    expect(() => handlers['fixedWork:create']({ taskId: 't', startedAt: ctx.now() + 1, endedAt: ctx.now() + 2, externalReason: 'meeting' })).toThrow('I/O failure')
    expect(() => handlers['task:update']({ id: 't', patch: { nextContext: 'unsaved' } })).toThrow('I/O failure')
    expect(store.data).toEqual(originalData)
    expect(Object.keys(store.data)).toEqual(Object.keys(originalData))
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  })
  it('rejects invalid planning imports before replacing memory or disk', () => {
    const store = new Store(directory)
    store.save()
    const originalData = structuredClone(store.data)
    const originalFile = fs.readFileSync(store.dbPath, 'utf8')
    expect(() => store.replace({ ...store.data, weeklyBudgetDefaults: { ...plan, fixedMinutes: -1 } })).toThrow()
    expect(store.data).toEqual(originalData)
    expect(fs.readFileSync(store.dbPath, 'utf8')).toBe(originalFile)
  })
})
