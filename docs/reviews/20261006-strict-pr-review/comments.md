# コメント審査

**判定: PASS。コメントに関する修正指摘なし。** PR #21–#24 の原差分と今回の安全修復を審査した。ロジック・型・テストの充足についての判定は含まない。

## 適用規約

- R1 — [CLAUDE.local.md:18](../../../CLAUDE.local.md:18)・[docs/architecture.md:110](../../architecture.md:110): セッションの真実はメインプロセスが持ち、app 層は Electron を直接知らず Port に依存する。層の理由と利用上の制約を保持する。
- R2 — [CLAUDE.local.md:19](../../../CLAUDE.local.md:19)・[CLAUDE.local.md:31](../../../CLAUDE.local.md:31)・[docs/decisions.md:192](../../decisions.md:192): 実作業は停止・除外を適切に扱い、暦の日境界と重複時の帰属を共有する。時間の意味と境界条件を保持する。
- R3 — [CLAUDE.local.md:22](../../../CLAUDE.local.md:22)・[CLAUDE.local.md:23](../../../CLAUDE.local.md:23)・[docs/architecture.md:53](../../architecture.md:53): コマンド契約が合意点であり args は strict のまま置く。コメントを現行契約と矛盾させない。
- R4 — [docs/decisions.md:202](../../decisions.md:202)・[docs/decisions.md:204](../../decisions.md:204)・[docs/decisions.md:206](../../decisions.md:206): 実行条件は復旧・自動再開・取込でも共通。見積と実績、現在のコミットと Inbox 滞在を区別し、復旧保存失敗時の安全停止を保持する。
- R5 — [docs/decisions.md:214](../../decisions.md:214): 生活時間の空欄を推定値で埋めない。
- 上記以外は、本審査への指示にある意味保存原則を補助的に適用した。コードの同じ読者へ同じ精度で伝わると証明できない意味は残す。

対象 root は `git rev-parse --show-toplevel` でこの checkout と確認した。root・変更パス上に `AGENTS.md` はなく、`.agents/skills/*/SKILL.md` もない。外側の作業ディレクトリの `CLAUDE.local.md` も読み、対象 root の現行 `CLAUDE.local.md` と、そこが参照する正式文書を優先した。コメント量・長さを削減する規約やコメント言語の強制は見つからなかった。他リポジトリの規約は適用していない。

## コメント審査: 追加/変更 15 件

比較範囲は #21 `743fc25a→48cc55f7`、#22 `48cc55f7→c9c19782`、#23 `c9c19782→123666b1`、#24 `123666b1→779df6e5` と、`779df6e5` からの作業差分・新規ソース/テスト。数はコメントブロックの差分発生単位（#21: 6、#22: 1、#23: 5、#24: 2、修復: 1）。追加・変更された意味のあるコメント行は 17 行。同じ復旧 docstring の再変更を含み、現在の固有ブロックは 14 件。

文字列中の URL・glob、JS の private field、UI 文言、設定値、story/ADR/PR 等の文書本文はコメントに数えていない。新規ソース/テストに追加コメントはなかった。

### 削る（0 件）

なし。

### 修正する（0 件）

なし。

### 移す（0 件）

なし。

### 残す（15 件）

- #21 [apps/desktop/src/app/lifecycle.ts:2](../../../apps/desktop/src/app/lifecycle.ts:2) — 起動・取込の復旧と毎秒の満了判定が対象であること、業務ルールゆえに app 層へ置くこと、Electron を知らない境界。読者: 復旧処理の変更者。R1。
- #21 [apps/desktop/src/app/lifecycle.ts:11](../../../apps/desktop/src/app/lifecycle.ts:11) — 閾値を超えた記録の空白を PC 停止と「みなす」意味。読者: 復旧閾値の変更者。R2・R4。旧 `presentation/main.ts` の同じコメントを定数とともに逐語移動しており、削除された側の意味もここに全て残る。
- #21 [apps/desktop/src/app/lifecycle.ts:14](../../../apps/desktop/src/app/lifecycle.ts:14) — 読込データの開いた Session を対象にする。実行不能な現在 Task は空白長によらず最後の記録時刻で止めて復旧を尋ねる。復旧保存が失敗してもメモリ・表示の停止を維持する。整理区間は生存/操作記録の新しい時刻で閉じ、現在時刻を上限にする。他の停止を維持し、停止がなければ復旧停止する。自動再開しない休憩は確認せず監視再開、自動再開する休憩の長い空白は再開前に確認する。その他は生存/操作記録の新しい方から `crashGapMs` を超えた空白で recovery とし、短い空白なら計測を続ける。読者: 復旧処理と呼出側の変更者。R1・R2・R4。base の既存条件も欠落していない。
- #21 [apps/desktop/src/app/lifecycle.ts:76](../../../apps/desktop/src/app/lifecycle.ts:76) — タイマー満了は停止・確認、ポモドーロ満了は休憩へ移る。休憩の自動再開には設定・現在 Task の実行可能性・整理/復旧/他の停止がないことが必要。それ以外は停止を保ち確認する。ストップウォッチに作業満了はない。読者: 満了/自動再開の変更者。R2・R4。
- #21 [apps/desktop/src/app/ports.ts:55](../../../apps/desktop/src/app/ports.ts:55) — 通常は状態を保存して全窓・トレイへ配布する。実行不能な保存済みデータの復旧停止を保存できなかった例外で `persist=false` を使い、安全停止を配信する。読者: `Ctx.publish` の実装者・呼出者。R1・R4。IDE が読む Port 契約の説明として保持する。
- #21 [apps/renderer/src/features/board/TaskDetail.tsx:58](../../../apps/renderer/src/features/board/TaskDetail.tsx:58) — `Record<string, unknown>` ではキーの綴り違いを型検査できず、送る patch を `Partial<Task>` に限定する理由。読者: Task 編集 UI の変更者。R3。旧文の「zod が黙って捨てる」は base から `TaskSchema.partial().strict()` と一致していなかった。型で防ぐという固有の注意は現文に保持されている。
- #22 [packages/core/src/activity.ts:52](../../../packages/core/src/activity.ts:52) — 編集で重なる時間を一度だけ数え、開始時刻・ID・区間順の先行記録へ帰属させる方針。読者: 集計の変更者。R2。処理を追えることだけでは、この帰属方針を変更してよいか判断できない。
- #23 [apps/renderer/src/features/settings/SettingsView.tsx:18](../../../apps/renderer/src/features/settings/SettingsView.tsx:18) — `Record<string, unknown>` ではキーの綴り違いを型検査できず、送る patch を `Partial<Settings>` に限定する理由。読者: 設定編集 UI の変更者。R3。旧文の silent drop は strict 契約と一致せず、現文が注意点を保存している。Task の編集者と設定の編集者は別々の使用箇所でこの前提を必要とするため、完全重複とは判定しない。
- #23 [packages/core/src/task-priority.ts:37](../../../packages/core/src/task-priority.ts:37) — 日付の締切はローカル翌日 0:00。作業日の境界と混同せず、夏時間を固定 24 時間で代用しない。読者: 締切計算の利用者・変更者。R2・R4。IDE から参照する関数契約でもある。
- #23 [packages/core/src/task-priority.ts:46](../../../packages/core/src/task-priority.ts:46) — 対象 Task の実作業区間の最後を返し、停止・除外・タイマー満了の時間を含めない。読者: Aging 計算の利用者・変更者。R2・R4。関数名だけで除外条件を同じ精度では復元できない。
- #23 [packages/core/src/types.ts:58](../../../packages/core/src/types.ts:58) — 残作業の見積であり、Session 実績から自動減算しない。読者: Task 型の利用者。R4。公開型のフィールド契約として保持する。
- #23 [packages/core/src/types.ts:61](../../../packages/core/src/types.ts:61) — 現在のコミット期間の開始であり、Inbox 滞在期間を含めない。読者: Task 型の利用者。R4。作成日時等と混同しないためのフィールド契約として保持する。
- #24 [apps/desktop/tests/handlers.test.ts:1](../../../apps/desktop/tests/handlers.test.ts:1) — Electron を起動しないユースケース検査で、全コマンドを偽 Port で実行し、契約の result schema を通す方針。読者: 検査群を変更する人。R1・R3。固定件数 `54` を落としても「全コマンド」という範囲と検査の目的は保持される。
- #24 [apps/renderer/src/features/today/WeeklyBudget.tsx:54](../../../apps/renderer/src/features/today/WeeklyBudget.tsx:54) — 未入力の状態で計算結果を表示しない理由。読者: プレビューの例外処理を変更する人。R5。例外を表示せず受ける意図を保持する。
- 修復 [apps/desktop/src/app/lifecycle.ts:25](../../../apps/desktop/src/app/lifecycle.ts:25) — 取込の呼出側は `useHeartbeat=false` とし、置換前データの生存記録を使わない。読者: 取込/復旧の呼出者。R2・R4。別のデータの時刻が混ざる罠と正しい利用法をその使用箇所に残す。

### この変更で不成立になった既存コメント（0 件）

変更ファイルの周辺既存コメントを読み、保存方法、Port 境界、日境界、停止/除外、Task 削除後の記録、下書きの用途等の記述を確認した。この差分によって新たに不成立になったコメントは見つからなかった。原因となった実装差分の取り消しに伴い base を逐語復元すべきコメントもない。

判定: **PASS**（修正・削る・移す・不成立はいずれも 0 件）。

## 最終追加差分の追補審査

**判定: PASS。前回以降の追加・変更コメントは 0 件、修正指摘も 0 件。** 同じ適用規約 R1〜R5 と意味保存原則を用い、作業差分全体・新規ソース/テストを再走査した。stage 済み差分はなかった。文字列中の glob はコメントに数えない。

- [packages/core/src/task-control.ts](../../../packages/core/src/task-control.ts): iterative DFS への後続変更に追加・変更コメントはない。
- [apps/renderer/src/features/task-control/task-title-draft.ts](../../../apps/renderer/src/features/task-control/task-title-draft.ts)・[apps/renderer/tests/task-title-draft.test.ts](../../../apps/renderer/tests/task-title-draft.test.ts): 新規ソース/テストにコメント・JSDoc・docstring はない。
- [scripts/e2e.mjs:1](../../../scripts/e2e.mjs:1): graceful quit の後続変更に追加・変更コメントはない。既存の「公開済みの window.whitebox だけを使う」「本体処理を書き写さない」という使用境界のコメントも保持されている。R1・R3。
- 未審査の追加コメントはなく、[apps/desktop/src/app/lifecycle.ts:26](../../../apps/desktop/src/app/lifecycle.ts:26) の `useHeartbeat=false` の説明は前回審査済みの同一文言だった。意味と取込側の利用上の注意は引き続き保持する。R2・R4。

先行記録の行番号は初回審査時点。後続の行挿入により、現在の復旧閾値は [lifecycle.ts:12](../../../apps/desktop/src/app/lifecycle.ts:12)、復旧契約は [lifecycle.ts:15](../../../apps/desktop/src/app/lifecycle.ts:15)、満了契約は [lifecycle.ts:90](../../../apps/desktop/src/app/lifecycle.ts:90)、Task patch の注意は [TaskDetail.tsx:70](../../../apps/renderer/src/features/board/TaskDetail.tsx:70) にある。

削る 0 件 / 修正する 0 件 / 移す 0 件 / この追加差分で不成立になった既存コメント 0 件。ロジック・型・テストの充足は審査していない。

## 終了診断・遅延 close までの追補審査

**判定: PASS。前回 PASS 以降の追加・変更コメントは 0 件、既存コメントの不成立も 0 件。**

### 適用規約

- R1〜R5 は現行 [CLAUDE.local.md](../../../CLAUDE.local.md)・[architecture.md](../../architecture.md)・[decisions.md](../../decisions.md)・[verification.md](../../verification.md) を再読して適用。Port 境界の現行出典は [architecture.md:113](../../architecture.md:113)。対象 root・変更パス上の `AGENTS.md` と `.agents/skills/*/SKILL.md` は再探索でも存在しなかった。
- R6 — [CLAUDE.local.md:25](../../../CLAUDE.local.md:25): 呼出元を閉じる際は `closeLater()` で返答を先に届ける。遅延 close 周辺の利用上の制約を保持する。
- R7 — [verification.md:49](../../verification.md:49)・[verification.md:51](../../verification.md:51)・[verification.md:71](../../verification.md:71): 検証では公開 bridge を使い、本体を複製しない。自然終了と所有 PID を観測し、別アプリのデバッグポートへ接続しない。検証スクリプトに残る使用境界と罠の説明を保持する。
- R8 — [decisions.md:226](../../decisions.md:226)・[decisions.md:228](../../decisions.md:228): 入力保存の応答を先に待ち、終了準備・終了中の窓・サービス・復旧との競合を扱う。既存コメントを現行の終了契約と照合する。

### コメント審査: 追加/変更 0 件

`779df6e5` から `3a428d4f1c66642b251f89989f38e8697de0cdea` までのコミット済み差分と、その HEAD からの未コミット差分を合算して再走査した。コミット済みの新規ソース/テストも含む。stage 済み差分と未追跡のソース/テストはなかった。差分のコメントは前回審査済みの [lifecycle.ts:26](../../../apps/desktop/src/app/lifecycle.ts:26) の 1 単位だけで、新たな審査単位は 0 件。URL と glob の文字列、契約本文・文書本文はコメントに数えない。

- [TaskControlEditor.tsx:16](../../../apps/renderer/src/features/board/TaskControlEditor.tsx:16) の Observer、[e2e-quit.mjs:47](../../../scripts/e2e-quit.mjs:47) の PID・CDP、[main.ts:100](../../../apps/desktop/src/presentation/main.ts:100)・[windows.ts:277](../../../apps/desktop/src/infra/windows.ts:277) の遅延 close に追加・変更コメントはない。
- [quit-observer.mjs:23](../../../scripts/quit-observer.mjs:23) の flush・renderer・native dialog の診断追記と、[e2e-task-priority.mjs:12](../../../scripts/e2e-task-priority.mjs:12) の診断オプション・所有プロセス観測にも追加・変更コメントはない。担当者の編集完了後に再走査した。
- 既審査の [lifecycle.ts:26](../../../apps/desktop/src/app/lifecycle.ts:26) は同一文言。取込では `useHeartbeat=false` を指定し、置換前データの生存記録を使わないという利用上の注意を引き続き保持する。R2・R4。

### 削る（0 件）

なし。

### 修正する（0 件）

なし。

### 移す（0 件）

なし。

### 残す（0 件）

新たなコメントなし。既審査の意味保存判定は上記のとおり維持する。

### この変更で不成立になった既存コメント（0 件）

変更ファイルの既存コメントも再読した。特に [main.ts:191](../../../apps/desktop/src/presentation/main.ts:191) の窓を閉じても計測を続ける前提、[e2e.mjs:5](../../../scripts/e2e.mjs:5) の公開 bridge と二重実装禁止、[e2e.mjs:165](../../../scripts/e2e.mjs:165) の profile 隔離の説明は保持され、この追加差分で不成立になっていない。R1・R7。原因差分の取り消しによって base を逐語復元すべきコメントも見つからなかった。

判定: **PASS**（修正・削る・移す・不成立はいずれも 0 件）。ロジック・型・テストの充足は審査していない。

## ソース凍結コミットの追補審査

**判定: PASS。追加・変更コメント 0 件、既存コメントの不成立 0 件。** ソース・テスト・QA スクリプトの審査済み到達点は `97e583d59ac39e43d3570fb9173a3ecf77c1bec7`。

### 適用規約

- R1〜R8 を継続適用し、現行 [CLAUDE.local.md](../../../CLAUDE.local.md) と正式文書の追加差分を確認した。root・変更パス上の `AGENTS.md` と path-scoped Skill は今回も存在しない。
- R9 — [architecture.md:121](../../architecture.md:121)・[architecture.md:133](../../architecture.md:133): 一時ファイルからの置換、元データの保持、生存記録を使う復旧の境界。Store 周辺コメントの説明をこの保存・復旧契約と照合する。
- R10 — [decisions.md:218](../../decisions.md:218): 保存を待ち、失敗時は入力と画面を保持する。待ち情報の編集に関する説明をこの契約と照合する。

### コメント審査: 追加/変更 0 件

前回のコミット基点 `3a428d4f1c66642b251f89989f38e8697de0cdea` から凍結コミット `97e583d59ac39e43d3570fb9173a3ecf77c1bec7` までのソース・テスト・QA スクリプトの全差分を再走査した。前回未コミットで審査した部分も含む比較範囲で、追加・変更されたコメント行は 0 行。今回コミットされた新規ソース/テストも対象に含む。文字列中の URL、UI 文言、文書本文はコメントに数えない。

- [store.ts](../../../apps/desktop/src/infra/store.ts) と [store-save.test.ts](../../../apps/desktop/tests/store-save.test.ts): snapshot の `wx` / `COPYFILE_EXCL`、生存記録の置換、日次 backup 保持範囲の追加差分にコメントはない。[store.ts:200](../../../apps/desktop/src/infra/store.ts:200) の復旧用途・時刻の近似という説明と、[store.ts:207](../../../apps/desktop/src/infra/store.ts:207) の単発記録失敗の扱いは同一文言で保持され、今回の変更で不成立になっていない。R9。
- [windows.ts](../../../apps/desktop/src/infra/windows.ts) の main/current の load fallback、[task-control-draft.ts](../../../apps/renderer/src/features/board/task-control-draft.ts)・[task-control-draft.test.ts](../../../apps/renderer/tests/task-control-draft.test.ts)・[TaskControlEditor.tsx](../../../apps/renderer/src/features/board/TaskControlEditor.tsx) の入力保持に追加・変更コメントはない。周辺の既存コメントにも新たな不成立はない。R1・R8・R10。
- [e2e-task-priority.mjs](../../../scripts/e2e-task-priority.mjs)・[quit-observer.mjs](../../../scripts/quit-observer.mjs) の native visibility 等の QA 差分にも追加・変更コメントはない。R7。

### 削る（0 件）

なし。

### 修正する（0 件）

なし。

### 移す（0 件）

なし。

### 残す（0 件）

新たなコメントなし。既存コメントは上記の意味を保持する。

### この変更で不成立になった既存コメント（0 件）

なし。原因差分の取り消しにより base の文言へ逐語復元すべきコメントもない。

この判定は凍結コミットのソース・テスト・QA スクリプトに対するコメント審査。現在未コミットの正式文書・レビュー本文と、後続のドキュメント最終化は別の差分であり、本判定の対象へ含めていない。正式文書は適用規約の確認に使用した。

判定: **PASS**（修正・削る・移す・不成立はいずれも 0 件）。ロジック・型・テストの充足は審査していない。

## 終了時の生存記録保存境界の追補審査

**判定: PASS。追加・変更コメント 0 件、既存コメントの不成立 0 件。** 直前の凍結コミットから追加された `requireSuccess` の差分を審査した。

### 適用規約

- [CLAUDE.local.md:18](../../../CLAUDE.local.md:18)・[architecture.md:113](../../architecture.md:113): 状態と復旧の真実をメインプロセスに置き、app 層は Port に依存する。既存の用途・境界説明を保持する。
- [architecture.md:131](../../architecture.md:131): 周期的な生存記録は例外を外へ投げず、最後に成功した記録を復旧に使う。この通常経路の前提を保持する。
- [decisions.md:228](../../decisions.md:228): 終了前に生存記録と DB を保存し、失敗時は終了を取り消す。周期記録の扱いと混同しない。
- root と変更パス上の `AGENTS.md`、path-scoped Skill は再探索でも存在しない。上記の現行正式文書と意味保存原則を適用した。

### コメント審査: 追加/変更 0 件

比較範囲は `97e583d59ac39e43d3570fb9173a3ecf77c1bec7` から審査時の作業ツリーにある次の 4 ファイル。追加・変更コメント行は 0 行。後続の文書最終化はこのソース差分の範囲に含めない。

| ファイル | 審査時の Git blob |
| --- | --- |
| [ports.ts](../../../apps/desktop/src/app/ports.ts) | `89592ecffe54504771a814c43dd6cd42ff9ab448` |
| [lifecycle.ts](../../../apps/desktop/src/app/lifecycle.ts) | `21df4c0b15d050b39478f3d2e2fa5a449bf302d1` |
| [store.ts](../../../apps/desktop/src/infra/store.ts) | `bd00bbd0d40a0e7888b7509ce2447d265404cd30` |
| [store-save.test.ts](../../../apps/desktop/tests/store-save.test.ts) | `a82ee2e1c2a36fde1636c761a9b3e4f6d788e580` |

### 削る（0 件）

なし。

### 修正する（0 件）

なし。

### 移す（0 件）

なし。

### 残す（0 件）

新たなコメントなし。既存の [ports.ts:12](../../../apps/desktop/src/app/ports.ts:12)・[store.ts:200](../../../apps/desktop/src/infra/store.ts:200) の復旧用途と時刻の近似という意味は変更後も保持される。

### この変更で不成立になった既存コメント（0 件）

[store.ts:208](../../../apps/desktop/src/infra/store.ts:208) の「実行中の記録が 1 回書けなくても致命ではない」は、直前の `requireSuccess` 時の再送出を通過した通常経路の説明として残る。終了時の再送出を握りつぶす保証はコメントに含まれず、周期記録の前提を失っていない。周辺の復旧・Port のコメントにも、この追加差分による不成立はない。原因差分の取り消しにより base を逐語復元すべきコメントもない。

判定: **PASS**（修正・削る・移す・不成立はいずれも 0 件）。ロジック・型・テストの充足は審査していない。

## 最終ソース・QA 到達点の追補審査

**判定: PASS。追加・変更コメント 0 件、既存コメントの不成立 0 件。** ソースの到達点は `125026f7088487a429170f6276786a13f0e40c4c`、QA の到達点は `130016c83ce352598283ca8378362dad3c1821b0`。

### 適用規約

- [verification.md:49](../../verification.md:49)・[verification.md:51](../../verification.md:51): 公開 bridge を使い、本体を複製しない。終了応答と自然終了の観測を混同しない。検証器の使用境界・罠を説明する既存コメントを保持する。
- [CLAUDE.local.md:25](../../../CLAUDE.local.md:25)・[verification.md:83](../../verification.md:83): 呼出元の窓を閉じるコマンドは返事と実行コンテキストの消失が競合する。自己終了に関する既存の注意を保持する。
- この checkout で確認済みの現行規約と意味保存原則を継続適用した。該当する `AGENTS.md`・path-scoped Skill は存在しない。

### コメント審査: 追加/変更 0 件

今回の比較範囲は `125026f7088487a429170f6276786a13f0e40c4c` → `130016c83ce352598283ca8378362dad3c1821b0` の [e2e-notes.mjs](../../../scripts/e2e-notes.mjs)・[e2e.mjs](../../../scripts/e2e.mjs) の全差分。前者は待機の 2 行追加、後者は CDP と終了観測の 15 行追加・3 行削除で、追加・変更コメント行は 0 行。native `finally` 周辺も対象に含む。

`apps/`・`packages/` にはこの比較範囲の差分がない。また、直前に審査した終了保存境界の 4 ファイルは、`125026f7` の Git blob と前節の記録が全て一致するため、ソースの審査到達点を同コミットへ確定した。文書最終化と inventory/helper の本文は、このソース・QA コメント審査の範囲に含めない。

### 削る（0 件）

なし。

### 修正する（0 件）

なし。

### 移す（0 件）

なし。

### 残す（0 件）

新たなコメントなし。既存の [e2e.mjs:5](../../../scripts/e2e.mjs:5) の公開 bridge・二重実装禁止、[e2e.mjs:156](../../../scripts/e2e.mjs:156) の暫定コンテキストに接続する罠、自己終了コマンドでは返事を待てないという説明は、同一文言で保持する。

### この変更で不成立になった既存コメント（0 件）

なし。`e2e-notes.mjs` に既存コメントはない。`e2e.mjs` の周辺既存コメントも今回の差分で不成立になっていない。原因差分の取り消しにより base を逐語復元すべきコメントもない。

判定: **PASS**（修正・削る・移す・不成立はいずれも 0 件）。ロジック・型・テストの充足は審査していない。

## 提出用監査スクリプトの最終確認

コメント専任レビュアーが、提出対象の監査スクリプトと `complete-review-text.py` の計23ファイルを確認した。コメント・docstringは0件、修正が必要な指摘は0件。説明文字列とMarkdown本文はこの判定の対象外。PR本文は文脈ゼロの読者で3回検算し、最後にTodayの役割を明記した。
