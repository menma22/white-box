import { RISK_LABEL, type TaskControl } from '@white-box/core/task-priority'
import { slackLabel } from '@/lib/task-risk'

export function TaskRiskSummary({ control }: { control: TaskControl }) {
  return <div className="task-risk-summary">
    <span className="task-risk-badge disp" data-risk={control.risk}>{RISK_LABEL[control.risk]}</span>
    <span className="num">Slack: {slackLabel(control.slackMs)}</span>
    {control.task.status === 'todo' && <span>Aging: {control.agingDays === null ? '不明' : `${Math.floor(control.agingDays)}日`}</span>}
    {control.projectPriority && <span>プロジェクト重要度: {control.projectPriority === 'high' ? '重要' : control.projectPriority === 'low' ? '低' : '普通'}</span>}
  </div>
}
