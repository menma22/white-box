# 残作業見積・余裕時間・Todo の Aging と警告

## 目的

[Phase 2](../product-spec.md) に基づき、期限までの余裕と、やると決めた後に作業・進捗がない期間を普段の画面で確認し、人間が次の行動を選べるようにする。

## 受け入れ基準

- [x] 残作業見積と安全余裕を任意の非負の分数で保存でき、時間・分で入力できる。空欄と明示した 0 を区別し、不正値を IPC・取込で拒否する。
- [x] 作業実績を記録しても残作業見積は自動で減らない。メモ編集でも Aging をリセットしない。
- [x] Slack はローカルの締切日翌日 0:00 − 現在 − 残作業見積 − 明示した安全余裕。いずれか不明なら「不明」、暦時間で休息や別の仕事を引かない限界が見える。
- [x] Todo に置いた後の時間だけで Aging を数える。古い Inbox を Todo に移した直後には警告しない。Inbox・Done は Aging と警告対象外。
- [x] Todo/Doing への初回コミット、Inbox/Done からの再コミット、実際の進捗変更、セッション作業が適切な起点になる。旧データの欠けた起点を作成日などで補完せず、確認できない Aging は不明とする。
- [x] Normal / Warning / High Risk / Overdue の根拠が表示される。期限超過は Overdue、負の Slack は High Risk。Todo の Aging は設定の閾値以上で Warning、2 倍以上で High Risk。設定の旧不正値は 3 日へフォールバックする。
- [x] Aging が連続的に推薦順へ反映される。ユーザーは順序に関係なく任意タスクを開始・重要度変更・Inbox へ戻す操作ができる。
- [ ] Welcome・Board・Today・Week で同じ警告と次の行動が見える。Blocked の開始禁止理由を読み取れ、全4画面から詳細・待ち整理へ進める。アーカイブしたプロジェクトのタスクは警告から除外する。停止を怠慢と判定する文言を使わない。
- [x] 保存失敗時はタスク・セッション・レビューの状態を操作前へ復元し、成功した顔の状態を配信しない。
- [x] 公開 IPC と実 UI で入力・警告・任意選択・保存・再起動を確認し、画面 PNG とエラー監視を残す。ソース版と配布版の両方を検証可能。

## やらないこと

自動減算、自動開始、稼働可能時間や休暇を織り込むスケジューラ、Today/Week の独立した分析実装、依存・Blocked の別実装は追加しない。

## 設計メモ

Task に任意の `remainingEffortMinutes`・`safetyBufferMinutes`・`committedAt`・`lastProgressAt` を追加する。起点はメイン側が記録し、IPC のタスク patch からは変更できない。契約を先に変更し、時間計算・Aging・リスク・推薦を依存ゼロの `packages/core/src/task-priority.ts` に集約する。既存 `stallWarningDays` を利用する。期限はカレンダーの日付で、`dayStartHour` は適用しない。

推薦は Doing 優先、Todo 内では重要度（低 0 / 普通 1 / 重要 2）+ Aging 日数 / 閾値 + リスク（Warning 1 / High Risk 2 / Overdue 3）。同点は保存済みの `order`。Inbox は最後で、Aging を加算しない。推薦表示だけを変更し、Board のユーザーの並びは維持する。

旧形式では確かなコミット起点がない場合、実際のセッション作業を起点にできる。新しい Inbox 期間後のコミットではそれ以前の進捗とセッションを除外する。実行中の作業がある間は Aging を伸ばさず、一時停止部分を進捗として扱わない。

## 検証

pnpm 11.5.2・`install --frozen-lockfile` で検証。`typecheck`・`lint`・全 324 テスト（37 ファイル）・`build`・`pack` が成功した。旧タスクの `createdAt` を Aging 起点へ誤って加える変異で対応するテストが失敗し、復元後に純計算・表示の 29 テストが成功することも確認した。配布ツリーから新しい core export と契約を直接読み込み、年越しの締切・明示した 0・管理された起点への patch 拒否を確認した。

共有 Mutex 経路でソース版の `e2e.mjs`・`e2e-goals.mjs`・`e2e-task-priority.mjs` を実行し、全成功（終了コード 0）。配布版でも `e2e-task-priority.mjs` の全 26 確認が成功した。古い Inbox からの移動、未入力と明示した 0、時間単位、閾値変更、実際の保存失敗からの復元、任意タスクの開始、再起動を公開 IPC・実 UI で確認した。

- [ソース版の結果](../../.e2e/task-priority-run-pljEAC/result.json) / [Welcome](../../.e2e/task-priority-run-pljEAC/01-welcome-warnings.png) / [入力と Slack](../../.e2e/task-priority-run-pljEAC/02-board-effort-slack.png) / [保存失敗の表示](../../.e2e/task-priority-run-pljEAC/02b-save-failure-visible.png)
- [配布版の結果](../../.e2e/task-priority-run-01CcGE/result.json) / [再起動後](../../.e2e/task-priority-run-01CcGE/03-board-after-restart.png)

両方の renderer の例外・console error は 0。ネイティブログのエラーは検証で意図した一時保存先の EISDIR と不正 IPC 4 件の拒否のみで、再起動ログにはエラーがない。全 PNG を目視確認した。新規 E2E の各起動は強制終了なしで停止し、対象 PID の消滅を確認した。Today/Week への配置と Blocked の接続は、同時進行の各機能の統合時に同じ `TaskWarnings` を使う。

## A・B との UI 統合（結合検証待ち）

時間・依存の実装を増やさず、警告の開始可否と理由は `taskExecutionProblem` を使う。Today/Week と Welcome の詳細導線は既存の `goTasks(id)` に接続し、Board では既存の詳細選択を使う。詳細には残作業・安全余裕・リスクと `TaskControlEditor` の両方を残す。「待ち・先行タスクを整理」はこの共通詳細へ進む操作で、状態を自動変更しない。

`e2e-task-priority.mjs` に4画面の警告一致、アーカイブ除外、Blocked の開始禁止、全4画面から待ち編集への到達、理由の実 UI 保存を追加した。`node --check` は成功。結合ゲートとソース・配布版での実 UI 検証は root が実行する。上の26確認の証拠は統合前の版に対するもので、この追加分の成功を示すものではない。
