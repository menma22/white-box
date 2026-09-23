import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from '@/components/ui'

const meta: Meta<typeof Button> = {
  title: 'ui/Button',
  component: Button,
  args: { children: 'ボタン' },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = { args: { variant: 'primary' } }
export const Solid: Story = { args: { variant: 'solid' } }
export const Ghost: Story = { args: { variant: 'ghost' } }
export const Quiet: Story = { args: { variant: 'quiet' } }
export const Danger: Story = { args: { variant: 'danger' } }
export const Disabled: Story = { args: { variant: 'primary', disabled: true } }
