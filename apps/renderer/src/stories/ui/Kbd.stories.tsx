import type { Meta, StoryObj } from '@storybook/react-vite'
import { Kbd } from '@/components/ui'

const meta: Meta<typeof Kbd> = {
  title: 'ui/Kbd',
  component: Kbd,
}
export default meta

type Story = StoryObj<typeof Kbd>

export const Single: Story = { args: { children: 'Esc' } }
export const Combo: Story = {
  render: () => (
    <>
      <Kbd>↑</Kbd> <Kbd>↓</Kbd> <Kbd>Enter</Kbd>
    </>
  ),
}
