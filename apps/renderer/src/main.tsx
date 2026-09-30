import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/components.css'
import './styles/app.css'
import './styles/notion.css'
import { windowKind } from '@/lib/bridge'
import { initStore, useApp } from '@/stores/app'
import { MainWindow } from '@/pages/MainWindow'
import { StartWindow } from '@/pages/StartWindow'
import { HudWindow } from '@/pages/HudWindow'
import { ExpireWindow } from '@/pages/ExpireWindow'
import { ReviewWindow } from '@/pages/ReviewWindow'
import { CurrentWorkWindow } from '@/pages/CurrentWorkWindow'

const WINDOW_TITLE: Record<string, string> = {
  main: 'White Box',
  start: 'White Box — 開始',
  hud: 'White Box — 実行中',
  expire: 'White Box — 時間',
  review: 'White Box — 記録',
  current: 'White Box — 現在の仕事',
}
document.title = WINDOW_TITLE[windowKind()] ?? 'White Box'

function Root() {
  const ready = useApp((s) => s.ready)
  if (!ready) return <div className="boot" />
  switch (windowKind()) {
    case 'start':
      return <StartWindow />
    case 'hud':
      return <HudWindow />
    case 'expire':
      return <ExpireWindow />
    case 'review':
      return <ReviewWindow />
    case 'current':
      return <CurrentWorkWindow />
    default:
      return <MainWindow />
  }
}

const root = createRoot(document.getElementById('root')!)
root.render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

void initStore()
