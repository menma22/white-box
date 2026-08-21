import type { Meta, StoryObj } from '@storybook/react-vite'
import { Ring } from '@/components/ui'

const MIN = 60_000

const meta: Meta<typeof Ring> = {
  title: 'ui/Ring',
  component: Ring,
  args: { plannedMs: 50 * MIN },
}
export default meta

type Story = StoryObj<typeof Ring>

export const Normal: Story = {
  args: { elapsedMs: 28 * MIN, children: <span>28分</span> },
}
export const Paused: Story = {
  args: { elapsedMs: 18 * MIN, paused: true, children: <span>一時停止</span> },
}
export const Over: Story = {
  args: { elapsedMs: 62 * MIN, children: <span>超過</span> },
}
