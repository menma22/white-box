import type { Meta, StoryObj } from '@storybook/react-vite'
import { Empty } from '@/components/ui'

const meta: Meta<typeof Empty> = {
  title: 'ui/Empty',
  component: Empty,
  args: { title: 'まだタスクがない' },
}
export default meta

type Story = StoryObj<typeof Empty>

export const Basic: Story = {}
export const WithHint: Story = { args: { hint: '上の欄に書けば、そのまま始められる' } }
