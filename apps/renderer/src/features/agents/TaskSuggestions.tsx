import { useState } from 'react'
import type { TaskSuggestion } from '@white-box/core/agent'
import type { Session } from '@white-box/core/types'
import { invoke } from '@/lib/bridge'

export function TaskSuggestions({ suggestions, sessions }: { suggestions: TaskSuggestion[]; sessions: Pick<Session, 'id' | 'startedAt' | 'endedAt' | 'note'>[] }) {
  const pending = suggestions.filter((item) => item.status === 'pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const resolve = async (id: string, accept: boolean) => {
    setBusy(id)
    setError(null)
    try { await invoke('agent:resolve', { id, accept }) } catch (failure) { setError(String(failure).replace(/^Error:\s*/, '')) } finally { setBusy(null) }
  }
  if (pending.length === 0) return null
  return <section className="task-suggestions" aria-label="記録の提案">
    <span className="label">記録の確認</span>
    <p className="task-suggestions-hint">エージェントからの提案。確認するまで記録は変わらない。</p>
    {pending.map((item) => {
      const session = sessions.find((entry) => entry.id === item.sessionId)
      return <article className="task-suggestion" key={item.id}>
        <div><p className="task-suggestion-session">{session ? `対象の記録: ${new Date(session.startedAt).toLocaleString('ja-JP')}–${session.endedAt === null ? '未終了' : new Date(session.endedAt).toLocaleTimeString('ja-JP')}` : '対象の記録が見つからない'}</p>
          {session?.note && <p>本人のメモ: {session.note}</p>}
          <strong>{item.title}</strong><p>{item.reason}</p><small>{item.markDone ? 'このタスクを完了として記録する提案' : 'このセッションのタスクを割り当てる提案'}</small></div>
        <div className="task-suggestion-actions">
          <button type="button" className="btn btn-primary btn-sm" disabled={busy !== null || !session} onClick={() => void resolve(item.id, true)}>確認して記録</button>
          <button type="button" className="btn btn-quiet btn-sm" disabled={busy !== null} onClick={() => void resolve(item.id, false)}>違う</button>
        </div>
      </article>
    })}
    {error && <p role="alert" className="set-error">{error}</p>}
  </section>
}
