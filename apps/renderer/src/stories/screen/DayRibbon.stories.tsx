import type { Meta, StoryObj } from '@storybook/react-vite'
import { DayRibbon } from '@/features/today/DayRibbon'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const state = devFixture()
const now = Math.max(...state.sessions.map((s) => s.endedAt ?? s.startedAt))
const meta: Meta<typeof DayRibbon> = {
  title: 'screen/DayRibbon', component: DayRibbon,
  beforeEach: seedApp(state), args: { sessions: state.sessions, now },
  decorators: [(Story) => <div style={{ maxWidth: 1000, margin: '24px auto' }}><Story /></div>],
}
export default meta
type Story = StoryObj<typeof DayRibbon>
export const RecordedDay: Story = {}
export const Empty: Story = { args: { sessions: [] } }
export const JustStarted: Story = {
  args: { now, sessions: [{ ...state.sessions[0]!, state: 'running', startedAt: now, endedAt: null, segments: [{ id: 'start', taskId: state.tasks[0]!.id, startedAt: now, endedAt: null }], pauses: [] }] },
}
