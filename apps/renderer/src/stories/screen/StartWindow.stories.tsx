import type { Meta, StoryObj } from '@storybook/react-vite'
import { StartWindow } from '@/pages/StartWindow'
import { devFixture } from '@/dev/fixture'
import { AppStateSeed } from './AppStateSeed'

const state = devFixture()

const meta: Meta<typeof StartWindow> = {
  title: 'screen/StartWindow',
  component: StartWindow,
  decorators: [
    (Story) => (
      <AppStateSeed state={state}>
        <Story />
      </AppStateSeed>
    ),
  ],
}
export default meta

type Story = StoryObj<typeof StartWindow>

export const Default: Story = {}
