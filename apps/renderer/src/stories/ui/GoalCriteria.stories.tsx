import type { Meta, StoryObj } from '@storybook/react-vite'
import { emptyOutcome } from '@white-box/core/outcome'
import { GoalCriteria } from '@/features/goals/GoalCriteria'

const meta: Meta<typeof GoalCriteria> = {
  title: 'goals/Success criteria',
  component: GoalCriteria,
  decorators: [(Story) => <div className="gm-detail" style={{ width: 306, maxHeight: '90vh' }}><Story /></div>],
  args: {
    node: { id: 'goal-criteria', goal: '検証できる成果を得る', reason: '', parentId: null, children: [], hidden: false, hiddenAt: null, hideReason: '', outcome: emptyOutcome() },
    run: async () => false,
  },
}
export default meta
type Story = StoryObj<typeof GoalCriteria>

export const Missing: Story = {}
export const Measured: Story = { args: { node: { ...meta.args!.node!, criteria: [
  { id: 'visitors', kind: 'number', title: '新しい利用者に試してもらう', current: 8, target: 10, unit: '人', comparison: 'at-least', evidence: 'ユーザーインタビューの記録' },
  { id: 'report', kind: 'observation', title: '協力者がレポートを読んで次の方針に合意する', confirmed: true, evidence: '2026-10-04 のレビュー議事録' },
] } } }
export const Unmeasured: Story = { args: { node: { ...meta.args!.node!, criteria: [
  { id: 'quality', kind: 'number', title: '再現できるエラーを減らす', current: null, target: 0, unit: '件', comparison: 'at-most', evidence: '' },
] } } }