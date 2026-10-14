import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AppState, CalendarBlock, Session } from '@white-box/core/types'
import { WeekView } from '@/features/today/WeekView'
import { devFixture } from '@/dev/fixture'
import { useApp } from '@/stores/app'
import { seedApp } from './seed'

const now = new Date(2026, 9, 14, 12, 30).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()
const base = devFixture()
const projects = [
  { id: 'weekly-whitebox', name: 'White Box', hue: 150, archived: false, order: 0, createdAt: at(12, 0), updatedAt: now },
  { id: 'weekly-research', name: '研究・学習', hue: 210, archived: false, order: 1, createdAt: at(12, 0), updatedAt: now },
]
const tasks = [{ ...base.tasks[0]!, id: 'weekly-task', title: '週間カレンダーを仕上げる', projectId: projects[0]!.id, status: 'todo' as const, doneAt: null },
  { ...base.tasks[0]!, id: 'weekly-read', title: '論文を読む', projectId: projects[1]!.id, status: 'todo' as const, doneAt: null }]
function block(id: string, title: string, day: number, hour: number, duration: number, category: CalendarBlock['category'] = 'work', repeat: CalendarBlock['repeat'] = 'none'): CalendarBlock {
  return { id, title, category, projectId: category === 'work' ? projects[0]!.id : null, taskId: null, startedAt: at(day, hour), endedAt: at(day, hour) + duration * 3_600_000,
    repeat, weekdays: repeat === 'weekly' ? [0, 1, 2, 3, 4, 5, 6] : [], until: null, cancelled: false, createdAt: at(12, 0), updatedAt: now }
}
function record(id: string, taskId: string, day: number, hour: number, minutes: number): Session {
  const startedAt = at(day, hour), endedAt = startedAt + minutes * 60_000
  return { id, startedAt, endedAt, plannedMs: minutes * 60_000, state: 'ended', mode: 'stopwatch', segments: [{ id: id + '-part', taskId, startedAt, endedAt }],
    pauses: [], events: [], progressChanges: [], note: '', expiredNotifiedAt: null, editedAt: null, createdAt: startedAt }
}
const state: AppState = { ...base, projects, tasks, settings: { ...base.settings, dayStartHour: 4 }, live: null, recovery: null, pendingReview: null, breakTimer: null,
  calendarBlocks: [block('sleep', '睡眠', 12, 0, 7, 'sleep', 'weekly'), block('lunch', '昼食', 12, 12, 1, 'meal', 'weekly'),
    block('monday', '週間カレンダーを仕上げる', 12, 9, 3), block('tuesday', '実画面で使いやすさを確認', 13, 9, 2), block('thursday', '予定と実績の比較を整える', 15, 14, 3),
    { ...block('read', '論文を読む', 14, 9, 2), projectId: projects[1]!.id }, block('night', '夜をまたぐ予定', 16, 23, 2)],
  sessions: [record('mon', tasks[0]!.id, 12, 9, 140), record('tue', tasks[0]!.id, 13, 9, 80), record('tue-read', tasks[1]!.id, 13, 14, 50), record('wed', tasks[1]!.id, 14, 9, 105)],
  weeklyBudgets: [{ weekStart: '2026-10-12', sleepMinutes: 49 * 60, mealMinutes: 14 * 60, fixedMinutes: 7 * 60, createdAt: at(12, 0), updatedAt: now,
    allocations: [{ projectId: projects[0]!.id, mode: 'range', minimumMinutes: 20 * 60, maximumMinutes: 30 * 60 }, { projectId: projects[1]!.id, mode: 'minimum', minutes: 10 * 60 }] }],
  fixedWork: [], taskSuggestions: [], presenceCandidates: [], notes: [] }
function seed(value: AppState) { return () => {
  const before = useApp.getState().now
  const cleanup = seedApp(value)()
  useApp.setState({ now })
  return () => { cleanup(); useApp.setState({ now: before }) }
} }
function Screen() { return <main className="main-content" style={{ height: '100vh' }}><WeekView /></main> }
const meta: Meta<typeof Screen> = { title: 'screen/WeeklyCalendar', component: Screen, parameters: { layout: 'fullscreen' }, beforeEach: seed(state) }
export default meta
type Story = StoryObj<typeof Screen>
export const PlannedAndRecorded: Story = {}
export const EmptyWeek: Story = { beforeEach: seed({ ...state, calendarBlocks: [], sessions: [], weeklyBudgets: [] }) }
export const CrowdedWeek: Story = { beforeEach: seed({ ...state, calendarBlocks: [...state.calendarBlocks!, block('overlap', '重なる予定でも開ける', 12, 10, 2), block('long', '次の一手と判断の根拠がわかるように長いタイトルを扱う', 13, 15, 2)] }) }
