import type { Meta, StoryObj } from '@storybook/react-vite'
import { ProgressBar } from '@/components/ui'

const meta: Meta<typeof ProgressBar> = {
  title: 'ui/ProgressBar',
  component: ProgressBar,
  args: { value: 65 },
}
export default meta

type Story = StoryObj<typeof ProgressBar>

export const Work: Story = { args: { tone: 'work' } }
export const Done: Story = { args: { tone: 'done', value: 100 } }
export const Dim: Story = { args: { tone: 'dim' } }
