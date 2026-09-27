import { useData } from '../../store'
import { Button, Empty } from '../../ui/primitives'
import type { GoalHistory as HistoryEntry } from '@shared/types'

const LABELS: Record<HistoryEntry['type'], string> = {
  'create-head': '最上位の目標を作った', 'create-child': '子目標を追加した',
  hide: '枝を隠した', unhide: '表示に戻した', merge: '目標を統合した', promote: '上位目標を作った',
}

export function GoalHistory({ onJump }: { onJump: (id: string) => void }) {
  const map = useData().goalMap
  return <section className="gm-list-page" aria-label="構造の履歴">
    <div className="gm-section-heading"><h2>構造の履歴</h2><span className="gm-muted">{map.history.length} 件</span></div>
    <p className="gm-muted">目標の追加・統合・非表示・復元を残す。目標文と理由の編集は記録しない。</p>
    {!map.history.length && <Empty title="ここから、道筋が残っていく。" />}
    {[...map.history].sort((a, b) => b.at - a.at).map((entry) => <article className="gm-history-row" key={entry.id}>
      <div className="gm-history-content"><time className="gm-muted">{new Date(entry.at).toLocaleString('ja-JP')}</time>
        <strong>{LABELS[entry.type]}</strong><p>{map.nodes[entry.nodeId]?.goal || '未入力の目標'}</p>
        {entry.parentId && <small className="gm-muted">分岐元：{map.nodes[entry.parentId]?.goal || '未入力の目標'}</small>}
        {entry.withIds?.length > 0 && <small className="gm-muted">まとめた目標：{entry.withIds.map((id) => map.nodes[id]?.goal || '未入力の目標').join(' / ')}</small>}
        {entry.note && <blockquote>{entry.note}</blockquote>}
      </div>
      <Button size="sm" onClick={() => onJump(entry.nodeId)}>見る</Button>
    </article>)}
  </section>
}
