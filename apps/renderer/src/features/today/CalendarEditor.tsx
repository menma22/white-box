import { useRef, useState } from 'react'
import type { CalendarBlock, CalendarBlockInput } from '@white-box/core/types'
import { validateCalendarBlock } from '@white-box/core/calendar'
import { Modal } from '@/components/ui'
import { useData } from '@/stores/app'
import { invoke } from '@/lib/bridge'
import { toLocalInput } from '@/lib/session-edit'
import { useDraftParticipant } from '@/lib/useEditorFlush'

const DAYS = [{ day: 1, label: '月' }, { day: 2, label: '火' }, { day: 3, label: '水' }, { day: 4, label: '木' }, { day: 5, label: '金' }, { day: 6, label: '土' }, { day: 0, label: '日' }]
export function CalendarEditor({ block, startedAt, endedAt, onClose, onGoogle }: { block?: CalendarBlock; startedAt: number; endedAt: number; onClose: () => void; onGoogle?: () => void }) {
  const state = useData()
  const initial = useRef({ title: block?.title ?? '', start: toLocalInput(block?.startedAt ?? startedAt), end: toLocalInput(block?.endedAt ?? endedAt),
    category: block?.category ?? 'work', projectId: block?.projectId ?? '', taskId: block?.taskId ?? '', repeat: block?.repeat === 'weekly',
    weekdays: block?.repeat === 'weekly' ? block.weekdays : [new Date(startedAt).getDay()], until: block?.until ?? '' })
  const [draft, setDraft] = useState(initial.current)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirm, setConfirm] = useState<'discard' | 'cancel' | null>(null)
  const running = useRef<Promise<boolean> | null>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial.current)
  const life = draft.category !== 'work'
  const recurring = block?.repeat === 'weekly'
  function update(patch: Partial<typeof draft>) { setDraft((value) => ({ ...value, ...patch })); setError(''); setConfirm(null) }
  useDraftParticipant(async () => {
    if (running.current) return running.current
    if (saving) return false
    if (!dirty) return true
    setError('変更が保存されていない。予定を保存するか、編集を閉じてから続けられる。')
    return false
  })
  function close() { if (saving) return; if (dirty) setConfirm('discard'); else onClose() }
  function save(): Promise<boolean> {
    if (running.current) return running.current
    const input: CalendarBlockInput = { title: draft.title.trim(), category: draft.category, projectId: life ? null : draft.projectId || null, taskId: life ? null : draft.taskId || null,
      startedAt: block && draft.start === initial.current.start ? block.startedAt : new Date(draft.start).getTime(), endedAt: block && draft.end === initial.current.end ? block.endedAt : new Date(draft.end).getTime(), repeat: draft.repeat ? 'weekly' : 'none', weekdays: draft.repeat ? draft.weekdays : [], until: draft.repeat ? draft.until || null : null }
    try { validateCalendarBlock(input) } catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')); return Promise.resolve(false) }
    setSaving(true); setError('')
    const patch: Partial<CalendarBlockInput> = { title: input.title, category: input.category, repeat: input.repeat, weekdays: input.weekdays, until: input.until }
    if (draft.start !== initial.current.start) patch.startedAt = input.startedAt
    if (draft.end !== initial.current.end) patch.endedAt = input.endedAt
    if (block && (input.taskId !== block.taskId || input.projectId !== block.projectId || input.category !== block.category)) { patch.taskId = input.taskId; patch.projectId = input.projectId }
    running.current = (block ? invoke('calendar:update', { id: block.id, patch }) : invoke('calendar:create', input))
      .then(() => { onClose(); return true }).catch((cause) => { setError(String(cause).replace(/^(Error:\s*)+/, '')); return false })
      .finally(() => { running.current = null; setSaving(false) })
    return running.current
  }
  async function cancel() {
    if (!block || saving) return
    setSaving(true); setError('')
    try { await invoke('calendar:update', { id: block.id, patch: { cancelled: true } }); onClose() }
    catch (cause) { setError(String(cause).replace(/^(Error:\s*)+/, '')); setConfirm(null) }
    finally { setSaving(false) }
  }
  const projects = state.projects.filter((project) => !project.archived || project.id === draft.projectId)
  const tasks = state.tasks.filter((task) => task.id === draft.taskId || (!draft.projectId || task.projectId === draft.projectId) && (!state.projects.find((project) => project.id === task.projectId)?.archived || task.id === draft.taskId))
  return <Modal open onClose={close} width={540} labelledBy="calendar-editor-title">
    <div className="calendar-editor">
      <header className="calendar-editor-head"><div><span className="label">WEEK PLANNER</span><h2 id="calendar-editor-title">{block ? '予定を編集' : '予定をつくる'}</h2></div><button type="button" className="calendar-close" aria-label="予定の編集を閉じる" disabled={saving} onClick={close}>×</button></header>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        {onGoogle && <div className="google-plan-target"><span>保存先: White Box</span><button type="button" className="btn btn-ghost btn-sm" disabled={dirty || saving} onClick={onGoogle}>Google カレンダーへ保存する</button>{dirty && <small>保存先の切り替えは入力前に選べる。</small>}</div>}
        <label className="calendar-field">タイトル<input className="input calendar-title-input" required maxLength={500} aria-label="タイトル" placeholder="何に時間を使う？" value={draft.title} disabled={saving} onChange={(event) => update({ title: event.target.value })} /></label>
        <div className="calendar-field-pair">
          <label className="calendar-field">開始<input className="input" type="datetime-local" required aria-label="開始" value={draft.start} disabled={saving} onChange={(event) => update({ start: event.target.value })} /></label>
          <label className="calendar-field">終了<input className="input" type="datetime-local" required aria-label="終了" value={draft.end} disabled={saving} onChange={(event) => update({ end: event.target.value })} /></label>
        </div>
        <label className="calendar-field">種類<select className="input" aria-label="種類" value={draft.category} disabled={saving} onChange={(event) => update({ category: event.target.value as CalendarBlockInput['category'], ...(event.target.value !== 'work' ? { taskId: '', projectId: '' } : {}) })}>
          <option value="work">作業の予定</option><option value="sleep">睡眠</option><option value="meal">食事</option><option value="fixed">その他の固定時間</option>
        </select></label>
        {!life && <div className="calendar-field-pair">
          <label className="calendar-field">プロジェクト<select className="input" aria-label="プロジェクト" value={draft.projectId} disabled={saving} onChange={(event) => update({ projectId: event.target.value, taskId: '' })}>
            <option value="">指定しない</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            {draft.projectId && !projects.some((project) => project.id === draft.projectId) && <option value={draft.projectId}>削除されたプロジェクト</option>}
          </select></label>
          <label className="calendar-field">タスク<select className="input" aria-label="タスク" value={draft.taskId} disabled={saving} onChange={(event) => { const task = state.tasks.find((item) => item.id === event.target.value); update({ taskId: event.target.value, ...(task ? { projectId: task.projectId ?? '' } : {}) }) }}>
            <option value="">指定しない</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
            {draft.taskId && !tasks.some((task) => task.id === draft.taskId) && <option value={draft.taskId}>削除されたタスク</option>}
          </select></label>
        </div>}
        <div className="calendar-repeat">
          <label className="calendar-repeat-label"><input type="checkbox" aria-label="毎週繰り返す" checked={draft.repeat} disabled={saving} onChange={(event) => update({ repeat: event.target.checked })} /> 毎週繰り返す<span>定型時間</span></label>
          {draft.repeat && <>
            <div className="calendar-weekdays" role="group" aria-label="繰り返す曜日">{DAYS.map(({ day, label }) => <button key={day} type="button" aria-pressed={draft.weekdays.includes(day)} aria-label={label + '曜日に繰り返す'} disabled={saving} onClick={() => update({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((value) => value !== day) : [...draft.weekdays, day] })}>{label}</button>)}</div>
            <div className="calendar-repeat-presets"><button type="button" disabled={saving} onClick={() => update({ weekdays: [1, 2, 3, 4, 5] })}>平日</button><button type="button" disabled={saving} onClick={() => update({ weekdays: [0, 1, 2, 3, 4, 5, 6] })}>毎日</button></div>
            <label className="calendar-field">繰り返しの終了日 <span className="calendar-optional">任意</span><input className="input" type="date" aria-label="繰り返しの終了日" min={draft.start.slice(0, 10)} value={draft.until} disabled={saving} onChange={(event) => update({ until: event.target.value })} /></label>
          </>}
          {(draft.repeat || recurring) && <p className="calendar-hint">{draft.repeat && '開始日から指定した曜日に繰り返す。'}{recurring ? '変更・取消は、この定型予定全体に適用される。' : '夜をまたぐ時間も登録できる。'}</p>}
        </div>
        {life && <p className="calendar-hint">週の時間予算でも、この時間を最低限確保する。</p>}
        {error && <p className="task-command-error" role="alert">{error} 入力は残っている。</p>}
        {confirm && <div className="calendar-confirm" role="alert">
          <p>{confirm === 'discard' ? '保存前の入力を破棄して閉じる？' : recurring ? 'この定型予定全体を取り消す？ 実績の記録はそのまま残る。' : 'この予定を取り消す？ 実績の記録はそのまま残る。'}</p>
          <div className="modal-actions"><button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={() => setConfirm(null)}>編集へ戻る</button><button type="button" className="btn btn-danger btn-sm" disabled={saving} onClick={() => confirm === 'discard' ? onClose() : void cancel()}>{confirm === 'discard' ? '入力を破棄して閉じる' : '取り消す'}</button></div>
        </div>}
        <footer className="calendar-editor-actions">
          {block && <button type="button" className="btn btn-ghost btn-sm calendar-cancel" disabled={saving} onClick={() => setConfirm('cancel')}>予定を取り消す</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={saving} onClick={close}>閉じる</button>
          <button type="submit" className="btn btn-primary btn-md" disabled={saving}>{saving ? '保存中…' : '予定を保存'}</button>
        </footer>
      </form>
    </div>
  </Modal>
}
