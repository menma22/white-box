import type { Meta, StoryObj } from '@storybook/react-vite'
import type { LiveTick } from '@white-box/core/types'
import { HudWindow } from '@/pages/HudWindow'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const MIN = 60_000
const state = devFixture()
const activeTaskId = state.tasks[0]!.id

const runningTick: LiveTick = {
  sessionId: 'ses_live',
  state: 'running',
  elapsedMs: 28 * MIN,
  remainingMs: 22 * MIN,
  plannedMs: 50 * MIN,
  activeTaskId,
}

const meta: Meta<typeof HudWindow> = {
  title: 'screen/HudWindow',
  component: HudWindow,
  // 画面 story は窓そのもの。既定の padded は body に 16px 足すので、実際の窓より内側が狭くなる
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof HudWindow>

export const Idle: Story = {
  beforeEach: seedApp(state, null),
}

export const Running: Story = {
  beforeEach: seedApp(state, runningTick),
}

export const Paused: Story = {
  beforeEach: seedApp(state, { ...runningTick, state: 'paused' }),
}

export const Over: Story = {
  beforeEach: seedApp(state, { ...runningTick, elapsedMs: 62 * MIN, remainingMs: -12 * MIN }),
}
