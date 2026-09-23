import type { Meta, StoryObj } from '@storybook/react-vite'
import type { AppState, LiveTick } from '@white-box/core/types'
import { HudWindow } from '@/pages/HudWindow'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const MIN = 60_000
const state = devFixture()
const cardOff: AppState = { ...state, settings: { ...state.settings, showSessionCard: false } }
const storyNow = Date.now()
const onBreak: AppState = {
  ...state,
  breakTimer: { startedAt: storyNow - MIN, endsAt: storyNow + 4 * MIN, notifiedAt: null },
}
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
  decorators: [
    // 実物は透過窓に浮くので、裏地が無いと透けていることが見えない
    // 大きさは windows.ts の hud の窓に合わせる（片方だけ変えると story が実物とずれる）
    (Story) => (
      <div
        style={{
          width: 248,
          height: 88,
          backgroundImage: 'repeating-linear-gradient(135deg, #8a8f98 0 11px, #6b707a 11px 22px)',
        }}
      >
        <Story />
      </div>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof HudWindow>

/** セッションが無いときは何も出さない（窓は開いていても絵は無い） */
export const Idle: Story = {
  beforeEach: seedApp(state, null),
}

export const Running: Story = {
  beforeEach: seedApp(state, runningTick),
}

export const Paused: Story = {
  beforeEach: seedApp(state, { ...runningTick, state: 'paused' }),
}

export const Break: Story = {
  beforeEach: seedApp(onBreak, { ...runningTick, state: 'paused' }),
}

export const Over: Story = {
  beforeEach: seedApp(state, { ...runningTick, elapsedMs: 62 * MIN, remainingMs: -12 * MIN }),
}

/** 設定で消したとき。セッション中でもカードは出ない */
export const HiddenBySetting: Story = {
  beforeEach: seedApp(cardOff, runningTick),
}
