import type { Meta, StoryObj } from '@storybook/react-vite'
import { TitleBar } from '@/components/ui'

const meta: Meta<typeof TitleBar> = {
  title: 'ui/TitleBar',
  component: TitleBar,
  args: { title: 'White Box' },
}
export default meta

type Story = StoryObj<typeof TitleBar>

export const Basic: Story = {}
export const WithSubtitle: Story = { args: { subtitle: '実行中' } }
export const WithClose: Story = { args: { onClose: () => {} } }
