import { forwardRef, useImperativeHandle, useMemo, useRef, useState, type RefObject } from 'react'
import { useApp, useData } from '@/stores/app'
import { projectColor } from '@/lib/selectors'
import { activitySlices, activitySummary, dayRange, shiftDay, weekKey } from '@white-box/core/activity'
import { dayKey, formatDuration, pausedMsWithin } from '@white-box/core/engine'
import { calendarOccurrences } from '@white-box/core/calendar'
import { weekBounds } from '@white-box/core/weekly-budget'
import { Modal, Segmented } from '@/components/ui'
import { ActivityBreakdown } from './ActivityBreakdown'
import { ActivityTrend } from './ActivityTrend'
import { SessionRow } from '@/features/sessions/SessionRow'
import { TaskWarnings } from '@/features/task-control/TaskWarnings'
import type { TaskDetailTarget } from '@/features/board/TaskDetail'
import { WeeklyBudget, type BudgetDraftCache, type WeeklyBudgetHandle } from './WeeklyBudget'
import type { BudgetDraftStorage } from './budget-drafts'
import { FixedWorkEditor } from '@/features/board/FixedWorkEditor'
import { FixedWorkOverview } from '@/features/board/FixedWorkOverview'
import { invoke } from '@/lib/bridge'
import { CalendarEditor } from './CalendarEditor'
import { WeekCalendar } from './WeekCalendar'
import { WeekBudgetPanel } from './WeekBudgetPanel'
import type { CalendarEvent } from './calendar-layout'
import { GoogleCalendarSettings } from '@/features/google-calendar/GoogleCalendarSettings'
import { GoogleEventEditor } from '@/features/google-calendar/GoogleEventEditor'
import { GoogleEventDetail } from '@/features/google-calendar/GoogleEventDetail'
import { googleCalendarEvent, selectedGoogleEvents } from '@/features/google-calendar/google-calendar'
import { useGoogleCalendarRange } from '@/features/google-calendar/useGoogleCalendarRange'
import { runEditorAction } from '@/lib/useEditorFlush'

export interface WeekViewHandle { flush(): Promise<boolean> }
type Editor = { blockId?: string; startedAt: number; endedAt: number }
export const WeekView = forwardRef<WeekViewHandle, { onOpenTask?: (id: string, target?: TaskDetailTarget) => void; budgetDrafts?: RefObject<BudgetDraftCache>; budgetDraftStorage?: BudgetDraftStorage }>(function WeekView({ onOpenTask, budgetDrafts, budgetDraftStorage }, ref) {
  const state = useData()
  const now = useApp((app) => app.now)
  const today = dayKey(now, 0)
  const currentWeek = weekKey(today)
  const [chosenWeek, setChosenWeek] = useState<string | null>(null)
  const [dateDraft, setDateDraft] = useState<string | null>(null)
  const [dateError, setDateError] = useState('')
  const start = chosenWeek ?? currentWeek
  const [layer, setLayer] = useState<'both' | 'planned' | 'actual'>('both')
  const [zoom, setZoom] = useState(true)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [googleEditor, setGoogleEditor] = useState<Editor | null>(null)
  const [googleSettingsOpen, setGoogleSettingsOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [fixedEditor, setFixedEditor] = useState(false)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [fixedCancel, setFixedCancel] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const ownBudgetDrafts = useRef<BudgetDraftCache>(budgetDraftStorage?.drafts ?? {})
  const drafts = budgetDrafts ?? ownBudgetDrafts
  const budget = useRef<WeeklyBudgetHandle | null>(null)
  const period = useMemo(() => weekBounds(start), [start])
  const googleRangeError = useGoogleCalendarRange(Boolean(state.googleCalendar?.connected), period.startedAt, period.endedAt, state.googleCalendar)
  const googleEvents = selectedGoogleEvents(state.googleCalendar, period).map(googleCalendarEvent)
  const summary = useMemo(() => activitySummary(state.sessions, state.tasks, now, period), [state.sessions, state.tasks, now, period])
  const days = Array.from({ length: 7 }, (_, index) => {
    const key = shiftDay(start, index)
    return { key, summary: activitySummary(state.sessions, state.tasks, now, dayRange(key, 0)) }
  })
  const planned = useMemo<CalendarEvent[]>(() => [
    ...calendarOccurrences(state.calendarBlocks ?? [], period).map((item) => ({
      key: item.blockId + ':' + item.startedAt, kind: item.category === 'work' ? 'planned' as const : 'routine' as const,
      title: item.title, startedAt: item.startedAt, endedAt: item.endedAt, blockId: item.blockId, taskId: item.taskId, recurring: item.repeat === 'weekly',
      color: projectColor(state.projects.find((project) => project.id === item.projectId) ?? null),
    })),
    ...(state.fixedWork ?? []).filter((work) => !work.cancelled && work.startedAt < period.endedAt && work.endedAt > period.startedAt).map((work) => {
      const task = state.tasks.find((item) => item.id === work.taskId)
      return { key: work.id, kind: 'fixed' as const, title: task?.title ?? '削除されたタスク', startedAt: work.startedAt, endedAt: work.endedAt, blockId: work.id, taskId: work.taskId,
        color: projectColor(state.projects.find((project) => project.id === task?.projectId) ?? null) }
    }),
  ], [state.calendarBlocks, state.fixedWork, state.tasks, state.projects, period])
  const actual = useMemo<CalendarEvent[]>(() => activitySlices(state.sessions, now, period).map((slice) => {
    const task = state.tasks.find((item) => item.id === slice.taskId)
    return { ...slice, key: slice.sessionId + ':' + slice.startedAt, kind: 'actual', title: task?.title ?? (slice.taskId ? '削除されたタスク' : '実作業（タスクなし）'),
      color: projectColor(state.projects.find((project) => project.id === task?.projectId) ?? null),
      live: state.sessions.some((session) => session.id === slice.sessionId && session.endedAt === null) && slice.endedAt === now }
  }), [state.sessions, state.tasks, state.projects, now, period])
  const workPlanned = pausedMsWithin(planned.filter((event) => event.kind !== 'routine').map((event) => ({ startedAt: event.startedAt, endedAt: event.endedAt, reason: null })), period.startedAt, period.endedAt, period.endedAt)
  async function flush() {
    if (budget.current) return budget.current.flush()
    if (drafts.current[start]?.error || budgetDraftStorage && !budgetDraftStorage.persist(drafts.current)) { setBudgetOpen(true); return false }
    return true
  }
  useImperativeHandle(ref, () => ({ flush }))
  async function moveWeek(next: string | null) {
    try {
      const target = next ?? currentWeek
      const ranges = [shiftDay(target, -7), target, shiftDay(target, 7)].map(weekBounds)
      if (ranges.some((bounds) => !Number.isFinite(bounds.startedAt) || !Number.isFinite(bounds.endedAt))) throw new Error('表示できない週')
    } catch { setDateError('この日付の週は表示できない。別の日付を選んでください。'); return }
    if (await flush()) { setChosenWeek(next); setDateDraft(null); setDateError(''); setSelectedEvent(null); setError('') }
    else setDateDraft(null)
  }
  function chooseDate(value: string) {
    setDateDraft(value); setDateError('')
    if (!value) return
    try { void moveWeek(weekKey(value)) }
    catch { setDateError('この日付の週は表示できない。別の日付を選んでください。') }
  }
  async function closeBudget() { if (await flush()) setBudgetOpen(false) }
  function openEvent(event: CalendarEvent) {
    setError(''); setFixedCancel(false)
    if (event.kind === 'planned' || event.kind === 'routine') setEditor({ blockId: event.blockId, startedAt: event.startedAt, endedAt: event.endedAt })
    else setSelectedEvent(event)
  }
  function newPlan() {
    const date = new Date((start === currentWeek ? today : start) + 'T09:00:00')
    setEditor({ startedAt: date.getTime(), endedAt: date.getTime() + 3_600_000 })
  }
  const block = state.calendarBlocks?.find((item) => item.id === editor?.blockId)
  const session = state.sessions.find((item) => item.id === selectedEvent?.sessionId)
  const fixed = state.fixedWork?.find((item) => item.id === selectedEvent?.blockId)
  const dateLabel = new Date(start + 'T12:00:00').toLocaleDateString('ja-JP', { year: 'numeric', month: 'long' })
  const end = shiftDay(start, 6)
  return <div className="view week week-workspace">
    <section className="week-calendar-stage">
    <header className="week-workspace-head">
      <div className="week-heading"><div><h1>{dateLabel}</h1><span className="week-range num">{Number(start.slice(5, 7))}/{Number(start.slice(8))} — {Number(end.slice(5, 7))}/{Number(end.slice(8))}</span></div></div>
      <div className="week-controls"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void moveWeek(null)}>今週</button><div className="week-arrows"><button type="button" aria-label="前の週" onClick={() => void moveWeek(shiftDay(start, -7))}>‹</button><button type="button" aria-label="次の週" onClick={() => void moveWeek(shiftDay(start, 7))}>›</button></div><input type="date" aria-label="表示する週の日付" min="1000-01-13" max="9999-12-26" value={dateDraft ?? start} aria-invalid={Boolean(dateError) || undefined} aria-describedby={dateError ? 'week-date-error' : undefined} onChange={(event) => chooseDate(event.target.value)} />
        <Segmented<'both' | 'planned' | 'actual'> unstyled className="week-layer-switch" ariaLabel="カレンダーに表示する内容" value={layer} onChange={setLayer} options={[{ value: 'both', label: '予定・実績' }, { value: 'planned', label: '予定' }, { value: 'actual', label: '実績' }]} />
        <Segmented<'day' | 'expanded'> unstyled className="week-zoom-switch" ariaLabel="時間軸の大きさ" value={zoom ? 'expanded' : 'day'} onChange={(value) => setZoom(value === 'expanded')} options={[{ value: 'day', label: '24時間' }, { value: 'expanded', label: '拡大' }]} />
        <button type="button" className="btn btn-solid btn-md" aria-label="予定を追加" onClick={newPlan}><span aria-hidden>＋</span> 予定を追加</button><button type="button" className={'google-week-status' + (state.googleCalendar?.error || googleRangeError ? ' has-error' : '')} aria-label="Google カレンダーの接続と同期" title={state.googleCalendar?.error || googleRangeError || (state.googleCalendar?.connected ? 'Google カレンダー 接続中' : 'Google カレンダーを接続')} onClick={() => setGoogleSettingsOpen(true)}><span aria-hidden>G</span>{state.googleCalendar?.syncing && <i aria-label="同期中" />}{(state.googleCalendar?.error || googleRangeError) && <i aria-label="同期エラー" />}</button></div>
    </header>
    {dateError && <p id="week-date-error" className="task-command-error" role="alert">{dateError}</p>}
      <div className="week-calendar-area">
        <WeekCalendar start={start} today={today} now={now} events={layer === 'planned' ? [...planned, ...googleEvents] : layer === 'actual' ? actual : [...planned, ...googleEvents, ...actual]} actualByDay={new Map(days.map((day) => [day.key, day.summary.focusMs]))} zoom={zoom} onCreate={(startedAt, endedAt) => setEditor({ startedAt, endedAt })} onEvent={openEvent} />
      </div>
    </section>
    <section className="week-secondary" aria-label="この週の時間配分と記録">
      <div className="week-secondary-head"><h2>この週の時間と記録</h2><div className="week-calendar-legend"><span><i className="is-planned" />予定</span><span><i className="is-actual" />実績</span><span><i className="is-routine" />定型・生活</span></div></div>
        <div className="week-calendar-foot"><span>空いている時間をクリック・ドラッグして予定を追加</span><button type="button" onClick={() => { setSelectedEvent(null); setFixedEditor(true) }}>外部固定予定を追加</button></div>
    <div className="week-overview"><div><span>週の実作業</span><strong className="num">{formatDuration(summary.focusMs, 'compact')}</strong></div><div><span>作業の予定</span><strong className="num">{formatDuration(workPlanned, 'compact')}</strong></div><div><span>記録のある日</span><strong className="num">{days.filter((day) => day.summary.focusMs > 0).length}<small> / 7</small></strong></div><p>予定を立てて、実際の時間と見比べる。</p></div>
      <WeekBudgetPanel state={state} start={start} now={now} onEdit={() => setBudgetOpen(true)} />
    {start === currentWeek && <TaskWarnings state={state} now={now} onOpenTask={onOpenTask} compact />}
    <FixedWorkOverview period={period} onOpenTask={onOpenTask} allowCreate={false} />
    <details className="week-record-details"><summary>週の記録を詳しく見る <span>{summary.sessions.length} セッション · {summary.completedTasks.length} タスク完了</span></summary>
      <p className="calendar-hint">タスク完了は目標の成果達成とは別。実作業の時間と成果は、それぞれの記録で確認する。</p>
      <ActivityBreakdown state={state} summary={summary} />
      {days.map(({ key, summary: day }) => <details key={key} className="week-day"><summary><span>{key.slice(5).replace('-', '/')} {new Date(key + 'T12:00:00').toLocaleDateString('ja-JP', { weekday: 'short' })}</span><span className="num">{formatDuration(day.focusMs, 'compact')}</span></summary><ActivityBreakdown state={state} summary={day} />{day.sessions.length ? [...day.sessions].reverse().map((item) => <SessionRow key={item.id} session={item} now={now} inPeriod={{ ms: day.sessionMs.get(item.id) ?? 0, label: 'この日' }} />) : <p className="activity-empty">この日の記録はまだない。</p>}</details>)}
      {summary.completedTasks.length > 0 && <section className="activity-panel"><h2>この週に完了したタスク</h2><ul>{summary.completedTasks.map((task) => <li key={task.id}>{task.title}</li>)}</ul></section>}
      <ActivityTrend state={state} now={now} lastDay={end} dayStartHour={0} anchorLabel={end + '（この週の終わり）'} />
    </details>
    <p className="week-boundary-note">週は月曜 0:00〜日曜 24:00。予定は実績に含まれない。実作業は停止・除外・重複を差し引いた記録。</p>
    </section>
    {editor && <CalendarEditor block={block} startedAt={editor.startedAt} endedAt={editor.endedAt} onClose={() => setEditor(null)} onGoogle={state.googleCalendar?.connected && !block ? () => { setGoogleEditor(editor); setEditor(null) } : undefined} />}
    {googleEditor && <GoogleEventEditor calendars={state.googleCalendar?.calendars ?? []} startedAt={googleEditor.startedAt} endedAt={googleEditor.endedAt} onClose={() => setGoogleEditor(null)} />}
    <GoogleEventDetail event={selectedEvent?.googleEvent ?? null} calendars={state.googleCalendar?.calendars ?? []} onClose={() => setSelectedEvent(null)} />
    <Modal open={googleSettingsOpen} onClose={() => void runEditorAction(() => setGoogleSettingsOpen(false))} width={680} labelledBy="google-settings-title"><div className="google-settings-dialog"><GoogleCalendarSettings period={period} />{googleRangeError && <p className="task-command-error" role="alert">{googleRangeError}</p>}<div className="modal-actions"><button type="button" className="btn btn-ghost btn-md" onClick={() => void runEditorAction(() => setGoogleSettingsOpen(false))}>閉じる</button></div></div></Modal>
    <Modal open={budgetOpen} onClose={() => void closeBudget()} width={800} labelledBy="week-budget-title"><div className="week-budget-dialog"><header className="calendar-editor-head"><div><span className="label">TIME BUDGET</span><h2 id="week-budget-title">この週の時間予算</h2></div><button type="button" className="calendar-close" aria-label="時間予算を閉じる" onClick={() => void closeBudget()}>×</button></header><WeeklyBudget ref={budget} state={state} weekStart={start} draftCache={drafts} draftStorage={budgetDraftStorage} expanded initialEditing onSaved={() => setBudgetOpen(false)} /></div></Modal>
    <Modal open={Boolean(selectedEvent) && selectedEvent?.kind !== 'google' && !fixedEditor} onClose={() => { if (!saving && document.querySelectorAll('[role="dialog"]').length <= 1) setSelectedEvent(null) }} width={680} labelledBy="week-event-title">
      <div className="week-event-detail"><span className="label">{selectedEvent?.kind === 'actual' ? '実績の記録' : '外部固定予定'}</span><h2 id="week-event-title">{selectedEvent?.title}</h2>{selectedEvent && <p className="calendar-hint">{new Date(selectedEvent.startedAt).toLocaleString('ja-JP')} — {new Date(selectedEvent.endedAt).toLocaleString('ja-JP')}</p>}
        {session && <SessionRow session={session} now={now} inPeriod={{ ms: summary.sessionMs.get(session.id) ?? 0, label: 'この週' }} />}
        {fixed && <><p>{fixed.externalReason}</p><p className="calendar-hint">外部の事情で時刻が決まっている予定。実績はセッションに記録する。</p>{error && <p role="alert" className="task-command-error">{error}</p>}{fixedCancel && <div className="calendar-confirm"><p>この外部固定予定を取り消す？ 実績の記録は残る。</p><button type="button" className="btn btn-danger btn-sm" disabled={saving} onClick={async () => { setSaving(true); try { await invoke('fixedWork:update', { id: fixed.id, patch: { cancelled: true } }); setSelectedEvent(null) } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')) } finally { setSaving(false) } }}>取り消す</button></div>}<div className="phase2-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={fixed.startedAt <= now || saving} onClick={() => setFixedEditor(true)}>外部固定予定を編集</button><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setFixedCancel(true)}>予定を取り消す</button></div></>}
        <div className="modal-actions"><button type="button" className="btn btn-ghost btn-md" disabled={saving} onClick={() => setSelectedEvent(null)}>閉じる</button></div>
      </div>
    </Modal>
    {fixedEditor && <FixedWorkEditor work={fixed} onClose={() => { setFixedEditor(false); setSelectedEvent(null) }} />}
  </div>
})
