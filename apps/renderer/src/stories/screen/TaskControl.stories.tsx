import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoardView } from '@/features/board/BoardView'
import { TaskDetail } from '@/features/board/TaskDetail'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const base = devFixture()
const task = { ...base.tasks[0]!, status: 'todo' as const, progress: 70, blocked: true, blockReason: '仕様の確認待ち', hardDependencies: [base.tasks[1]!.id], recommendedPredecessors: [base.tasks[2]!.id], externalBlock: { who: '担当者', what: '仕様への回答', since: '2026-09-25', lastContactOn: '2026-09-28', nextFollowUpOn: '2026-10-01' } }
const state = { ...base, tasks: [task, ...base.tasks.slice(1)], live: null }
const meta: Meta<typeof BoardView> = { title: 'screen/TaskControl', component: BoardView, parameters: { layout: 'fullscreen' }, beforeEach: seedApp(state) }
export default meta
type Story = StoryObj<typeof BoardView>
export const ExternalWaiting: Story = {}
export const Detail: Story = { render: () => <div style={{ position: 'relative', height: 860 }}><TaskDetail taskId={task.id} onClose={() => {}} /></div> }
