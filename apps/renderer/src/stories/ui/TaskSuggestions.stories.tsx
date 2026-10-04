import type { Meta, StoryObj } from '@storybook/react-vite'
import { TaskSuggestions } from '@/features/agents/TaskSuggestions'

const suggestion = {
  id: 'suggestion', sessionId: 'session', taskId: null,
  title: '調査の結果を整理する', reason: 'セッションのメモに「資料を読み、結果をまとめた」とある。',
  markDone: true, status: 'pending' as const, createdAt: 0, resolvedAt: null,
}
const meta = {
  title: 'agents/Task suggestions',
  component: TaskSuggestions,
  decorators: [(Story) => <div style={{ width: 1000 }}><Story /></div>],
} satisfies Meta<typeof TaskSuggestions>
export default meta
type Story = StoryObj<typeof meta>

export const Pending: Story = { args: { suggestions: [suggestion] } }
export const AssignmentOnly: Story = { args: { suggestions: [{ ...suggestion, taskId: 'task', markDone: false }] } }
export const Resolved: Story = { args: { suggestions: [{ ...suggestion, status: 'accepted', resolvedAt: 1 }] } }
