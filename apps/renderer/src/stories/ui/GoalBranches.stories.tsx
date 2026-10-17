import type { Meta, StoryObj } from '@storybook/react-vite'
import { emptyGoalMap } from '@white-box/core/goal-map'
import { GoalCanvas } from '@/features/goals/GoalCanvas'

const map = emptyGoalMap()
map.heads = ['head']; map.activeHeadId = 'head'
map.nodes = {
  head: { id: 'head', goal: '自分の成果を届ける', reason: '', parentId: null, children: ['branch', 'target'], hidden: false, hiddenAt: null, hideReason: '' },
  branch: { id: 'branch', goal: '検証する道筋', reason: '子目標も一緒に移動する', parentId: 'head', children: [], hidden: false, hiddenAt: null, hideReason: '' },
  target: { id: 'target', goal: '新しい付け先', reason: '', parentId: 'head', children: [], hidden: false, hiddenAt: null, hideReason: '' },
}
const meta: Meta<typeof GoalCanvas> = {
  title: 'goals/Branch editing', component: GoalCanvas,
  decorators: [(Story) => <div style={{ height: 500, display: 'flex' }}><Story /></div>],
  args: { map, selected: null, focusRequest: 0, cut: null, attaching: false, canAttach: () => false, onSelect: () => {}, onAdd: () => {}, onCut: () => {}, onInsert: () => {} },
}
export default meta
type Story = StoryObj<typeof GoalCanvas>
export const Connected: Story = {}
export const ChoosingParent: Story = { args: { cut: 'branch', canAttach: (id) => id === 'target' } }
export const Saving: Story = { args: { cut: 'branch', attaching: true, canAttach: (id) => id === 'target' } }
