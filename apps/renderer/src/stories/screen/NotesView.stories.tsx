import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Note } from '@white-box/core/notes'
import { devFixture } from '@/dev/fixture'
import { NotesView } from '@/features/notes/NotesView'

const now = new Date('2026-10-04T10:00:00+09:00').getTime()
const data = devFixture()
const note: Note = {
  id: 'story-note', title: '次に戻る場所', body: '調査で気づいたことを残す。\n次のセッションでは、入力の保存から確認する。',
  projectId: null, taskId: null, pinned: true, archived: false, remindAt: now + 3600000, remindedAt: null, createdAt: now - 3600000, updatedAt: now,
}
const meta: Meta<typeof NotesView> = {
  title: 'screen/Notes', component: NotesView,
  decorators: [(Story) => <div style={{ height: 620, background: 'var(--panel)' }}><Story /></div>],
  args: { data: { ...data, notes: [] }, now },
}
export default meta
type Story = StoryObj<typeof NotesView>

export const Empty: Story = {}
export const Editing: Story = { args: { data: { ...data, notes: [note] }, initialNoteId: note.id } }
export const Archived: Story = { args: { data: { ...data, notes: [{ ...note, archived: true }] }, initialNoteId: note.id } }
