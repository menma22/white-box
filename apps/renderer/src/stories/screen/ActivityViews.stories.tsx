import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AppState, Session, Task } from '@white-box/core/types'
import { TodayView } from '@/features/today/TodayView'
import { WeekView } from '@/features/today/WeekView'
import { devFixture } from '@/dev/fixture'
import { useApp } from '@/stores/app'
import { seedApp } from './seed'

const MINUTE = 60_000
const now = new Date(2026, 9, 5, 16).getTime()
const morning = new Date(2026, 9, 5, 9).getTime()
const base = devFixture()
const alpha: Task = {
  id: 'activity-alpha', projectId: 'activity-project', parentId: null, title: '日・週の実績を確認する',
  notes: '', status: 'todo', progress: 70, priority: 'normal', order: 0,
  createdAt: morning, updatedAt: now, doneAt: null, createdInSessionId: null,
}
const completed: Task = { ...alpha, id: 'activity-completed', title: '手計算と照合する', status: 'done', progress: 100, doneAt: morning + 120 * MINUTE, order: 1 }
const session = (id: string, taskId: string, startedAt: number, endedAt: number): Session => ({
  id, startedAt, endedAt, plannedMs: endedAt - startedAt, state: 'ended', mode: 'stopwatch',
  segments: [{ id: `${id}-segment`, taskId, startedAt, endedAt }], pauses: [], events: [], progressChanges: [],
  note: '', expiredNotifiedAt: null, editedAt: null, createdAt: startedAt,
})
const recorded: AppState = {
  ...base, tasks: [alpha, completed], live: null, breakTimer: null, recovery: null, pendingReview: null,
  taskSuggestions: [], notes: [], dayNotes: {},
  projects: [{ id: 'activity-project', name: 'White Box の実績', hue: 150, archived: false, order: 0, createdAt: morning, updatedAt: now }],
  settings: { ...base.settings, dayStartHour: 4 },
  sessions: [
    session('activity-boundary', alpha.id, new Date(2026, 9, 5, 3, 30).getTime(), new Date(2026, 9, 5, 4, 30).getTime()),
    { ...session('activity-primary', alpha.id, morning, morning + 90 * MINUTE), pauses: [
      { startedAt: morning + 20 * MINUTE, endedAt: morning + 30 * MINUTE, reason: 'manual' },
      { startedAt: morning + 60 * MINUTE, endedAt: morning + 70 * MINUTE, reason: 'excluded' },
    ] },
    session('activity-overlap', completed.id, morning + 60 * MINUTE, morning + 120 * MINUTE),
    session('activity-deleted', 'removed-task', morning + 120 * MINUTE, morning + 140 * MINUTE),
    session('activity-last-week', alpha.id, new Date(2026, 9, 2, 11).getTime(), new Date(2026, 9, 2, 12).getTime()),
  ],
}
const expiredSession: Session = {
  ...session('activity-expired', alpha.id, now - 60 * MINUTE, now), endedAt: null, state: 'paused', mode: 'timer', plannedMs: 30 * MINUTE,
  segments: [{ id: 'activity-expired-segment', taskId: alpha.id, startedAt: now - 60 * MINUTE, endedAt: null }],
  pauses: [{ startedAt: now - 30 * MINUTE, endedAt: null, reason: 'expired' }], expiredNotifiedAt: now - 30 * MINUTE,
}
const expired: AppState = {
  ...recorded, sessions: [...recorded.sessions, expiredSession],
  live: { sessionId: expiredSession.id, state: 'paused', elapsedMs: 30 * MINUTE, remainingMs: 0, plannedMs: 30 * MINUTE, mode: 'timer', activeTaskId: alpha.id },
}
function seed(state: AppState) {
  return () => {
    const previousNow = useApp.getState().now
    const cleanup = seedApp(state, state.live)()
    useApp.setState({ now })
    return () => { cleanup(); useApp.setState({ now: previousNow }) }
  }
}
function ActivityView({ view }: { view: 'today' | 'week' }) {
  return <main className="main-content">{view === 'today' ? <TodayView /> : <WeekView />}</main>
}
const meta: Meta<typeof ActivityView> = {
  title: 'screen/ActivityViews', component: ActivityView, parameters: { layout: 'fullscreen' },
  args: { view: 'today' }, beforeEach: seed(recorded),
}
export default meta
type Story = StoryObj<typeof ActivityView>
export const Today: Story = {}
export const Week: Story = { args: { view: 'week' } }
export const Empty: Story = { beforeEach: seed({ ...recorded, sessions: [] }) }
export const ExpiredLiveTimer: Story = { beforeEach: seed(expired) }
