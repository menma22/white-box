import type { Meta, StoryObj } from '@storybook/react-vite'
import { Chip } from '@/components/ui'

const meta: Meta<typeof Chip> = {
  title: 'ui/Chip',
  component: Chip,
  args: { children: 'プロダクト' },
}
export default meta

type Story = StoryObj<typeof Chip>

export const WithColor: Story = { args: { color: '#00704a' } }
export const NoColor: Story = { args: {} }
