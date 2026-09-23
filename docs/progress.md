# 進捗

このリポジトリの現在地。**生きた文書**なので、状態が変わったらこのファイルを更新する。
何を作るかは [product-spec.md](product-spec.md)、なぜそう作ったかは [decisions.md](decisions.md)。

最終更新: 2026-09-01

---

## 現在地

**Phase 1（MVP）実装完了。日常投入の直前。**

仕様書の開発原則どおり、ここで機能追加を止める。実際に毎日使って出た問題を溜めてから Phase 2 に入る。

**再編（[rebuild-plan.md](rebuild-plan.md) Phase 0–5 / [plans/rebuild-sessions.md](plans/rebuild-sessions.md) S1–S7）は完了。** 実装の中身・機能は変わっていない（移行中に仕様は変えない方針）が、構成が pnpm monorepo（apps/desktop・apps/renderer・packages/core・packages/contracts）へ変わったため、下表「実装場所」列は新しいパスに更新した。実装の詳細は [architecture.md](architecture.md) を参照。

**実使用起点の第 1 波（2026-08-31 まひろ指示・09-01 完了）**: 実使用 11 日で溜まったアプリ内 todo から優先 3 件を選び、ai-org-os の並列セッション 3 本で開発・統合した。T3（記録の事後修正。決定 017/018）・T4（セッション中ミニカード。決定 020）・T5（初回オンボーディング。決定 019）。

```
Phase 1  ████████████████████  完了（1-26 を除く）
Phase 2  ░░░░░░░░░░░░░░░░░░░░  未着手
Phase 3  ░░░░░░░░░░░░░░░░░░░░  未着手
Phase 4  ░░░░░░░░░░░░░░░░░░░░  未着手
Phase 5  ░░░░░░░░░░░░░░░░░░░░  未着手
Phase 6  ░░░░░░░░░░░░░░░░░░░░  未着手
Phase 7  ░░░░░░░░░░░░░░░░░░░░  未着手
```

---

## Phase 1 の項目別

| # | 項目 | 状態 | 実装場所 |
| --- | --- | --- | --- |
| 1-1 | Windows Desktop 基盤 | 済 | `apps/desktop/src/presentation/main.ts`, `apps/desktop/src/infra/windows.ts` |
| 1-2 | Project 管理 | 済 | `apps/desktop/src/domain/task-ops.ts`, `apps/renderer/src/features/settings/SettingsView.tsx`, `apps/renderer/src/features/board/BoardView.tsx` |
| 1-3 | Task Kanban | 済 | `apps/renderer/src/features/board/BoardView.tsx` |
| 1-4 | Task Tree | 済 | `apps/renderer/src/features/board/BoardView.tsx`, `apps/renderer/src/features/board/TaskDetail.tsx` |
| 1-5 | Task Progress | 済 | `apps/renderer/src/features/board/TaskDetail.tsx`, `apps/renderer/src/pages/ReviewWindow.tsx` |
| 1-6 | Start UI | 済 | `apps/renderer/src/pages/StartWindow.tsx` |
| 1-7 | Session Duration | 済 | 既定 50 分。開始画面で 25 / 50 / 90 / 任意 |
| 1-8 | Session Start | 済 | `apps/desktop/src/domain/session-ops.ts` |
| 1-9 | Pause | 済 | ショートカット / 現在の仕事 |
| 1-10 | Pause UI | 済 | `apps/renderer/src/pages/HudWindow.tsx` は表示専用ミニカード。操作は「現在の仕事」画面から行う |
| 1-11 | End | 済 | End 後に Review へ |
| 1-12 | Timer 満了 Popup | 済 | `apps/renderer/src/pages/ExpireWindow.tsx`。End / Extend / 時間指定の Break。休憩後は手動再開 |
| 1-13 | Next Task 導線 | 済 | 満了 Popup の「次のタスクへ」 |
| 1-14 | Current Work 画面 | 済 | `apps/renderer/src/pages/CurrentWorkWindow.tsx` |
| 1-15 | Current Work からの操作 | 済 | 切替 / 分解 / 新規作成 / 追加 |
| 1-16 | Task 切替（Segment） | 済 | `apps/desktop/src/domain/session-ops.ts` の `switchTask` |
| 1-17 | 1 Task = 1 Session 運用 | 済 | どちらも許可。強制なし |
| 1-18 | Session Event Log | 済 | セッション行を開くと見える |
| 1-19 | 終了 Review | 済 | `apps/renderer/src/pages/ReviewWindow.tsx` |
| 1-20 | Review 内容 | 済 | タスク別時間 / 進捗 / 完了 / 生まれたタスクの整理 |
| 1-21 | Session 永続保存 | 済 | `apps/desktop/src/infra/store.ts` |
| 1-22 | 過去 Session 編集 | 済 | `apps/renderer/src/features/sessions/SessionRow.tsx` |
| 1-23 | Session 削除 | 済 | 確認あり |
| 1-24 | 最低限 Today 表示 | 済 | `apps/renderer/src/features/today/TodayView.tsx` |
| 1-25 | Welcome 画面 | 済 | `apps/renderer/src/features/welcome/WelcomeOverlay.tsx` |
| 1-26 | Welcome の後続拡張 | **未着手** | 自分へのメッセージ・Reminder・名言など |

## 仕様の Phase 1 に無いが入れたもの

思想の中心に直結する、または記録の正しさに関わるものだけを先取りしている。

| 入れたもの | 理由 |
| --- | --- |
| 停滞タスクの浮上（Welcome） | §5「重要と言いながら永遠に何もしない状態を許さない」に直結する。Phase 2 の Aging / Warning の核だけを先に入れた |
| スリープ・画面ロックでの自動一時停止 | 離席が実作業時間に化けると、§2「歪みなく記録する」が成立しない |
| 異常終了したセッションの復旧 | アプリが落ちた時間を実作業に数えないため。最後に記録が取れた時刻で閉じるか、続きから再開するかを人間が選ぶ |
| データの書き出し／読み込み | §19（長期データ保全）の最小形。PC 移行の逃げ道を最初から用意しておく |
| 日次バックアップ（30日ぶん） | 同上 |
| 呼びかけの名前の設定 | Welcome の文面に必要。既定は空 |
| 記録の事後修正（除外の申告） | 止め忘れ・満了後放置が実作業に化けると §2「歪みなく記録する」が成立しない。実使用で顕在化（下の課題 1 件目）。決定 017/018 |
| 初回オンボーディング（ショートカット自己割り当て） | 既定キーの衝突懸念（§23 の問い）への答え。決定 019 |
| セッション中ミニカード（HUD 刷新） | §1-10 Pause UI の置き換え。表示専用・透過・クリック素通り。決定 020 |

---

## 次にやること

1. **毎日使う。** 機能追加はここで止める（仕様書 MVP 完成条件の開発原則）
2. 使って出た問題を下の「実使用で出た課題」に書き溜める
3. 溜まった課題を見て、Phase 2 の中から着手順を決める

### 実使用で出た課題

書くときは「いつ・何をしようとして・何が起きて・何が困ったか」を1行で。原因や解決案は後で考える。

- 08-27 タイマー満了に気づかず離席し、戻って終了したら放置していた時間がそのまま実作業に足されていた（アプリ内 todo 起点）→ **対処済み**（T3・決定 017/018）
- 08-21 既定ショートカット Control+Alt+S/W/D が他アプリと衝突しうる（§23 の問いと同件）→ **対処済み**（T5・決定 019）

### 実使用で答えを出したい問い

仕様書 §23 で「実使用で判断する」として保留にしたもの。

- **1 Task = 1 Session と途中切替、実際どちらで使っているか**（§23 Session UX）
- **終了レビューの重さは適切か。** 重すぎると記録自体が嫌になり、軽すぎると自己欺瞞を許す（§4 必要な摩擦）
- **既定 50 分は妥当か**（§1-7）
- **ショートカットの割り当ては他アプリと衝突しないか**（§23 技術）

---

## 更新の仕方

- Phase の状態が変わったら、このファイルの「現在地」と項目表を直す
- 設計上の判断をしたら [decisions.md](decisions.md) に1件足す
- 仕様そのものが変わったら [product-spec.md](product-spec.md) を直す（このファイルではなく）
