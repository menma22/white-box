import { useState } from 'react'
import { invoke, isBrowserPreview } from '@/lib/bridge'
import { useData } from '@/stores/app'
import { projectColor } from '@/lib/selectors'
import { shortcutLabel } from '@/lib/format'
import { Modal } from '@/components/ui'
import type { Settings } from '@white-box/core/types'

export function SettingsView() {
  const state = useData()
  const s = state.settings
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleting, setDeleting] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Record<string, unknown> はキーの綴り違いを型検査で拾えないため、送信する patch は Partial<Settings> で縛る。
  const patch = (p: Partial<Settings>) => {
    setError(null)
    void invoke('settings:update', { patch: p }).catch((err) => setError(String(err).replace(/^(Error:\s*)+/, '')))
  }

  return (
    <div className="view settings">
      <header className="view-head">
        <div>
          <span className="label">設定</span>
          <h1 className="view-title">この道具の調整</h1>
        </div>
      </header>
      {error && <p className="set-error" role="alert">{error}</p>}

      <section className="set-block">
        <h2 className="set-title">あなたのこと</h2>
        <div className="set-rows">
          <Row label="呼びかけに使う名前" hint="朝いちばんの画面で呼ばれる名前。空のままでもいい。">
            <input
              className="input set-name"
              placeholder="（未設定）"
              value={s.displayName}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </Row>
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">ショートカット</h2>
        <p className="set-note">どのアプリを使っていても効く。作業を中断せずに開始・停止できることが、記録が残るかどうかを決める。</p>
        <div className="set-rows">
          <ShortcutRow
            label="開始 / 一時停止・再開"
            hint="何も動いていなければ開始画面、実行中なら一時停止、停止中なら確認なしで再開。"
            value={s.shortcuts.startPause}
            onChange={(v) => patch({ shortcuts: { ...s.shortcuts, startPause: v } })}
          />
          <ShortcutRow
            label="現在の仕事"
            hint="今やっていることと、ほかのタスクを出す。"
            value={s.shortcuts.currentWork}
            onChange={(v) => patch({ shortcuts: { ...s.shortcuts, currentWork: v } })}
          />
          <ShortcutRow
            label="メイン画面"
            value={s.shortcuts.dashboard}
            onChange={(v) => patch({ shortcuts: { ...s.shortcuts, dashboard: v } })}
          />
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">セッション</h2>
        <div className="set-rows">
          <Row label="既定の長さ" hint="開始画面で毎回変えられる。">
            <input
              className="input num set-num"
              type="number"
              min={1}
              max={480}
              value={s.defaultSessionMinutes}
              onChange={(e) => patch({ defaultSessionMinutes: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="set-unit">分</span>
          </Row>
          <Row label="既定の計測方法" hint="開始画面で変更できる。">
            <select className="input" value={s.defaultSessionMode ?? 'timer'} onChange={(e) => patch({ defaultSessionMode: e.target.value as Settings['defaultSessionMode'] })}>
              <option value="timer">タイマー</option><option value="stopwatch">ストップウォッチ</option><option value="pomodoro">ポモドーロ</option>
            </select>
          </Row>
          <Row label="ポモドーロの休憩" hint="作業時間の満了後に自動で休憩へ切り替える。">
            <input className="input num set-num" type="number" min={1} max={180} value={s.pomodoroBreakMinutes ?? 5} onChange={(e) => patch({ pomodoroBreakMinutes: Math.max(1, Math.min(180, Number(e.target.value) || 5)) })} /><span className="set-unit">分</span>
          </Row>
          <Row label="休憩後に自動で次の作業へ" hint="OFFなら、自分で再開するまで計測は止まったまま。">
            <Toggle value={s.pomodoroAutoResume ?? false} onChange={(v) => patch({ pomodoroAutoResume: v })} />
          </Row>
          <Row label="延長の既定値" hint="満了ポップアップの「続ける」に出る値。">
            <input
              className="input num set-num"
              type="number"
              min={1}
              max={240}
              value={s.defaultExtendMinutes}
              onChange={(e) => patch({ defaultExtendMinutes: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="set-unit">分</span>
          </Row>
          <Row
            label="セッション中のカードを出す"
            hint="経過と残りだけの小さなカードを最前面に置く。押せないので作業の邪魔にはならない。消せるのはここだけ。"
          >
            <Toggle value={s.showSessionCard} onChange={(v) => patch({ showSessionCard: v })} />
          </Row>
          <Row label="満了時に音を鳴らす">
            <Toggle value={s.soundOnExpire} onChange={(v) => patch({ soundOnExpire: v })} />
          </Row>
          <Row label="スリープ・ロックで自動的に止める" hint="離席していた時間を実作業に数えないため。">
            <Toggle value={s.autoPauseOnSuspend} onChange={(v) => patch({ autoPauseOnSuspend: v })} />
          </Row>
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">一日と警告</h2>
        <div className="set-rows">
          <Row label="一日の境目" hint="深夜の作業を前の日に含めたいときに使う。">
            <input
              className="input num set-num"
              type="number"
              min={0}
              max={12}
              value={s.dayStartHour}
              onChange={(e) => patch({ dayStartHour: Math.max(0, Math.min(12, Number(e.target.value) || 0)) })}
            />
            <span className="set-unit">時</span>
          </Row>
          <Row label="Todo の警告までの日数" hint="作業・進捗の記録がない期間。この日数で Warning、2 倍で High Risk。Inbox は数えない。">
            <input
              className="input num set-num"
              type="number"
              min={1}
              max={60}
              value={s.stallWarningDays}
              onChange={(e) => patch({ stallWarningDays: Math.max(1, Number(e.target.value) || 1) })}
            />
            <span className="set-unit">日</span>
          </Row>
          <Row label="Windows の起動時に立ち上げる" hint="トレイに常駐して、いつでもショートカットで呼べる状態にする。">
            <Toggle value={s.launchAtLogin} onChange={(v) => patch({ launchAtLogin: v })} />
          </Row>
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">プロジェクト</h2>
        <div className="set-projects">
          {state.projects.length === 0 && <p className="set-note">まだプロジェクトがない。ボードの上から追加できる。</p>}
          {state.projects.map((p) => (
            <div key={p.id} className="set-project">
              <i style={{ background: projectColor(p) }} />
              {renaming === p.id ? (
                <input
                  className="input"
                  value={renameValue}
                  autoFocus
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => {
                    if (renameValue.trim()) void invoke('project:update', { id: p.id, patch: { name: renameValue.trim() } })
                    setRenaming(null)
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                />
              ) : (
                <button
                  type="button"
                  className="set-project-name"
                  onClick={() => {
                    setRenaming(p.id)
                    setRenameValue(p.name)
                  }}
                >
                  {p.name}
                </button>
              )}
              <input
                type="range"
                className="slider set-hue"
                min={0}
                max={359}
                value={p.hue}
                style={{ ['--fill' as string]: '0%' }}
                onChange={(e) => void invoke('project:update', { id: p.id, patch: { hue: Number(e.target.value) } })}
                title="色"
              />
              <span className="num set-project-count">{state.tasks.filter((t) => t.projectId === p.id).length}件</span>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setDeleting(p.id)}>
                削除
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">開始忘れ</h2>
        <div className="set-rows">
          <Row label="入力が続いたら開始を思い出す" hint="押下回数だけを端末内で数える。入力した文字は取得しない。セッションがある間は通知しない。">
            <Toggle value={s.remindToStart ?? false} onChange={(v) => patch({ remindToStart: v })} />
          </Row>
          <Row label="通知までの入力時間" hint="無視した通知は30分間繰り返さない。">
            <input className="input num set-num" type="number" min={1} max={60} value={s.startReminderMinutes ?? 3} onChange={(e) => patch({ startReminderMinutes: Math.max(1, Math.min(60, Number(e.target.value) || 3)) })} /><span className="set-unit">分</span>
          </Row>
        </div>
      </section>

      <section className="set-block">
        <h2 className="set-title">AI連携</h2>
        <div className="set-rows">
          <Row label="ローカルのAIエージェントからつなぐ" hint="接続したエージェントが目標・タスクを参照し、依頼したタスクを登録できる。記録・完了の判定は確認待ちの提案になる。">
            <Toggle value={s.enableAgentApi ?? false} onChange={(v) => patch({ enableAgentApi: v })} />
          </Row>
        </div>
        <p className="set-note">AI連携はMCP対応エージェントで使える。コピーした接続設定を、エージェントのMCP設定へ追加する。音声の書き起こしからも、同じ手順でタスクを整理できる。</p>
        <button type="button" className="btn btn-ghost btn-sm" disabled={!s.enableAgentApi || isBrowserPreview} onClick={() => {
          setError(null)
          void invoke('agent:config').then((config) => navigator.clipboard.writeText(config)).then(() => setSaved('AI連携の接続設定をコピーした')).catch((failure) => setError(String(failure)))
        }}>AI連携の接続設定をコピー</button>
      </section>

      <section className="set-block">
        <h2 className="set-title">データ</h2>
        <p className="set-note">
          記録はこの PC の中だけにある。書き出しておけば、PC を移しても続きから使える。
        </p>
        <div className="set-actions">
          <button
            type="button"
            className="btn btn-solid btn-md"
            disabled={isBrowserPreview}
            onClick={async () => {
              const p = await invoke('data:export')
              if (p) setSaved(p)
            }}
          >
            書き出す
          </button>
          <button type="button" className="btn btn-ghost btn-md" disabled={isBrowserPreview} onClick={() => void invoke('data:import').catch((failure) => setError(String(failure).replace(/^(Error:\s*)+/, '')))}>
            読み込む
          </button>
          <button type="button" className="btn btn-quiet btn-md" disabled={isBrowserPreview} onClick={() => void invoke('data:reveal')}>
            保存先を開く
          </button>
        </div>
        {saved && <p className="set-saved num">{saved}</p>}
      </section>

      <Modal open={Boolean(deleting)} onClose={() => setDeleting(null)}>
        <h3>プロジェクトを削除する？</h3>
        <p className="modal-text">中のタスクは消えない。プロジェクトの紐付けだけが外れる。</p>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setDeleting(null)}>
            やめる
          </button>
          <button
            type="button"
            className="btn btn-danger btn-md"
            onClick={() => {
              if (deleting) void invoke('project:delete', { id: deleting })
              setDeleting(null)
            }}
          >
            削除する
          </button>
        </div>
      </Modal>
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-text">
        <span className="set-row-label">{label}</span>
        {hint && <span className="set-row-hint">{hint}</span>}
      </div>
      <div className="set-row-control">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${value ? 'is-on' : ''}`} onClick={() => onChange(!value)} role="switch" aria-checked={value}>
      <span className="toggle-knob" />
    </button>
  )
}

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super']

function ShortcutRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
}) {
  const [capturing, setCapturing] = useState(false)

  function onKeyDown(e: React.KeyboardEvent) {
    e.preventDefault()
    if (e.key === 'Escape') {
      setCapturing(false)
      return
    }
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Control')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (e.metaKey) parts.push('Super')
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
    if (MODIFIERS.includes(key) || key === 'Meta') return
    if (parts.length === 0) return
    onChange([...parts, key].join('+'))
    setCapturing(false)
  }

  return (
    <Row label={label} hint={hint}>
      <button
        type="button"
        className={`shortcut ${capturing ? 'is-capturing' : ''}`}
        onClick={() => setCapturing(true)}
        onKeyDown={onKeyDown}
        onBlur={() => setCapturing(false)}
      >
        {capturing ? '押して…' : shortcutLabel(value)}
      </button>
    </Row>
  )
}
