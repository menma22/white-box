import type { Meta, StoryObj } from '@storybook/react-vite'
import type { LiveTick } from '@white-box/core/types'
import { ExpireWindow } from '@/pages/ExpireWindow'
import { devFixture } from '@/dev/fixture'
import { AppStateSeed } from './AppStateSeed'

const MIN = 60_000
const base = devFixture()
// story では満了音を鳴らしたくないので固定で無効化する（本体の挙動そのものは変えていない）
const state = { ...base, settings: { ...base.settings, soundOnExpire: false } }
const activeTaskId = state.tasks[0]!.id

const justExpiredTick: LiveTick = {
  sessionId: 'ses_live',
  state: 'running',
  elapsedMs: 50 * MIN,
  remainingMs: -1 * MIN,
  plannedMs: 50 * MIN,
  activeTaskId,
}

const meta: Meta<typeof ExpireWindow> = {
  title: 'screen/ExpireWindow',
  component: ExpireWindow,
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={justExpiredTick}>
        <Story />
      </AppStateSeed>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof ExpireWindow>

export const JustExpired: Story = {}

export const FarOver: Story = {
  decorators: [
    (Story) => (
      <AppStateSeed state={state} tick={{ ...justExpiredTick, elapsedMs: 95 * MIN, remainingMs: -45 * MIN }}>
        <Story />
      </AppStateSeed>
    ),
  ],
}
