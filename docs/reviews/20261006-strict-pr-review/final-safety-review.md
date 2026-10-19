# 独立した最終安全性レビュー

最初の独立レビューで再現した6件は修正後のプローブで対処を確認した。この表は `779df6e566a77d0c4fef4c8ef575d885e565f799` から修正途中の差分を検算した記録であり、最終版全体の無欠陥を主張しない。プローブは実利用DBを書き換えず、合成データ・隔離Portで測定した。後続で見つけた終了時の生存記録保存は末尾に分ける。最終製品の測定対象は `125026f7088487a429170f6276786a13f0e40c4c`、QAは `130016c83ce352598283ca8378362dad3c1821b0`。全体結果と残る制約は [レビュー入口](README.md) を正本とする。

## 再現した問題

| 優先度 | 具体的な結果 | 再現・根拠 | 修正確認 |
| --- | --- | --- | --- |
| P1 | 進行中セッションの開始を未来へ編集して終了すると、アプリ自身が保存したDBを次回起動で拒否する。元ファイルは保持されるが全記録へアクセスできなくなる。 | `session:update` → `session:end` → JSON roundtrip → `validateStoredDatabase` が「終了時刻が開始時刻より前」で拒否。[境界プローブ](../../../artifactreview/strict-20261006/final-boundary-probes.test.ts)。実UIの [SessionRow](../../../apps/renderer/src/features/sessions/SessionRow.tsx) に未来時刻の上限がない。 | 修正後は未来の編集を変更前に拒否し、続く終了を検証器が受理する。時計が戻った場合の終了も受理する。独立3件が成功（19:15:37）。 |
| P2 | 現在の仕事の窓を開いたまま最近の実行中セッションを取り込むと、整理時間60秒が実作業へ加算される。 | 同じ境界プローブ。`runtime.currentWorkOpen=true` を維持しても取り込み後は `running`。[整理時間の受入条件](../../stories/20261004_story_task-management-time.md)。 | `restoreCurrentWorkPause` 後はpausedで、60秒経過しても実作業増分0。独立プローブと修正helperの読解で確認。 |
| P2 | 順番に保存する編集欄のうち、先に完了した欄へ再入力でき、後の欄の待機が終わると未保存の入力ごと画面が閉じる。 | 実 `useDraftParticipant` / `flushDraftParticipants` / `OptionalDurationDraft` を使い、90保存 → 後続待機 → 120入力 → 移動許可を確認。[保存競合プローブ](../../../artifactreview/strict-20261006/final-safety-probes.mjs)。 | `EditorFlush.run` が保存全体と移動中の凍結を保ち、二重移動を拒否することを確認。MainWindowとTaskDetailの `inert` 接続も読解確認。実DOMは統合担当の確認対象。 |
| P2 | 自分の文脈保存応答より先に別画面の新しい保存を受け取ると、古い期待値へ戻り、以後の保存と移動が拒否され続ける。 | 実 `TaskContextEditor` コールバックを隔離したフックハーネスで、自分A → 別画面B → 自分の応答 → 次の入力Cを実行。修正前はBがDBにあるのに期待値Aで繰り返し失敗。 | `acknowledgeContext` の修正後、期待値BでCを保存し、続くflushが成功することを同じプローブで確認。 |
| P2 | タスク名のblur保存を待たずに詳細を閉じられ、遅れて保存失敗すると入力もエラーも閉じた画面へ残る。 | 実 `TaskDetail` のタイトル変更、blur、closeコールバックで、未完の書込中に `onClose` が呼ばれることを確認。同じ保存競合プローブ。 | `TaskTitleDraft` 導入後は保存待機中にcloseせず、失敗後も詳細・入力・エラーを保持することを実コールバックで確認。一覧のタイトル保存にも同じ期待値と制御を接続した。[一覧の折畳みプローブ](../../../artifactreview/strict-20261006/task-title-row-transition-probe.mjs) は実 `runEditorAction` まで読み込み、タイトル保存失敗で行を消さず、窓の凍結を解除することを確認。 |
| P2 | ノート追加処理が旧ノートのflush後に待機している間も入力でき、追加成功で旧ノートを閉じた後のcleanup保存が失敗すると入力へ戻れない。アーカイブと関連ノートの処理にも同じ構造がある。 | 実 `NotesView` / `NoteAutosave` の [ノート移動プローブ](../../../artifactreview/strict-20261006/notes-transition-probe.mjs)。初期flush成功 → `note:create` 待機 → 旧本文再入力 → 新ノート選択 → cleanup保存失敗。[文脈と保存失敗の受入条件](../../stories/20261006_story_phase2-completion.md)。 | 処理全体でancestorがinertとなり、成功後に解除することを確認。追加失敗時は選択中のeditorとエラーを保持して解除する。関連ノートの同じ接続も読解確認。実DOMは統合担当の確認対象。 |

## その他の安全境界

- `Store.load` は検証と正規化が成功するまでDBを返さず、失敗時は元ファイルを保持する。未知のDBバージョン、未知のルート項目、重複ID、複数の未終了セッションを置換前に拒否する経路を確認した。
- 旧データの任意フィールドがないことと破損を区別した。Noteの日時既定値は実際に正規化へ反映され、Task/Project/Sessionの任意フィールドは保存される元レコードに保持される。通常の既定値補充を欠陥として数えていない。
- 原子保存が失敗した場合のDB/実行時状態のrollback、変更後に窓を開く順序、取込で旧DBのheartbeatを使わない経路を確認した。復旧で実行不能な計測を止める安全状態の維持は、拒否したユーザー変更の漏出とは区別した。
- 現在の仕事のclose/switch/endには、ローカルflushの後にnativeのRendererFlush要求が入り、処理前に再flushと凍結が行われる。そこに追加の文脈喪失は確認していない。
- 月別履歴は対象月だけ日キーを生成し、全体合計は全セッションの範囲で集計する。表示月の変更で過去の合計を切り捨てる経路は確認していない。

## 測定範囲

独立プローブは実ソースを読み込み、保存制御・コンポーネントのコールバック・ハンドラを実行する。フックとPortのハーネスは描画や永続化の実機確認の代替ではない。全テスト、build、実Electronの表示と終了は統合担当が実行する。

初回の境界プローブはsandboxのesbuild起動が `spawn EPERM` で失敗し、通常の権限昇格後に2件の欠陥再現が成功した。製品のテスト失敗とは区別した。

最終独立確認は境界3テスト（[専用Vitest設定](../../../artifactreview/strict-20261006/final-boundary-probes.config.ts)）、保存競合・タイトル失敗のNodeプローブ、ノート追加の成功/失敗のNodeプローブ、一覧折畳みのNodeプローブが成功した。折畳みハーネスの初回は並行修正で追加された `runEditorAction` のmock未対応で開始できず、実moduleを読み込むよう修正した。応答鎖の検証はイベントループの1巡を待ち、固定回数のmicrotask待機による途中状態を最終結果と混同しない。

## 補足: 予約したcloseが再表示した窓へ届く競合

`window:close` を同じ種類へ2回依頼し、最初の予約で閉じた後、残りの予約が動く前に再表示すると、以前の `closeLater` は種類で窓を再検索して新しい窓を閉じた。旧 `main.ts` の実initializerをASTから取得し、実 `windows.ts` とmock Electronへ接続したread-onlyのプローブで確認した。実DB・UI・通信は使っていない。このP2の静的到達とsourceプローブは、[planningのRuntime.enable timeout](evidence/known-failures.json) の原因を立証するものではない。

[closeWindowsLater](../../../apps/desktop/src/infra/windows.ts) は予約時に元BrowserWindowを保持し、150ms後に終了状態の許可と元窓の生存を確認する。[mainの配線](../../../apps/desktop/src/presentation/main.ts) もこのhelperへ変更した。[回帰テスト](../../../apps/desktop/tests/windows-shutdown.test.ts) は残った予約が再表示した窓を閉じないこと、元窓の150ms待機とnative保存確認、破棄済み窓・予約時に存在しなかった窓・終了準備中・終了中のno-opを確認する。保存flushの既存テストと合わせて22件が成功した（20:12:59）。この後に全体のbuild・typecheck・617テストと実Electronの確認を完了した。最終測定点と範囲は[レビュー入口](README.md)と[最終検証記録](../../qa/20261006_strict-pr-review.json)を参照する。

## 補足: 実Storeの周期記録と終了保存の契約

提出前の追加検算で、周期的な `markAlive` の失敗を無視する既存挙動が、終了時にも使われていた。これは旧形式での既存欠陥と、PR #24で追加した終了取消の契約不足を区別して扱う。合成データで09:00開始、09:55からruntimeだけが書込不能、10:00終了、10:10再起動を実行すると、DB保存は成功してtickerが止まったが、復旧は09:55を使い55分になった。正常系は60分を保持した。writeとrenameの両方で5分欠落を再現した。[修正前](evidence/shutdown-heartbeat-before.json)。

`125026f7` は `prepareQuit` だけ成功必須の指定を渡す。周期記録とwakeのbest-effortは維持する。同じ実Storeプローブの[修正後](evidence/shutdown-heartbeat-after.json)は3条件成功し、故障2条件は終了取消・ticker継続・最終DBrename 0、正常系は60分・欠落0を確認した。正式なstore-saveの追加2条件も書込/rename失敗後の取消、再試行、再起動による35分保持を確認した。

正式テストのSystemPortは、実 `prepareQuit` を同期的に呼ぶ模擬Portである。製品の `app.quit` → `before-quit` は非同期で、失敗はnativeエラーダイアログへ表示する。単体テストの `receive(app:quit)` がok:falseになる結果を、実IPCの返答形式の証明とは扱わない。mainの実配線は保存成功後だけサービスを停止し、catchで入力ロックを解除して終了を取り消す。初回の新テストは模擬SystemPortが実prepareQuitへ未接続であり、真のbaseline再現に含めない。
