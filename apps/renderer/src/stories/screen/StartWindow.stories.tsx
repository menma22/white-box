import type { Meta, StoryObj } from '@storybook/react-vite'
import { StartWindow } from '@/pages/StartWindow'
import { devFixture } from '@/dev/fixture'
import { seedApp } from './seed'

const state = devFixture()

const meta: Meta<typeof StartWindow> = {
  title: 'screen/StartWindow',
  component: StartWindow,
  // 画面 story は窓そのもの。既定の padded は body に 16px 足すので、実際の窓より内側が狭くなる
  parameters: { layout: 'fullscreen' },
  beforeEach: seedApp(state),
}
export default meta

type Story = StoryObj<typeof StartWindow>

export const Default: Story = {}
