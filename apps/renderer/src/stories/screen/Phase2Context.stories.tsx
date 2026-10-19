import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AppState } from '@white-box/core/types'
import { WeeklyBudget } from '@/features/today/WeeklyBudget'
import { FixedWorkEditor } from '@/features/board/FixedWorkEditor'
import { TaskDetail } from '@/features/board/TaskDetail'
import { devFixture } from '@/dev/fixture'
import { useApp } from '@/stores/app'
import { seedApp } from './seed'

const now = new Date(2026, 9, 6, 12).getTime()
const base = devFixture()
const task = { ...base.tasks[0]!, nextContext: '契約テストの失敗ログを開く。入力の境界を確認してから実装へ戻る。', problems: '相手との会議は確定している。事前に確認が必要な点を残しておく。', decisions: '週の配分は、生活時間と外部固定予定を確保した残りにだけ決める。' }
const plan = { sleepMinutes: 56 * 60, mealMinutes: 14 * 60, fixedMinutes: 7 * 60, allocations: [{ projectId: task.projectId!, mode: 'range' as const, minimumMinutes: 15 * 60, maximumMinutes: 25 * 60 }] }
const state: AppState = {
  ...base, tasks: [task, ...base.tasks.slice(1)], projects: base.projects.map((project) => ({ ...project, priority: 'high' })), live: null, breakTimer: null,
  weeklyBudgets: [{ ...plan, weekStart: '2026-10-05', createdAt: now, updatedAt: now }], weeklyBudgetDefaults: plan,
  fixedWork: [{ id: 'fixed-meeting', taskId: task.id, startedAt: new Date(2026, 9, 7, 14).getTime(), endedAt: new Date(2026, 9, 7, 15).getTime(), externalReason: '相手との定例会議', cancelled: false, createdAt: now, updatedAt: now }],
}
function seed() {
  const previous = useApp.getState().now
  const cleanup = seedApp(state)()
  useApp.setState({ now })
  return () => { cleanup(); useApp.setState({ now: previous }) }
}

const meta: Meta<typeof WeeklyBudget> = { title: 'screen/Phase2Context', component: WeeklyBudget, parameters: { layout: 'fullscreen' }, args: { state, weekStart: '2026-10-05' }, beforeEach: seed }
export default meta
type Story = StoryObj<typeof WeeklyBudget>
export const Budget: Story = { render: (args) => <main className="view"><WeeklyBudget {...args} /></main> }
export const BudgetUnset: Story = { args: { state: { ...state, weeklyBudgets: [] } }, render: (args) => <main className="view"><WeeklyBudget {...args} /></main> }
export const FixedWork: Story = { render: () => <FixedWorkEditor work={state.fixedWork![0]} onClose={() => {}} /> }
export const Context: Story = { render: () => <div style={{ position: 'relative', height: 900 }}><TaskDetail taskId={task.id} onClose={() => {}} /></div> }
