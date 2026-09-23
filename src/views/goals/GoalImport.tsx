import { useState } from 'react'
import { call } from '../../bridge'
import { Modal } from '../../ui/primitives'
import './goal-tasks.css'

export function GoalImport() {
  const [open, setOpen] = useState(false)
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')

  async function importData() {
    setError('')
    setBusy(true)
    try {
      const counts = await call<{ nodes: number; tasks: number; issues: number; history: number }>('goal:import', { data: JSON.parse(json) })
      setResult(`取り込み完了: 目標 ${counts.nodes}、タスク ${counts.tasks}、問題・問い・改善 ${counts.issues}、履歴 ${counts.history} 件。`)
      setJson('')
      try {
        await call('goal:ui', { patch: { view: 'map' } })
      } catch (cause) {
        setError(`データは取り込んだが、画面の切替を保存できなかった。${String(cause)}`)
      }
    } catch (e) {
      setError(`取り込めなかった。${String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>道標のデータを取り込む</button>
      <Modal open={open} onClose={() => { if (!busy) setOpen(false) }} width={600} labelledBy="gm-import-title">
        <h3 id="gm-import-title">道標のデータを取り込む</h3>
        <p className="modal-text">元の道標のデータを追加する。ホワイトボックスの既存データと、元の道標のデータはそのまま残る。</p>
        <details className="gm-import-help">
          <summary>元の道標からデータを取り出す方法</summary>
          <p>データが入っている道標をブラウザで開き、F12 → Console で次を実行する。コピーされたJSONを下に貼り付ける。</p>
          <code>copy(localStorage.getItem('michishirube.v1'))</code>
          <p>ブラウザごと・開いているURLごとに保存場所が異なる。いつも使っている道標で取り出す。</p>
        </details>
        <label className="field gm-import-file">
          <span className="label">JSONファイルから選ぶ</span>
          <input type="file" accept=".json,application/json" disabled={busy} onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setError('')
            setResult('')
            void file.text().then(setJson).catch((err: unknown) => setError(String(err)))
          }} />
        </label>
        <label className="field">
          <span className="label">またはJSONを貼り付ける</span>
          <textarea className="input gm-import-json" rows={7} value={json} disabled={busy}
            onChange={(e) => { setJson(e.target.value); setResult(''); setError('') }} />
        </label>
        {error && <p role="alert" className="gm-task-error">{error}</p>}
        {result && <p role="status">{result}</p>}
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={() => setOpen(false)}>閉じる</button>
          <button type="button" className="btn btn-primary btn-md" disabled={busy || !json.trim()} onClick={() => void importData()}>
            {busy ? '取り込み中…' : '追加して取り込む'}
          </button>
        </div>
      </Modal>
    </>
  )
}
