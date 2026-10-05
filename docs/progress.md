# 進捗

このリポジトリの現在地。**生きた文書**なので、状態が変わったらこのファイルを更新する。
何を作るかは [product-spec.md](product-spec.md)、なぜそう作ったかは [decisions.md](decisions.md)。

最終更新: 2026-10-06

---

## 現在地

**Phase 1（MVP）に加え、道標の既存機能を統合。日常使用中。** 再編と第 1 波（PR #2）を `main` に統合し、道標も新構成へ移した。

2026-10-05 の本番は `main 743fc25`（PR #9–#20 統合版）。以下の Phase 2 追加はレビュー用ブランチの実装状態で、本番には反映していない。実績・依存と外部待ち・任意見積とリスクを分けてレビューする。

2026-09-24 の依頼により、目標マップ・タスク・問題／問い／改善・構造履歴と旧データ取り込みを追加した。[機能対応・保存・検証](michishirube.md)を参照。これは Phase 3 の成果設計の実装ではない。以下のフェーズ表は当初ロードマップの進捗を示す。

**再編（[rebuild-plan.md](rebuild-plan.md) Phase 0–5 / [plans/rebuild-sessions.md](plans/rebuild-sessions.md) S1–S7）は完了。** 再編の各段階では機能を変えずに pnpm monorepo（apps/desktop・apps/renderer・packages/core・packages/contracts）へ移した。PR #2 には、その後の第 1 波と `main` の PR #3〜#5 の機能も統合した。下表「実装場所」列は新しいパスを示す。実装の詳細は [architecture.md](architecture.md) を参照。

**実使用起点の第 1 波（2026-08-31 まひろ指示・09-01 完了）**: 実使用 11 日で溜まったアプリ内 todo から優先 3 件を選び、ai-org-os の並列セッション 3 本で開発・統合した。T3（記録の事後修正。決定 017/018）・T4（セッション中ミニカード。決定 020）・T5（初回オンボーディング。決定 019）。

```
Phase 1  ████████████████████  完了（1-26 を除く）
Phase 2  レビュー用ブランチで全項目を実装・検証済み。未統合・本番未反映（下表）
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
| 1-26 | Welcome の後続拡張 | 一部実装 | Welcomeの日次メモと警告、通常画面のノートReminder。名言等の後続拡張は未実装 |

## Phase 2 の項目別

ここで「実装」はレビュー用ブランチの状態。機能ごとの受入条件と検証経路は各storyに置く。

| 項目 | 状態 | 実装・受入への入口 |
| --- | --- | --- |
| Today / Week / 最近の作業時間推移 | 実装 | [実績story](stories/20261005_story_activity-views.md)、`packages/core/src/activity.ts`、`apps/renderer/src/features/today/` |
| Blocked / Dependency Blocked / Hard Dependency | 実装 | [依存・外部待ちstory](stories/20261005_story_dependencies-and-external-follow-up.md)、`packages/core/src/task-control.ts`。進捗とは別、Doneのみが必須先行を満たす |
| External Blocked / Follow-up | 実装 | 同story、`apps/renderer/src/features/board/ExternalWaiting.tsx`。本人が確認日・連絡日を記録する |
| Recommended Order | 実装 | 同story。先行未完でも開始可能 |
| Estimated Effort / Slack | 実装 | [見積・停滞・警告story](stories/20261005_story_effort-slack-aging-and-risk.md)、`packages/core/src/task-priority.ts`。残作業と安全余裕の欠損は不明 |
| Aging / Warning Escalation / 通常画面の警告 | 実装・実UI検証済み | 同story。確かなTodoの起点と実作業を使い、Welcome・Board・Today・今週で現在の警告を確認する |
| Project Priority / Weekly Time Budget / Fixed Work | 実装・実UI検証済み | [完成story](stories/20261006_story_phase2-completion.md)。旧未設定・生活時間の欠損・外部予定と実績の区別を保持 |
| Task Notes / Problems / Decisions / Next Context | 実装・実UI検証済み | 同story。既存のタスクnotes・linked Noteを保持し、必要な種類だけ編集する。Start/Current Workで再開文脈を参照する |

3storyの結合状態では、警告の件数と最上位理由を要約し、展開すれば全警告を操作できる。Today・今週は初期要約とし、過去・未来週へ現在の行動警告を混ぜない。Welcome・Boardも作業中または警告が4件以上なら初期折り畳み。本人の開閉と操作中の展開を保持し、保存エラーは折り畳んでも表示する。警告タイトルは一般詳細、整理操作は既存の待ち編集欄へ直接進む。

2026-10-05の3story結合版は型検査・lint・43ファイル397テスト・Storybook build・pack（本体buildを含む）を通過した。当時の最終UXのソース版・配布版でpriority56・activity50・dependencies60項目が成功し、配布版の共通mutex検証は11本、変更影響のソース版5本も通過。[見積・警告story](stories/20261005_story_effort-slack-aging-and-risk.md)へ当時のQA結果・画像・保存・再起動証拠を記録した。これは下記の追加分の検証とは区別する。

2026-10-06の完成storyは残る4項目と、窓をまたぐ入力保存・終了中の再開防止を追加した。型検査・lint・53ファイル480テスト・Storybook build・pack、ソース版と配布版の新機能各75項目・既存機能の共通各11本が成功。終了は観測器あり9項目・なし5項目、PID再利用の判定は14テストを通過し、配布物131ファイルのバイト一致を確認した。[完成story](stories/20261006_story_phase2-completion.md)と[検証記録](qa/20261006_phase2-completion.json)に測定対象と未確認事項を記録した。Windowsのファイル選択ダイアログの実操作はアクセス拒否により未確認。過去の間欠的QUIT timeoutのnative根因も未確定であり、今回再現・修正した終了準備の競合と区別する。未統合・本番未反映。

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

1. **毎日使う。** 道標も含め、目標からタスク実行・記録までを使って確かめる
2. 使って出た問題を下の「実使用で出た課題」に書き溜める
3. Phase 2のPR統合・本番反映の範囲を確定し、反映後の実使用で判断根拠・資源配分・再開文脈を確かめる。Phase 3以降は別に着手順を決める

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
