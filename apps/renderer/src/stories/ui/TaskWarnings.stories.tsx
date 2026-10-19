import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Task } from '@white-box/core/types'
import { devFixture } from '@/dev/fixture'
import { TaskWarnings } from '@/features/task-control/TaskWarnings'

const now = new Date('2026-10-05T12:00:00+09:00').getTime()
const task = (id: string, patch: Partial<Task>): Task => ({
  id, title: id, notes: '', projectId: null, parentId: null, status: 'todo', progress: 0, priority: 'normal',
  order: 0, createdAt: now, updatedAt: now, doneAt: null, createdInSessionId: null, committedAt: now, ...patch,
})
const state = { ...devFixture(), sessions: [], live: null, tasks: [
  task('締切が過ぎた仕事', { due: '2026-10-04' }),
  task('見積から余裕が足りない仕事', { due: '2026-10-05', remainingEffortMinutes: 900, safetyBufferMinutes: 60 }),
  task('次の行動を決め直す仕事', { committedAt: now - 4 * 86_400_000 }),
] }
const meta = { title: 'task control/Warnings', component: TaskWarnings,
  decorators: [(Story) => <div style={{ width: 940, padding: 20 }}><Story /></div>],
} satisfies Meta<typeof TaskWarnings>
export default meta
type Story = StoryObj<typeof meta>
export const Levels: Story = { args: { state, now } }
export const Compact: Story = { args: { state, now, compact: true } }
export const Working: Story = { args: { state: { ...state, live: devFixture().live }, now } }
export const ManyWarnings: Story = { args: { state: { ...state, tasks: [...state.tasks,
  task('確認が必要な四つ目の仕事', { due: '2026-10-04' }),
  task('確認が必要な五つ目の仕事', { due: '2026-10-04' }),
] }, now } }
export const Empty: Story = { args: { state: { ...state, tasks: [task('未入力', {})] }, now } }
export const BlockedAndArchived: Story = { args: { state: { ...state,
  projects: [{ id: 'archived', name: 'アーカイブした仕事', hue: 150, archived: true, order: 0, createdAt: now, updatedAt: now }],
  tasks: [
    task('承認を待っている仕事', { due: '2026-10-04', blocked: true, blockReason: '承認待ち', hardDependencies: ['predecessor'],
      externalBlock: { who: '確認担当', what: '承認の返答', since: '2026-10-04', lastContactOn: null, nextFollowUpOn: '2026-10-05' } }),
    task('predecessor', { title: '先行する仕事' }),
    task('警告には出ないアーカイブした仕事', { projectId: 'archived', due: '2026-10-04' }),
  ],
}, now } }
