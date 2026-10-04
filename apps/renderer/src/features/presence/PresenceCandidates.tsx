import { useState } from 'react'
import { candidateExclusions } from '@white-box/core/presence'
import { useData } from '@/stores/app'
import { invoke } from '@/lib/bridge'
import { Button } from '@/components/ui'

const clock = (at: number) => new Date(at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const duration = (ms: number) => { const minutes = Math.floor(ms / 60_000), seconds = Math.floor(ms / 1_000) % 60; return minutes ? `${minutes}分 ${seconds}秒` : `${seconds}秒` }

export function PresenceCandidates({ sessionId }: { sessionId?: string } = {}) {
  const state = useData()
  const candidates = (state.presenceCandidates ?? []).filter((item) => !sessionId || item.sessionId === sessionId)
  const pending = candidates.filter((item) => item.status === 'pending')
  const reviewed = candidates.filter((item) => item.status !== 'pending')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  async function resolve(id: string, decision: 'accept' | 'dismiss') {
    if (busy) return
    setBusy(id)
    try { await invoke('presence:resolve', { id, decision }); setError('') }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(null) }
  }
  if (!candidates.length) return null
  return <section className="presence-candidates" aria-label="離席候補の確認">
    <h3>離席候補 <span>{pending.length} 件未確認</span></h3>
    <p className="presence-note">顔が見えなかった時間。離席だったかは、自分で確認する。</p>
    {pending.map((item) => {
      const session = state.sessions.find((entry) => entry.id === item.sessionId)
      const ended = Boolean(session && session.state === 'ended' && session.endedAt !== null)
      const ranges = session && ended ? candidateExclusions(session, item, Date.now()) : []
      const removeMs = ranges.reduce((total, range) => total + range.endedAt - range.startedAt, 0)
      return <article className="presence-candidate" key={item.id}>
        <strong>{new Date(item.startedAt).toLocaleDateString('ja-JP')} {clock(item.startedAt)}–{clock(item.endedAt)}</strong>
        <p>顔不在の候補 {duration(item.endedAt - item.startedAt)}</p>
        {ended ? <p>確認すると {duration(removeMs)} を除外する。停止済みの重なりは含めない。</p> : <p>{session ? 'セッション終了後に確認できる。' : '対象のセッションが見つからない。'}</p>}
        <div className="presence-candidate-actions"><Button size="sm" variant="solid" disabled={Boolean(busy) || !ended} onClick={() => void resolve(item.id, 'accept')}>{busy === item.id ? '保存中…' : '離席だった：除外する'}</Button>
          <Button size="sm" disabled={Boolean(busy)} onClick={() => void resolve(item.id, 'dismiss')}>作業していた：見送る</Button></div>
      </article>
    })}
    {error && <p className="presence-error" role="alert">{error}</p>}
    {reviewed.length > 0 && <details className="presence-reviewed"><summary>確認済み {reviewed.length} 件</summary>{reviewed.map((item) => <p key={item.id}>{clock(item.startedAt)}–{clock(item.endedAt)} · {item.status === 'accepted' ? '離席として確認' : '見送り'}</p>)}</details>}
  </section>
}