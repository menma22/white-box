import { useRef, useState } from 'react'
import type { Priority, Project } from '@white-box/core/types'
import { invoke } from '@/lib/bridge'
import { Modal, Segmented } from '@/components/ui'
import { useDraftParticipant } from '@/lib/useEditorFlush'

export function ProjectEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const [name, setName] = useState(project.name)
  const [priority, setPriority] = useState<Priority | ''>(project.priority ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const running = useRef<Promise<boolean> | null>(null)

  function save(): Promise<boolean> {
    if (running.current) return running.current
    if (!name.trim()) { setError('プロジェクト名を入力してください'); return Promise.resolve(false) }
    busy.current = true
    setSaving(true)
    setError('')
    running.current = invoke('project:update', { id: project.id, patch: { name: name.trim(), ...(priority !== (project.priority ?? '') ? { priority: priority || undefined } : {}) } })
      .then(() => { onClose(); return true })
      .catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; busy.current = false; setSaving(false) })
    return running.current
  }
  useDraftParticipant(() => name === project.name && priority === (project.priority ?? '') ? Promise.resolve(true) : save())

  return <Modal open onClose={() => { if (!busy.current) onClose() }} labelledBy="project-editor-title">
    <h3 id="project-editor-title">プロジェクトを編集</h3>
    <form className="phase2-form" onSubmit={(event) => { event.preventDefault(); void save() }}>
      <label>名前<input className="input" aria-label="プロジェクト名" required value={name} disabled={saving} onChange={(event) => setName(event.target.value)} autoFocus /></label>
      <div className="detail-field"><span className="label">プロジェクトの重要度</span>
        <Segmented value={priority} onChange={(value) => { if (!saving) setPriority(value) }} options={[{ value: '', label: '未設定' }, { value: 'low', label: '低' }, { value: 'normal', label: '普通' }, { value: 'high', label: '重要' }]} />
        <p className="task-control-hint">タスクの重要度と合わせて、次に何をするかの判断材料になる。</p>
      </div>
      {error && <p className="task-command-error" role="alert">保存できなかった。{error} 入力は残っている。</p>}
      <div className="modal-actions"><button type="button" className="btn btn-ghost btn-md" disabled={saving} onClick={onClose}>閉じる</button><button type="submit" className="btn btn-primary btn-md" disabled={saving || !name.trim()}>{saving ? '保存中…' : '保存する'}</button></div>
    </form>
  </Modal>
}
