import type { Meta, StoryObj } from '@storybook/react-vite'
import type { LiveTick } from '@white-box/core/types'
import { HudWindow } from '@/pages/HudWindow'
import { devFixture } from '@/dev/fixture'
import { AppStateSeed } from './AppStateSeed'

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
}
export default meta

type Story = StoryObj<typeof HudWindow>

export const Idle: Story = {
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={null}>
        <Story />
      </AppStateSeed>
    ),
  ],
}

export const Running: Story = {
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={runningTick}>
        <Story />
      </AppStateSeed>
    ),
  ],
}

export const Paused: Story = {
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={{ ...runningTick, state: 'paused' }}>
        <Story />
      </AppStateSeed>
    ),
  ],
}

export const Over: Story = {
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={{ ...runningTick, elapsedMs: 62 * MIN, remainingMs: -12 * MIN }}>
        <Story />
      </AppStateSeed>
    ),
  ],
}
