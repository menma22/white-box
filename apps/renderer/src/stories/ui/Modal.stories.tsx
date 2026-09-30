import type { Meta, StoryObj } from '@storybook/react-vite'
import { Modal } from '@/components/ui'

const meta: Meta<typeof Modal> = {
  title: 'ui/Modal',
  component: Modal,
  args: {
    open: true,
    onClose: () => {},
    children: <div style={{ padding: 20 }}>モーダルの中身</div>,
  },
}
export default meta

type Story = StoryObj<typeof Modal>

export const Open: Story = {}
