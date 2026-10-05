/**
 * 全ユースケースの Electron 起動なしテスト。
 * 網羅テストは「全 54 コマンドが偽 Port で実行でき、返り値が契約の result スキーマを通る」を固定する。
 */
import { describe, expect, it } from 'vitest'
import { COMMANDS, type ArgsOf, type CommandName } from '@white-box/contracts'
import { focusMs, MINUTE } from '@white-box/core/engine'
import { createHandlers, dispatch } from '../src/app/handlers.js'
import { checkExpire, restoreOpenSession } from '../src/app/lifecycle.js'
import { buildState, liveSession } from '../src/app/state.js'
import { emptyDb, fakeCtx, task } from './helpers.js'

describe('ユースケースの網羅（54 コマンド）', () => {
  it('全コマンドにハンドラが実在し、契約のコマンド一覧と一致する', () => {
    const handlers = createHandlers(fakeCtx())
    expect(Object.keys(handlers).sort()).toEqual(Object.keys(COMMANDS).sort())
  })

  it('全コマンドが偽 Port で実行でき、返り値が契約の result スキーマを通る', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 't1' }), task({ id: 't2' })]
    const goal = (id: string) => ({ id, goal: id, reason: '', parentId: null, children: [], hidden: false, hiddenAt: null, hideReason: '' })
    db.goalMap.nodes = { g1: goal('g1'), g2: goal('g2') }
    db.goalMap.heads = ['g1', 'g2']
    db.goalMap.issues = [{ id: 'i1', text: '難点', kind: 'problem', nodeId: null, resolved: false, createdAt: 0 }]
    db.presenceCandidates = [{ id: 'candidate', sessionId: 'finished', startedAt: 0, endedAt: 10_000, status: 'pending', createdAt: 10_000, reviewedAt: null }]
    const ctx = fakeCtx(db)
    // 復旧系・レビュー系が「対象あり」の経路を通るよう、実行時状態を仕込む
    const handlers = createHandlers(ctx)
    await dispatch(handlers, 'session:start', { taskId: 't1', minutes: 50 })
    const sessionId = ctx.store.data.sessions[0]!.id
    db.notes = [{ id: 'n1', title: 'ノート', body: '', projectId: null, taskId: null, pinned: false, archived: false, remindAt: null, remindedAt: null, createdAt: 0, updatedAt: 0 }]
    db.sessions.push({ ...db.sessions[0]!, id: 'finished', state: 'ended', endedAt: ctx.now() })
    ctx.runtime.recovery = { sessionId, lastKnownAt: ctx.now() }

    const sample: { [N in CommandName]: ArgsOf<N> } = {
      'presence:resolve': { id: 'candidate', decision: 'dismiss' },
      'agent:config': {},
      'agent:context': {},
      'agent:applyPlan': { requestId: 'plan', tasks: [{ title: 'Inboxへ登録' }] },
      'agent:propose': { sessionId: 'finished', taskId: 't1', reason: '本人の依頼' },
      'agent:resolve': { id: 'nothing', accept: false },
      'note:create': { title: 'ノート' },
      'note:update': { id: 'n1', patch: { body: '更新' } },
      'note:archive': { id: 'n1', archived: true },
      'note:markReminded': { id: 'n1', remindAt: 0 },
      'state:get': {},
      'project:create': { name: 'P' },
      'project:update': { id: 'p1', patch: { name: 'P2' } },
      'project:delete': { id: 'p1' },
      'task:create': { title: 'T' },
      'task:update': { id: 't1', patch: { progress: 10 } },
      'task:move': { id: 't2', status: 'todo', index: 0 },
      'task:delete': { id: 't2' },
      'task:hasTime': { id: 't1' },
      'goal:create': { goal: '新しい目標' },
      'goal:update': { id: 'g1', patch: { reason: '理由', outcome: { result: '決まった' } } },
      'goal:merge': { ids: ['g1', 'g2'], goal: '統合' },
      'goal:hide': { id: 'g1', reason: '休止' },
      'goal:restore': { id: 'g1' },
      'goal:ui': { patch: { view: 'map' } },
      'goal:import': { data: { version: 1, nodes: { n1: { id: 'n1', goal: '取込', reason: '', parentId: null, children: [] } }, heads: ['n1'], activeHeadId: 'n1' } },
      'issue:create': { kind: 'idea', text: '改善', nodeId: 'g1' },
      'issue:update': { id: 'i1', patch: { resolved: true } },
      'issue:delete': { id: 'i1' },
      'session:start': { taskId: 't1', minutes: 50 },
      'session:pause': {},
      'session:resume': {},
      'session:toggle': {},
      'session:extend': { minutes: 5 },
      'session:break': { minutes: 5 },
      'session:switchTask': { taskId: 't1' },
      'session:end': {},
      'session:review': { sessionId, changes: [{ taskId: 't1', from: 0, to: 50, markedDone: false }] },
      'session:skipReview': {},
      'session:update': { id: sessionId, patch: { note: 'n' } },
      'session:delete': { id: 'ses_nothing' },
      'recovery:close': {},
      'recovery:resume': {},
      'window:open': { kind: 'main' },
      'window:close': { kind: 'main' },
      'window:toggle': { kind: 'main' },
      'window:minimize': {},
      'settings:update': { patch: { dayStartHour: 5 } },
      'day:note': { key: '2026-08-21', text: 'メモ' },
      'welcome:dismiss': {},
      'data:export': {},
      'data:import': {},
      'data:reveal': {},
      'app:quit': {},
    }

    for (const name of Object.keys(COMMANDS) as CommandName[]) {
      const result = await dispatch(handlers, name, sample[name] as never)
      const parsed = COMMANDS[name].result.safeParse(result)
      expect(parsed.success, `${name} の返り値が契約と一致しない: ${JSON.stringify(result)}`).toBe(true)
    }
  })
})

it('初回設定のショートカットが登録できなければ保存せず元の割り当てに戻す', async () => {
  const ctx = fakeCtx()
  let attempts = 0
  ctx.system.applyShortcuts = () => {
    attempts++
    return attempts === 1 ? ['Control+Alt+S'] : []
  }
  const handlers = createHandlers(ctx)

  await expect(dispatch(handlers, 'settings:update', {
    patch: {
      displayName: 'まひろ',
      onboardedAt: ctx.now(),
      shortcuts: { startPause: 'Control+Alt+S', currentWork: '', dashboard: '' },
    },
  })).rejects.toThrow('Control+Alt+S')

  expect(ctx.store.data.settings.displayName).toBe('')
  expect(ctx.store.data.settings.onboardedAt).toBeNull()
  expect(ctx.store.data.settings.shortcuts.startPause).toBe('')
  expect(attempts).toBe(2)
})

describe('セッションの一連の流れ（Electron なし）', () => {
  it('開始→一時停止→再開→切替→終了→レビューで、実作業と進捗が正しく残る', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a', progress: 20 }), task({ id: 'b' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)

    const started = await dispatch(h, 'session:start', { taskId: 'a', minutes: 50 })
    expect(started?.state).toBe('running')
    expect(ctx.calls).toContain('open:hud')
    expect(ctx.calls).toContain('ticker:start')
    expect(db.tasks.find((t) => t.id === 'a')!.status).toBe('doing')

    ctx.advance(20 * MINUTE)
    await dispatch(h, 'session:pause', {})
    ctx.advance(7 * MINUTE)
    await dispatch(h, 'session:resume', {})
    ctx.advance(10 * MINUTE)
    await dispatch(h, 'session:switchTask', { taskId: 'b' })
    ctx.advance(20 * MINUTE)
    await dispatch(h, 'session:end', {})

    const s = db.sessions[0]!
    expect(s.state).toBe('ended')
    // 実作業 = 経過 57 分 − 停止 7 分 = 50 分
    expect(focusMs(s, ctx.now())).toBe(50 * MINUTE)
    expect(s.segments).toHaveLength(2)
    expect(ctx.runtime.pendingReview?.sessionId).toBe(s.id)
    expect(ctx.calls).toContain('ticker:stop')
    expect(ctx.calls).toContain('open:review')

    await dispatch(h, 'session:review', {
      sessionId: s.id,
      changes: [
        { taskId: 'a', from: 20, to: 60, markedDone: false },
        { taskId: 'b', from: 0, to: 100, markedDone: true },
      ],
      note: 'テスト',
    })
    expect(ctx.runtime.pendingReview).toBeNull()
    expect(db.tasks.find((t) => t.id === 'a')!.progress).toBe(60)
    expect(db.tasks.find((t) => t.id === 'b')!.status).toBe('done')
    expect(db.sessions[0]!.note).toBe('テスト')
  })

  it('二重開始はできない（実行中があれば null が返る）', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    const second = await dispatch(h, 'session:start', { taskId: 'a' })
    expect(second).toBeNull()
    expect(db.sessions).toHaveLength(1)
  })

  it('既に止まっているセッションへの一時停止は、状態にも窓にも触らない', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    await dispatch(h, 'session:pause', {})
    const pausesAfterFirst = JSON.stringify(db.sessions[0]!.pauses)
    const eventsAfterFirst = db.sessions[0]!.events.length
    const mark = ctx.calls.length

    // スリープは lock-screen と suspend を続けて撃つので、二度目はここへ来る
    await dispatch(h, 'session:pause', { reason: 'lock' })

    expect(ctx.calls.slice(mark)).toEqual([])
    expect(JSON.stringify(db.sessions[0]!.pauses)).toBe(pausesAfterFirst)
    expect(db.sessions[0]!.events).toHaveLength(eventsAfterFirst)
  })

  it('新規タスクと同時に開始すると doing で作られる', async () => {
    const ctx = fakeCtx()
    const h = createHandlers(ctx)
    const s = await dispatch(h, 'session:start', { newTask: { title: '書きかけの仕事' }, minutes: 25 })
    expect(s?.plannedMs).toBe(25 * MINUTE)
    expect(ctx.store.data.tasks[0]!.status).toBe('doing')
  })

  it('指定した休憩時間は作業時間を止め、満了通知後も再開までは止まる', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', minutes: 50 })
    ctx.advance(20 * MINUTE)
    await dispatch(h, 'session:break', { minutes: 7 })
    const startedAt = ctx.now()
    expect(buildState(db, ctx.runtime, ctx.now()).breakTimer).toEqual({
      startedAt,
      endsAt: startedAt + 7 * MINUTE,
      notifiedAt: null,
    })
    expect(db.sessions[0]!.pauses.at(-1)?.reason).toBe('break')
    ctx.advance(7 * MINUTE)
    checkExpire(ctx)
    expect(ctx.calls).toContain('open:expire')
    expect(buildState(db, ctx.runtime, ctx.now()).breakTimer?.notifiedAt).toBe(ctx.now())
    ctx.advance(5 * MINUTE)
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(20 * MINUTE)
    await dispatch(h, 'session:resume', {})
    expect(buildState(db, ctx.runtime, ctx.now()).breakTimer).toBeNull()
    expect(ctx.calls).toContain('closeLater:expire')
    ctx.advance(MINUTE)
    expect(focusMs(db.sessions[0]!, ctx.now())).toBe(21 * MINUTE)
  })
})

describe('復旧と満了（lifecycle）', () => {
  it('休憩中の再起動では復旧確認を出さず、休憩満了の監視を再開する', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    await dispatch(h, 'session:break', { minutes: 5 })
    ctx.setLastAlive(ctx.now())
    ctx.advance(10 * MINUTE)
    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery).toBeNull()
    expect(ctx.calls.filter((c) => c === 'ticker:start')).toHaveLength(2)
    checkExpire(ctx)
    expect(db.sessions[0]!.pauses.at(-1)?.notifiedAt).toBe(ctx.now())
  })

  it('記録の空白が閾値を超えていたら、最後に生きていた時刻で止めて人間に聞く', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    ctx.setLastAlive(ctx.now() + 60_000)
    ctx.advance(10 * MINUTE) // 起動時点は開始から 10 分後・記録は 1 分後で途絶

    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery).not.toBeNull()
    const lastKnown = ctx.runtime.recovery!.lastKnownAt
    // 一時停止が「最後に生きていた時刻」から始まっている = 空白は実作業に入らない
    const s = liveSession(db)!
    expect(s.pauses.at(-1)!.startedAt).toBe(lastKnown)

    await dispatch(h, 'recovery:close', {})
    expect(db.sessions[0]!.state).toBe('ended')
    expect(db.sessions[0]!.endedAt).toBe(lastKnown) // PC が落ちていた時間は実作業に入らない
    expect(ctx.runtime.pendingReview?.sessionId).toBe(db.sessions[0]!.id)
    expect(ctx.runtime.recovery).toBeNull()
  })

  it('空白が短ければそのまま計測を続ける', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    ctx.setLastAlive(ctx.now())
    ctx.advance(30_000)
    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery).toBeNull()
    expect(ctx.calls.filter((c) => c === 'ticker:start')).toHaveLength(2) // 開始時 + 復旧時
  })

  it('生存記録より新しい操作があれば、その操作時刻を復旧の基点にする', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a' })
    const lastAlive = ctx.now()
    ctx.setLastAlive(lastAlive)
    ctx.advance(2 * MINUTE)
    await dispatch(h, 'session:pause', {})
    await dispatch(h, 'session:resume', {})
    const lastRecordedAt = ctx.now()
    ctx.advance(10 * MINUTE)

    restoreOpenSession(ctx, 90_000)
    expect(ctx.runtime.recovery?.lastKnownAt).toBe(lastRecordedAt)
    expect(liveSession(db)?.pauses.at(-1)?.startedAt).toBe(lastRecordedAt)
  })

  it('予定時間に到達したら満了の印を付けてポップアップを出す（1 回だけ）', async () => {
    const db = emptyDb()
    db.tasks = [task({ id: 'a' })]
    const ctx = fakeCtx(db)
    const h = createHandlers(ctx)
    await dispatch(h, 'session:start', { taskId: 'a', minutes: 50 })

    ctx.advance(49 * MINUTE)
    checkExpire(ctx)
    expect(ctx.calls).not.toContain('open:expire')

    ctx.advance(2 * MINUTE)
    checkExpire(ctx)
    expect(ctx.calls).toContain('open:expire')
    const before = ctx.calls.filter((c) => c === 'open:expire').length
    checkExpire(ctx) // 既に通知済みなら二度出さない
    expect(ctx.calls.filter((c) => c === 'open:expire')).toHaveLength(before)
  })
})
