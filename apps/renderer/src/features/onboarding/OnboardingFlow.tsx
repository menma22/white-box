/**
 * 初回オンボーディング。ステップの進行と、終わったときの保存だけを持つ。
 *
 * 開いているかどうかは呼び出し側（MainWindow）のローカル状態で持つ。
 * settings の onboardedAt を見て閉じる作りにすると、IPC が空返事のブラウザプレビューで閉じられなくなる。
 */
import { useState } from 'react'
import { invoke } from '@/lib/bridge'
import { useData } from '@/stores/app'
import { DoneStep, NameStep, ShortcutsStep, WelcomeStep, type Shortcuts } from './OnboardingSteps'

export function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const settings = useData().settings
  const [step, setStep] = useState(0)
  const [name, setName] = useState(settings.displayName)
  const [shortcuts, setShortcuts] = useState<Shortcuts>({ ...settings.shortcuts })

  function finish() {
    // 1 回の settings:update にまとめる。本体はこの書き込みの直後に applyShortcuts を呼ぶので、割り当てはその場で効く
    void invoke('settings:update', {
      patch: { displayName: name.trim(), shortcuts, onboardedAt: Date.now() },
    })
    onDone()
  }

  switch (step) {
    case 0:
      return <WelcomeStep onNext={() => setStep(1)} />
    case 1:
      return <NameStep value={name} onChange={setName} onBack={() => setStep(0)} onNext={() => setStep(2)} />
    case 2:
      return (
        <ShortcutsStep
          value={shortcuts}
          onChange={setShortcuts}
          onBack={() => setStep(1)}
          onSkip={() => {
            setShortcuts({ startPause: '', currentWork: '', dashboard: '' })
            setStep(3)
          }}
          onNext={() => setStep(3)}
        />
      )
    default:
      return <DoneStep name={name} shortcuts={shortcuts} onFinish={finish} />
  }
}
