/**
 * 初回オンボーディングの見た目。4 ステップぶんの画面と、キー捕捉のボタン。
 *
 * ここは渡された props を描くだけにする（保存も遷移も持たない）。状態は OnboardingFlow が持つ。
 */
import { useState, type ReactNode } from 'react'
import { Kbd } from '@/components/ui'
import { shortcutLabel } from '@/lib/format'
import type { Settings } from '@white-box/core/types'

export type Shortcuts = Settings['shortcuts']

export const STEP_COUNT = 4

export const SHORTCUT_FIELDS: { id: keyof Shortcuts; label: string; hint: string }[] = [
  {
    id: 'startPause',
    label: '開始 / 一時停止・再開',
    hint: '何も動いていなければ開始画面、実行中なら一時停止、停止中なら確認なしで再開。',
  },
  { id: 'currentWork', label: '現在の仕事', hint: '今やっていることと、ほかのタスクを出す。' },
  { id: 'dashboard', label: 'メイン画面', hint: '今日・ボード・記録・設定。' },
]

function Frame({
  step,
  title,
  lead,
  children,
  foot,
}: {
  step: number
  title: string
  lead?: string
  children?: ReactNode
  foot: ReactNode
}) {
  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="onboard-dots" aria-label={`${step + 1} / ${STEP_COUNT}`}>
          {Array.from({ length: STEP_COUNT }, (_, i) => (
            <i key={i} className={i === step ? 'is-here' : i < step ? 'is-done' : ''} />
          ))}
        </div>
        <h1 className="onboard-title">{title}</h1>
        {lead && <p className="onboard-lead">{lead}</p>}
        {children}
        <footer className="onboard-foot">{foot}</footer>
      </div>
    </div>
  )
}

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <Frame
      step={0}
      title="White Box へようこそ。"
      lead="自分が何にどれだけ時間を使ったのかを、あとから読める形で残す道具。使いはじめる前に、ふたつだけ決めさせてほしい。"
      foot={
        <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
          はじめる
        </button>
      }
    />
  )
}

export function NameStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: string
  onChange: (v: string) => void
  onNext: () => void
  onBack: () => void
}) {
  return (
    <Frame
      step={1}
      title="なんて呼べばいい？"
      lead="朝いちばんの画面で呼びかけに使うだけ。空のままでもいい。"
      foot={
        <>
          <button type="button" className="btn btn-quiet btn-md onboard-back" onClick={onBack}>
            戻る
          </button>
          <button type="button" className="btn btn-primary btn-lg" onClick={onNext}>
            次へ
          </button>
        </>
      }
    >
      <div className="onboard-body">
        <input
          className="input onboard-name"
          placeholder="（呼ばれたい名前）"
          value={value}
          autoFocus
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onNext()}
        />
      </div>
    </Frame>
  )
}

export function ShortcutsStep({
  value,
  onChange,
  onSkip,
  onNext,
  onBack,
}: {
  value: Shortcuts
  onChange: (v: Shortcuts) => void
  onSkip: () => void
  onNext: () => void
  onBack: () => void
}) {
  const assigned = SHORTCUT_FIELDS.map((f) => value[f.id]).filter((a) => a !== '')
  const duplicated = assigned.filter((a, i) => assigned.indexOf(a) !== i)

  return (
    <Frame
      step={2}
      title="どのキーで呼び出す？"
      lead="どのアプリを使っていても効く。作業を中断せずに開始・停止できることが、記録が残るかどうかを決める。押すと、そのとき押したキーがそのまま入る。"
      foot={
        <>
          <button type="button" className="btn btn-quiet btn-md onboard-back" onClick={onBack}>
            戻る
          </button>
          <div className="onboard-foot-right">
            <button type="button" className="btn btn-ghost btn-md" onClick={onSkip}>
              あとで決める
            </button>
            <button type="button" className="btn btn-primary btn-lg" disabled={duplicated.length > 0} onClick={onNext}>
              次へ
            </button>
          </div>
        </>
      }
    >
      <div className="onboard-body onboard-keys">
        {SHORTCUT_FIELDS.map((f) => (
          <div key={f.id} className="onboard-key">
            <div className="onboard-key-text">
              <span className="onboard-key-label">{f.label}</span>
              <span className="onboard-key-hint">{f.hint}</span>
            </div>
            <ShortcutPicker
              value={value[f.id]}
              duplicated={value[f.id] !== '' && duplicated.includes(value[f.id])}
              onChange={(v) => onChange({ ...value, [f.id]: v })}
            />
          </div>
        ))}
        {duplicated.length > 0 && <p className="onboard-warn">同じキーは 1 つの操作にしか割り当てられない。</p>}
      </div>
    </Frame>
  )
}

export function DoneStep({ name, shortcuts, onFinish }: { name: string; shortcuts: Shortcuts; onFinish: () => void }) {
  const assigned = SHORTCUT_FIELDS.filter((f) => shortcuts[f.id] !== '')

  return (
    <Frame
      step={3}
      title={name.trim() ? `よろしく、${name.trim()}。` : '準備できた。'}
      lead="あとから設定画面でいつでも変えられる。"
      foot={
        <button type="button" className="btn btn-primary btn-lg" onClick={onFinish}>
          使いはじめる
        </button>
      }
    >
      <div className="onboard-body">
        {assigned.length === 0 ? (
          <p className="onboard-empty">ショートカットは割り当てていない。</p>
        ) : (
          <ul className="onboard-summary">
            {assigned.map((f) => (
              <li key={f.id}>
                <span className="onboard-summary-label">{f.label}</span>
                <Kbd>{shortcutLabel(shortcuts[f.id])}</Kbd>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Frame>
  )
}

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super']

export function ShortcutPicker({
  value,
  duplicated,
  onChange,
}: {
  value: string
  duplicated?: boolean
  onChange: (v: string) => void
}) {
  const [capturing, setCapturing] = useState(false)

  function onKeyDown(e: React.KeyboardEvent) {
    e.preventDefault()
    if (e.key === 'Escape') {
      setCapturing(false)
      return
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      onChange('')
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
    // 修飾キー無しを許すと、そのキーがどのアプリでも打てなくなる
    if (parts.length === 0) return
    onChange([...parts, key].join('+'))
    setCapturing(false)
  }

  return (
    <button
      type="button"
      className={`shortcut ${capturing ? 'is-capturing' : ''} ${duplicated ? 'is-duplicated' : ''}`}
      onClick={() => setCapturing(true)}
      onKeyDown={onKeyDown}
      onBlur={() => setCapturing(false)}
    >
      {capturing ? '押して…' : shortcutLabel(value)}
    </button>
  )
}
