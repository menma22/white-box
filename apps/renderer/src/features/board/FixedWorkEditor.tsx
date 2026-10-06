import { useRef, useState } from 'react'
import type { FixedWork } from '@white-box/core/types'
import { validateFixedWork } from '@white-box/core/weekly-budget'
import { Modal } from '@/components/ui'
import { useApp, useData } from '@/stores/app'
import { invoke } from '@/lib/bridge'
import { localDateTime } from '@/features/notes/NoteEditor'
import { useDraftParticipant } from '@/lib/useEditorFlush'

export function FixedWorkEditor({ work, taskId, onClose }: { work?: FixedWork; taskId?: string; onClose: () => void }) {
  const state = useData()
  const now = useApp((app) => app.now)
  const [selectedTask, setSelectedTask] = useState(work?.taskId ?? taskId ?? '')
  const [start, setStart] = useState(localDateTime(work?.startedAt ?? null))
  const [end, setEnd] = useState(localDateTime(work?.endedAt ?? null))
  const [reason, setReason] = useState(work?.externalReason ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const running = useRef<Promise<boolean> | null>(null)
  const chosen = state.tasks.find((task) => task.id === selectedTask)

  function save(): Promise<boolean> {
    if (running.current) return running.current
    const startedAt = new Date(start).getTime()
    const endedAt = new Date(end).getTime()
    try {
      validateFixedWork({ startedAt, endedAt, externalReason: reason })
      if (startedAt <= now) throw new Error('外部の固定予定は開始前に登録してください')
      if (!selectedTask) throw new Error('仕事のタスクを選んでください')
    } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')); return Promise.resolve(false) }
    busy.current = true
    setSaving(true)
    setError('')
    running.current = (work ? invoke('fixedWork:update', { id: work.id, patch: { taskId: selectedTask, startedAt, endedAt, externalReason: reason.trim() } }) : invoke('fixedWork:create', { taskId: selectedTask, startedAt, endedAt, externalReason: reason.trim() }))
      .then(() => { onClose(); return true })
      .catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; busy.current = false; setSaving(false) })
    return running.current
  }
  useDraftParticipant(() => selectedTask === (work?.taskId ?? taskId ?? '') && start === localDateTime(work?.startedAt ?? null) && end === localDateTime(work?.endedAt ?? null) && reason === (work?.externalReason ?? '') ? Promise.resolve(true) : save())

  return <Modal open onClose={() => { if (!busy.current) onClose() }} labelledBy="fixed-work-editor-title" width={500}>
    <h3 id="fixed-work-editor-title">{work ? '外部の固定予定を編集' : '外部の固定予定を登録'}</h3>
    <p className="modal-text">相手との会議や予約など、外部の理由で時刻が確定している仕事だけを登録する。</p>
    <form className="phase2-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>仕事のタスク<select className="input" required aria-label="固定予定のタスク" value={selectedTask} disabled={saving} onChange={(event) => setSelectedTask(event.target.value)}><option value="">タスクを選ぶ</option>{selectedTask && !chosen && <option value={selectedTask}>削除されたタスク</option>}{state.tasks.filter((task) => task.id === selectedTask || task.status !== 'done' && !state.projects.some((project) => project.id === task.projectId && project.archived)).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>
      <div className="phase2-two-columns"><label className="phase2-input-group">開始日時<input className="input" type="datetime-local" required aria-label="固定予定の開始日時" value={start} disabled={saving} onChange={(event) => setStart(event.target.value)} /></label><label className="phase2-input-group">終了日時<input className="input" type="datetime-local" required aria-label="固定予定の終了日時" value={end} disabled={saving} onChange={(event) => setEnd(event.target.value)} /></label></div>
      <label>外部の理由<input className="input" required aria-label="時刻が固定される外部の理由" placeholder="相手との定例会議、予約した相談など" value={reason} disabled={saving} onChange={(event) => setReason(event.target.value)} /></label>
      <p className="phase2-hint">日時はこの PC の現地時刻。計測は自分で開始する。登録だけでは実績時間を作らない。</p>
      {error && <p className="task-command-error" role="alert">保存できなかった。{error} 入力は残っている。</p>}
      <div className="modal-actions"><button type="button" className="btn btn-ghost btn-md" disabled={saving} onClick={onClose}>閉じる</button><button type="submit" className="btn btn-primary btn-md" disabled={saving}>{saving ? '保存中…' : '固定予定を保存'}</button></div>
    </form>
  </Modal>
}
