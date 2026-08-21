import type { Meta, StoryObj } from '@storybook/react-vite'
import { Segmented } from '@/components/ui'

const meta: Meta<typeof Segmented> = {
  title: 'ui/Segmented',
  component: Segmented,
  args: {
    options: [
      { value: 'day', label: '今日' },
      { value: 'week', label: '週' },
      { value: 'month', label: '月' },
    ],
    value: 'week',
    onChange: () => {},
  },
}
export default meta

type Story = StoryObj<typeof Segmented>

export const Selected: Story = {}
