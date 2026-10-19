import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Note } from '@white-box/core/notes'
import { ReminderPanel } from '@/features/notes/ReminderPanel'

const now = new Date('2026-10-04T10:00:00+09:00').getTime()
const base: Note = { id: 'pin', title: '今週は入力の保存を確認する', body: '調べた内容はノートに残して、続きから再開する。', projectId: null, taskId: null, pinned: true, archived: false, remindAt: null, remindedAt: null, createdAt: now, updatedAt: now }
const meta: Meta<typeof ReminderPanel> = {
  title: 'ui/Reminders', component: ReminderPanel,
  decorators: [(Story) => <div style={{ width: 720, padding: 24 }}><Story /></div>],
  args: { now, notes: [base] },
}
export default meta
type Story = StoryObj<typeof ReminderPanel>

export const Pinned: Story = {}
export const DueAndScheduled: Story = { args: { notes: [base, { ...base, id: 'due', title: '保存した調査へ戻る', pinned: false, remindAt: now - 60000, remindedAt: now }, { ...base, id: 'future', title: '明日の準備', body: '', pinned: false, remindAt: now + 86400000 }] } }
