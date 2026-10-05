# 依存関係と外部待ち

## 目的

[product-spec.md の Phase 2](../product-spec.md#phase-2--task-control--可視化強化) に基づき、進捗がある仕事でも、何に阻まれているかと次に確認する日を見えるようにする。

## 受け入れ基準

- [x] Blocked は Inbox / Todo / Doing / Done と進捗から独立して保存され、解除しても進捗を変えない。
- [x] 必須の先行タスクをリンクでき、未完・削除済みの先行タスクがある間は開始・切替・再開・Doing 移動を全 IPC 経路で拒否する。
- [x] 自己参照・循環・新規の不存在参照・重複リンク・不正入力は状態を変更せず拒否する。
- [x] 先行タスクの完了で依存待ちが解除される。削除された参照は残り、明示的なリンク解除で開始できる。
- [x] 推奨する先行タスクを表示できるが、未完でも実行を強制・禁止しない。
- [x] 外部待ちの誰・何・いつから、最終連絡日、次に確認する日を保存できる。
- [x] ボードの専用「外部待ち」表示で、確認日が来た仕事に「確認しますか？」を表示し、詳細編集・解除へ進める。
- [x] 保存失敗時に変更を巻き戻し、画面にはエラーを表示する。
- [x] 旧データは新しい optional フィールドなしで読み込める。保存・再起動後も内容と阻害判定が一致する。
- [x] 実アプリの public IPC・UI・スクリーンショット・コンソールエラーを隔離データで確認する。配布版でも同じスクリプトを実行できる。
- [x] Welcome・Board・Today・今週の共通警告で開始できない理由を読み取れ、タイトルから一般詳細、整理ボタンから既存の待ち編集欄へ直接スクロール・フォーカスできる。全件展開・作業中の初期折り畳み・本人の手動展開保持・折り畳み中の保存エラー表示を結合版の実UIで確認する。

## やらないこと

自動連絡・外部送信、Slack / 努力見積 / Aging / スケジュール、目標の自動達成、通常データ・ショートカットの変更。

## 設計メモ

core の純関数で阻害判定とリンク検証、contracts の strict 入力、desktop の純粋な状態遷移と commitChanges による保存、renderer の詳細編集と専用一覧を使う。

仕様で未決の UI は既存ボードと詳細の中に置く。必須は status が Done の場合のみ満たされる（進捗 100% だけでは未完）。アーカイブされた未完の先行タスクも待ちを維持し、アーカイブプロジェクトのタスク自体は開始できない。Inbox のリンクと外部待ちも保持・表示し、開始時には従来どおり Doing にコミットする。外部待ち一覧は Done を除き、アーカイブ分は明示的な表示切替で確認できる。

実行中・一時停止中のセッションの現在タスクが実行不能になる変更（Blocked / 外部待ち追加、先行タスクの再開・削除、アーカイブ等）は拒否する。先にセッションを終了して整理する。履歴のタスク割当補正は過去の記録なので開始判定の対象外。

不存在 ID の開始は拒否する。Done の直接開始は進捗 100% のまま暗黙に Doing へ戻るため、先に本人が Todo に戻す。復旧・ポモドーロ自動再開・整理窓を閉じたときの再開にも同じ開始条件を適用する。

データ取込成功後も起動時と共通の復旧処理を通し、旧セッションの監視・復旧・レビュー表示を引き継がない。既に保存された実行不能なデータの復旧保存が失敗した場合は、安全のため停止したセッションと復旧表示をメモリ上に維持し、保存せず配信する。この例外は通常の編集・開始・再開の保存失敗時の巻き戻しと区別する。停止状態を再保存して再起動した後も計測を増やさず、阻害解除まで再開を拒否する。

Windows の rename が EPERM / EBUSY / EACCES を返す場合だけ、20ms 間隔で最大3回（待機合計60ms）再試行する。保存先の削除や直接上書きは行わず、永続失敗・それ以外のエラーは呼出元へ返す。取込の最初の保存が失敗した場合は Store.replace 自体も旧データへ戻る。

## 個別実装時の検証（統合前の履歴）

`pnpm run typecheck`、`pnpm run lint`、`pnpm run test`（38ファイル・328件）、`pnpm run build`、`pnpm run pack` が成功した。入力境界・グラフ・遷移・復旧の回帰は [contracts](../../packages/contracts/tests/task-control.test.ts)、[core](../../packages/core/tests/task-control.test.ts)、[desktop](../../apps/desktop/tests/task-control.test.ts)、[旧データ](../../apps/desktop/tests/task-control-store.test.ts)、[実 Store の保存故障](../../apps/desktop/tests/store-save.test.ts) で確認する。開始ガードを一時的に無効化した検算では対象テストが11件失敗し、復元後は全件成功した。

[隔離 UI スクリプト](../../scripts/e2e-dependencies.mjs) を [共通 mutex](../../scripts/run-ui-e2e.ps1) 経由で実行した。個別検証のソース版 [run-BY6cPJ](../../../phase-2-dependencies-and-external-follow-up/.e2e-dependencies/run-BY6cPJ/report.json)、配布版 [run-gUYQuY](../../../phase-2-dependencies-and-external-follow-up/.e2e-dependencies/run-gUYQuY/report.json) は各60項目成功、renderer exception / console error 0。各8枚の実画面と撮影対象 URL・可視状態を記録し、外部待ち、削除参照の解除、開始候補、循環エラー、再起動後の復旧表示を目視確認した。所有する各3プロセスは `app:quit` で終了し、強制終了なし・残存なし・mutex 解放を確認した。実アプリログに未処理例外・fatal・保存競合エラーは無かった。これらの run ディレクトリはローカル検証証拠であり、リポジトリには含めない。

配布版の最初の撮影 timeout は [run-yxRQ6I](../../../phase-2-dependencies-and-external-follow-up/.e2e-dependencies/run-yxRQ6I/report.json) に保持した。取得前に公開 `window:open` で対象窓を表示する既存 notes の方式に合わせた。ソース版の状態比較失敗 [run-bhKlAm](../../../phase-2-dependencies-and-external-follow-up/.e2e-dependencies/run-bhKlAm/report.json) も保持し、候補窓を閉じた後は CDP の対象消失まで待つようにした。検証失敗と最終成功の証拠を区別し、アプリの実行機構はスクリプトへ複製していない。

## 警告との結合状態（2026-10-05）

警告からの開始判定は既存の `taskExecutionProblem` を使い、開始不能理由を読める形で表示する。「待ち・先行タスクを整理」と外部待ちの確認は、同じ `TaskControlEditor` へ直接スクロール・フォーカスする。タイトルからは一般の詳細へ進む。同じタスクへの再クリックで編集入力を作り直さず、状態を自動変更しない。4画面は共通の警告表示を使い、Today・今週は初期要約、過去・未来週には現在の警告を表示しない。作業中の未操作の警告は折り畳むが、本人の開閉と操作中の展開は保持し、保存エラーは折り畳んでも表示する。展開後は件数制限なく全警告を操作できる。

Cの結合状態で型検査・lint・43ファイル397テスト・Storybook build・pack（本体buildを含む）が成功した。依存E2Eは[ソース版](../../.e2e-dependencies/run-1qhKV4/report.json)・[配布版](../../.e2e-dependencies/run-8IXZtV/report.json)各60項目成功・renderer error0。各3起動は強制終了なし・所有PID消滅。[外部待ち](../../.e2e-dependencies/run-8IXZtV/01-detail-external-wait.png)・[復旧時の開始禁止](../../.e2e-dependencies/run-8IXZtV/05-blocked-recovery.png)と新UXの直接フォーカスを実読した。上のBの成功は歴史として保持する。結合実行で観測した配布版の間欠的QUIT timeoutの根因は未確定で、製品の修正済みとはしない。[結合ゲートと診断証拠](20261005_story_effort-slack-aging-and-risk.md)を参照。Phase 2全体の完了・本番適用はこのstoryの対象外。
