import type { Meta, StoryObj } from '@storybook/react-vite'
import { Field } from '@/components/ui'

const meta: Meta<typeof Field> = {
  title: 'ui/Field',
  component: Field,
  args: {
    label: '表示名',
    children: <input className="input" defaultValue="まひろ" readOnly />,
  },
}
export default meta

type Story = StoryObj<typeof Field>

export const Basic: Story = {}
export const WithHint: Story = { args: { hint: 'HUD ウィンドウに表示される' } }
