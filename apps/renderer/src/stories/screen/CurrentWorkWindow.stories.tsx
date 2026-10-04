import type { Meta, StoryObj } from '@storybook/react-vite'
import { CurrentWorkWindow } from '@/pages/CurrentWorkWindow'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const base = devFixture()
const now = Date.now()
const tick = { ...base.live!, state: 'paused' as const }
const managing = {
  ...base,
  sessions: base.sessions.map((session) => session.id === tick.sessionId ? {
    ...session,
    state: 'paused' as const,
    pauses: [...session.pauses, { startedAt: now - 2 * 60_000, endedAt: null, reason: 'task-management' as const }],
  } : session),
}
const stopped = {
  ...managing,
  sessions: managing.sessions.map((session) => session.id === tick.sessionId ? {
    ...session,
    pauses: [...session.pauses, { startedAt: now - 3 * 60_000, endedAt: null, reason: 'manual' as const }],
  } : session),
}

const meta: Meta<typeof CurrentWorkWindow> = {
  title: 'screen/CurrentWorkWindow',
  component: CurrentWorkWindow,
  parameters: { layout: 'fullscreen' },
  beforeEach: seedApp(managing, tick),
}
export default meta

type Story = StoryObj<typeof CurrentWorkWindow>
export const Managing: Story = {}
export const PreservesManualPause: Story = { beforeEach: seedApp(stopped, tick) }
