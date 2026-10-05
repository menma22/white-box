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
- [x] Aging が連続的に推薦順へ反映される。ユーザーは順序に関係なく実行可能な任意タスクを開始・重要度変更・Inbox へ戻す操作ができる。
- [x] Welcome・Board・Today・今週で同じ現在の警告と次の行動を確認できる。Blocked の開始禁止理由を読み取れ、全4画面から詳細・待ち整理へ進める。アーカイブしたプロジェクトのタスクは警告から除外する。停止を怠慢と判定する文言を使わない。
- [x] Today・今週は件数と最上位の警告理由を初期表示し、過去・未来週には現在の行動警告を混ぜない。Welcome・Boardも警告が4件以上なら初期表示を要約にし、展開後は件数制限なく全警告と操作へ届く。
- [x] 作業中の未操作の警告は折り畳む。本人が開閉した状態と警告内の操作中の展開を、時刻更新やセッション状態変更で勝手に戻さない。保存エラーは折り畳んでも表示する。
- [x] 警告タイトルは一般の詳細へ進み、「待ち・先行タスクを整理」は既存の待ち編集欄へ直接スクロール・フォーカスする。同じタスクへ再度進んでも入力を作り直さない。
- [x] 保存失敗時はタスク・セッション・レビューの状態を操作前へ復元し、成功した顔の状態を配信しない。
- [x] 公開 IPC と実 UI で入力・警告・任意選択・保存・再起動を確認し、画面 PNG とエラー監視を残す。ソース版と配布版の両方を検証可能。

## やらないこと

自動減算、自動開始、稼働可能時間や休暇を織り込むスケジューラ、Today/Week の独立した分析実装、依存・Blocked の別実装は追加しない。

## 設計メモ

Task に任意の `remainingEffortMinutes`・`safetyBufferMinutes`・`committedAt`・`lastProgressAt` を追加する。起点はメイン側が記録し、IPC のタスク patch からは変更できない。契約を先に変更し、時間計算・Aging・リスク・推薦を依存ゼロの `packages/core/src/task-priority.ts` に集約する。既存 `stallWarningDays` を利用する。期限はカレンダーの日付で、`dayStartHour` は適用しない。

推薦は Doing 優先、Todo 内では重要度（低 0 / 普通 1 / 重要 2）+ Aging 日数 / 閾値 + リスク（Warning 1 / High Risk 2 / Overdue 3）。同点は保存済みの `order`。Inbox は最後で、Aging を加算しない。推薦表示だけを変更し、Board のユーザーの並びは維持する。

旧形式では確かなコミット起点がない場合、実際のセッション作業を起点にできる。新しい Inbox 期間後のコミットではそれ以前の進捗とセッションを除外する。実行中の作業がある間は Aging を伸ばさず、一時停止部分を進捗として扱わない。

## 個別実装時の検証（統合前の履歴）

pnpm 11.5.2・`install --frozen-lockfile` で検証。`typecheck`・`lint`・全 324 テスト（37 ファイル）・`build`・`pack` が成功した。旧タスクの `createdAt` を Aging 起点へ誤って加える変異で対応するテストが失敗し、復元後に純計算・表示の 29 テストが成功することも確認した。配布ツリーから新しい core export と契約を直接読み込み、年越しの締切・明示した 0・管理された起点への patch 拒否を確認した。

共有 Mutex 経路でソース版の `e2e.mjs`・`e2e-goals.mjs`・`e2e-task-priority.mjs` を実行し、全成功（終了コード 0）。配布版でも `e2e-task-priority.mjs` の全 26 確認が成功した。古い Inbox からの移動、未入力と明示した 0、時間単位、閾値変更、実際の保存失敗からの復元、任意タスクの開始、再起動を公開 IPC・実 UI で確認した。

- [ソース版の結果](../../.e2e/task-priority-run-pljEAC/result.json) / [Welcome](../../.e2e/task-priority-run-pljEAC/01-welcome-warnings.png) / [入力と Slack](../../.e2e/task-priority-run-pljEAC/02-board-effort-slack.png) / [保存失敗の表示](../../.e2e/task-priority-run-pljEAC/02b-save-failure-visible.png)
- [配布版の結果](../../.e2e/task-priority-run-01CcGE/result.json) / [再起動後](../../.e2e/task-priority-run-01CcGE/03-board-after-restart.png)

両方の renderer の例外・console error は 0。ネイティブログのエラーは検証で意図した一時保存先の EISDIR と不正 IPC 4 件の拒否のみで、再起動ログにはエラーがない。全 PNG を目視確認した。新規 E2E の各起動は強制終了なしで停止し、対象 PID の消滅を確認した。ここまでの証拠は Today/Week と Blocked を統合する前の版に対するもの。

## A・B との UI 統合

時間・依存の実装を増やさず、警告の開始可否と理由は `taskExecutionProblem` を使う。Today/Week と Welcome の詳細導線は既存の `goTasks(id, target?)` に接続し、Board では既存の詳細選択を使う。詳細には残作業・安全余裕・リスクと `TaskControlEditor` の両方を残す。警告タイトルは一般の詳細、「待ち・先行タスクを整理」は `{ section: 'waiting' }` を渡して既存編集欄へ直接スクロール・フォーカスする操作で、状態を自動変更しない。同じタスクへの再クリックでは詳細を作り直さず、入力を保持する。

4画面は同じ `TaskWarnings` を使う。要約には「現在の警告」の件数と最上位の根拠を表示する。Todayと今週は初期折り畳み、過去・未来週には表示しない。Welcome・Boardは作業しておらず警告が3件以下なら初期展開し、4件以上または作業中なら初期折り畳みにする。展開後は全件の警告と開始・重要度変更・Inbox・整理の操作を表示する。

本人の開閉を記録し、警告内で操作中の展開も保持する。初期表示やセッション状態変更で発生する `details` の `toggle` は、本人の開閉として上書きしない。保存エラーは `details` の外、警告枠の先頭に残すため、本人が折り畳んでも確認できる。計算・保存・検証の別実装、新しいIPCや汎用入力欄は追加しない。

## 結合状態の検証（2026-10-05）

Cの結合状態で `pnpm run typecheck`・`pnpm run lint`・`pnpm run test`（43ファイル・397テスト）・`pnpm --filter @white-box/renderer run build-storybook`・`pnpm run pack` が成功した。packに含まれる本体buildも成功した。[静的ゲートの記録](C:/Users/mahim/.codex/visualizations/2026/10/05/01a10aa6-64a3-7b90-b788-7d4e19559467/review/contextual-gates.json)、[テスト](C:/Users/mahim/.codex/visualizations/2026/10/05/01a10aa6-64a3-7b90-b788-7d4e19559467/review/contextual-test.log)、[配布ビルド](C:/Users/mahim/.codex/visualizations/2026/10/05/01a10aa6-64a3-7b90-b788-7d4e19559467/review/contextual-pack.log)を参照。

最終UXの `e2e-task-priority.mjs` はソース版・配布版とも56項目成功、renderer error 0。[ソース結果](../../.e2e/task-priority-run-3t3sUf/result.json)、[配布結果](../../.e2e/task-priority-run-hpG0qo/result.json)、[940×620のToday](../../.e2e/task-priority-run-hpG0qo/01-today-compact-minimum.png)、[今週](../../.e2e/task-priority-run-hpG0qo/01-week-compact-minimum.png)、[5件の操作](../../.e2e/task-priority-run-hpG0qo/01-today-five-warning-actions.png)、[直接進んだ待ち編集](../../.e2e/task-priority-run-hpG0qo/01b-welcome-waiting-detail.png)、[折り畳み中の保存エラー](../../.e2e/task-priority-run-hpG0qo/02c-folded-warning-save-error.png)を確認した。各2起動は強制終了なし・所有PID消滅。最初のUX検証では詳細再表示後に検証器が時間のつもりで分を入力したため失敗し、単位と実保存値の確認を明示して修正した。製品の見積減算不具合ではない。

結合配布版の共通mutex検証は11スクリプトすべて終了コード0。新機能のpriority56・activity50・dependencies60確認に加え、既存の基本操作・道標・session modes・timeline・notes・agents・start reminder・presence candidatesを通過した。[配布版の全ログ](C:/Users/mahim/.codex/visualizations/2026/10/05/01a10aa6-64a3-7b90-b788-7d4e19559467/review/contextual-package-ui.log)。古いスクリプトには終了処理でQAプロセスを停止するものがあり、11本すべてを自然終了の検証とは呼ばない。ソース版の変更影響5本も成功。道標は業務61確認・renderer error0後に自然終了timeoutで失敗した[証拠](../../.e2e-goals/run-JlNg6P/result.json)を保持したうえで再測定し、[64項目・保存・再起動・renderer error0・各2起動の自然終了](../../.e2e-goals/run-PXExgp/result.json)を確認した。再測定の成功を間欠的な終了問題の解決とは扱わない。

結合実行で観測した配布版の間欠的なQUIT timeoutは根因未確定。観測付きの成功や診断器自身の修復を、製品の終了問題の修正と扱わない。[終了失敗の診断と証拠](C:/Users/mahim/.codex/visualizations/2026/10/05/01a10aa6-64a3-7b90-b788-7d4e19559467/review/quit-race-report.md)を参照。このstoryはレビュー用ブランチの状態を記録し、Phase 2全体の完了や本番への適用を示さない。
