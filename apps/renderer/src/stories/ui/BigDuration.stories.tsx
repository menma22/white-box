import type { Meta, StoryObj } from '@storybook/react-vite'
import { BigDuration } from '@/components/ui'

const MIN = 60_000

const meta: Meta<typeof BigDuration> = {
  title: 'ui/BigDuration',
  component: BigDuration,
}
export default meta

type Story = StoryObj<typeof BigDuration>

export const MinutesOnly: Story = { args: { ms: 34 * MIN } }
export const WithHours: Story = { args: { ms: 3 * 60 * MIN + 25 * MIN } }
