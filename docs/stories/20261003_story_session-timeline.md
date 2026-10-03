# 今日のタイムラインを読み取れるようにする

## 目的

アプリ内 White Box の `tsk_mt2ln6qtwl8ys9`（2行にして時間あたりの横幅を広げる）と `tsk_mt2locclygshbh`（実行区間にカーソルを合わせて詳細を見る）を実装する。product-spec.md §2 の「歪みなく記録し、後から読める」に沿い、時間の分布と各区間の意味を確認できるようにする。

## 受け入れ基準

- [x] 時間軸を同じ縮尺の2行に分け、各行に開始・終了時刻を表示する。
- [x] 行の境界をまたぐセッション・タスク・停止・除外を各行へ切り分け、区間を欠落・二重計上させない。
- [x] マウスとキーボードのフォーカスで、タスク名・プロジェクト・日時・区間の実作業時間を確認できる。
- [x] 一時停止と申告による除外を別の文言で表示する。今日の上部集計も分ける。
- [x] 開始直後、終了済み、日付をまたぐ記録、削除されたタスクで表示が壊れない。
- [x] 型・lint・単体テスト・実アプリE2Eが通り、実際の画面で2行と詳細の可読性を確認する。

## やらないこと

記録の自動推定、タイマーの状態遷移変更、既存データの変更、アプリ内タスクの自動完了。

## 設計メモ

renderer の DayRibbon、表示用の時間軸計算、CSS、固定状態のStorybook、検証だけを変更する。区間の停止差し引きは core の既存関数を使う。詳細は帯の下に固定の表示領域を設け、狭い区間や端でも欠けないようにする。最新 origin/main を基準に実装する。

## 実装と検証（2026-10-03）

基準: `origin/main` の `adad7e1`。ローカルのルート checkout はこれと異なる履歴なので、`codex/session-timeline` の専用worktreeで実装した。

- 表示: [DayRibbon.tsx](../../apps/renderer/src/features/today/DayRibbon.tsx)・[TodayView.tsx](../../apps/renderer/src/features/today/TodayView.tsx)・[today.css](../../apps/renderer/src/styles/screens/today.css)
- 時間軸の切り分け: [day-ribbon.ts](../../apps/renderer/src/lib/day-ribbon.ts)
- 固定状態のプレビュー: [DayRibbon.stories.tsx](../../apps/renderer/src/stories/screen/DayRibbon.stories.tsx)
- 境界・開始直後・停止・日付またぎの検証: [day-ribbon.test.ts](../../apps/renderer/tests/day-ribbon.test.ts)
- 実exeのホバー・Tab操作・区間詳細・700px幅・保存データ不変の検証: [e2e-timeline.mjs](../../scripts/e2e-timeline.mjs)

`pnpm run typecheck`・`pnpm run lint`・`pnpm run test`（116件）・`pnpm run pack` が成功。変更前は109件成功。既存 `scripts/e2e.mjs` はソースビルドと生成したexeの両方で全項目成功。追加E2Eも両方で成功し、レンダラエラーは0件。コメント専任レビューで修正指摘なし。

画面確認: [通常表示](../../.e2e/timeline-JuVmlh/01-timeline.png)・[ホバー詳細](../../.e2e/timeline-JuVmlh/02-hover-detail.png)・[狭い画面の除外詳細](../../.e2e/timeline-JuVmlh/03-narrow-exclusion.png)。画像を目視し、時刻・作業時間・一時停止・除外の区別を確認した。検証起動にはGPU描画待ちを避けるため `--disable-gpu` を指定した。本体の起動設定は変更していない。

確認用の [White Box.exe](../../release/White%20Box/White%20Box.exe) を生成した。インストール済みアプリの置き換えやmainへのマージは行っていない。E2Eのデータとプロファイルは `.e2e/` に隔離した。画像・exeはgitの追跡外で、このworktree内にある。
