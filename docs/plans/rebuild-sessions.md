# 再編タスク分解書 — セッション単位（S1〜S7）

- 版: v1（2026-08-21 起草）
- 正本: このファイル。上位文書は [rebuild-plan.md](../rebuild-plan.md)（Phase 0–5 の抽象計画）
- 作り方: ai-org-os 全体計画書 §4.7 の標準工程を自分に適用（受領・Unknown列挙・調査・Decision Record・実行）。分解は §4.3（1 担当が安定して扱える大きさ＝**1 セッションで完了できる単位**）、各タスクは §4.5 Task Contract の骨格（目的/成果物/完了条件）、判断は §4.10 Decision Record 形式
- 状態: **実行中**（まひろ承認 2026-08-21「タスク分解して一気に進めて」）

---

## 0. 受領と Unknown

**受領**: 目的 = [rebuild-plan.md](../rebuild-plan.md) の Phase 0–5 を、1 セッションで確実にこなせる粒度へ分解し、順に完遂する。成果物 = 本書 + 各セッションの実装。完了条件 = §3 の全セッションが合格ゲートを通過し、rebuild-plan.md の進捗表が全部「完了」になること。

**分かっていること**: 移行元の全構造（2026-08-20 調査済み。TS/TSX 4,361 行・コマンド 33 個・テスト 12 件・e2e 19 チェック）。Quri の実物構造（オニオン・contracts・learning-app・Storybook・GIT_WORKFLOW）。

**分かっていないこと（各セッションの gate で実測して解消する）**:

- U1: pnpm の junction 経由で `node_modules/electron/dist/electron.exe`（e2e が参照）が解決されるか → S1 で実測
- U2: `pack.mjs` の配布物組み立てが pnpm のシンボリックリンク node_modules と両立するか → S7 で実測。壊れる場合は必要物のコピー方式へ変更
- U3: Storybook 9 系が Vite 6 + React 19 で素直に動くか → S6 で実測

**置いている仮定**: zod・eslint 等の確立した汎用ライブラリの追加は decisions 002 以来の「環境に何も要求しない」軸に反しない（開発時依存であり、配布物には入らない）。

## 1. Decision Record（本分解での設計判断）

| # | 問題 | 採用 | 理由と捨てた候補 | 再検討条件 |
|---|---|---|---|---|
| D-01 | pnpm のビルドスクリプト許可 | `allowBuilds: {electron: true, esbuild: true}` を pnpm-workspace.yaml に明示（※S1 実測: pnpm 11 は旧設定名 onlyBuiltDependencies を無視する。electron はバイナリ取得、esbuild は vite が使う実行バイナリの取得に必須） | pnpm は既定で postinstall を止める。全許可は不要物まで走る | 依存追加でビルドが必要になったとき |
| D-02 | データ型の正とスキーマの関係 | 型の正は `packages/core` の interface。contracts の zod は `z.ZodType<T>` 注釈で結ぶ | スキーマと型のドリフトをコンパイラが検出できる。zod から型を生やす逆方向は core の独立性（依存ゼロ）を壊す | — |
| D-03 | IPC チャネル | 既存 `whitebox:cmd` / `state` / `tick` を維持。コマンド名も 33 個そのまま | preload（壊れやすい CJS 境界）を触らない。e2e が回帰網としてそのまま効く | 契約の破壊的変更が必要になったとき |
| D-04 | workspace パッケージのビルド | packages/* は各自 tsc で dist を吐き、exports で公開。アプリは dist を参照 | Electron メインは node16 解決の実行時 require があるため TS ソース直参照は不可。Vite 側も同じ経路に揃えて二重解決を避ける | ビルド待ちが開発の摩擦になったとき（watch 併用で緩和） |
| D-05 | mutations の純関数化 | Session 系と同じ「新しい値を返す」形へ統一 | ドメイン層の方針が 2 つに割れている現状（Session=純関数 / Task=破壊的変更）を解消。データ規模（個人数年で数千件）で clone コストは無視できる | — |
| D-06 | CSS 分割の方針 | クラス名・セレクタは不変のまま、ファイルだけ feature 単位に割る | S5 の完了条件が「スクショ画素一致」なので、見た目に影響する変更を構造移動と混ぜない | 再編完了後のデザイン変更時 |
| D-07 | import 境界の強制 | eslint（flat config）の import 制限ルールで renderer → contracts/core のみを機械強制 | 「FE と BE がちゃんと分かれている」の実体（decisions 013）。dependency-cruiser は道具が 1 つ増えるだけ | 違反の検出漏れが見つかったとき |
| D-08 | git 運用 | 1 セッション ≒ 1 PR。コミットはタスク単位。push / PR 作成はまひろに確認してから | LL-140（巨大 PR 化）の再発防止。外向き操作は確認の原則 | — |

## 2. セッション分解の原則

- **1 セッション = 合格ゲートまで到達して終わる**。途中で切れるときは `tasks/<日付>_S<N>_handover.md` を書く
- 全セッション共通ゲート: `pnpm typecheck && pnpm test && node scripts/e2e.mjs` 全緑（S1 以降）
- 実装は TDD（tdd-implement 準拠）: 挙動を持つコードはテスト先行。移動だけのタスクは既存テスト＋e2e が回帰網
- 各セッションの終わりに [rebuild-plan.md](../rebuild-plan.md) の進捗表と本書の状態列を更新する

## 3. セッションとタスク

### S1 — Phase 0: 規約の移植と足場（このセッション）

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T01 | pnpm 切替（D-01） | packageManager 指定・pnpm-workspace.yaml・pnpm-lock.yaml（package-lock.json 削除） | `pnpm install` 後、`pnpm typecheck && pnpm test` 緑 |
| T02 | e2e の pnpm 動作確認（U1 解消） | — | `node scripts/e2e.mjs` 19 チェック全 PASS |
| T03 | GIT_WORKFLOW.md 移植 | GIT_WORKFLOW.md（quri 版を white-box 用に適合） | ファイル存在。quri 固有節が white-box の規則（ブランチ命名・ゲート・PR 単位）に置換済み |
| T04 | stories / tasks の運用開始 | docs/stories/README.md・tasks/README.md（書式の定義） | 両ファイル存在。書式（命名・必須項目）が書かれている |
| T05 | 先行バグ修正: Welcome の「昨日」キー | WelcomeOverlay.tsx の手組み日付を `dayKey(now − 1日)` に置換 | `grep padStart src/views/` が WelcomeOverlay で 0 件。typecheck / test 緑 |

**S1 合格ゲート**: 上記全部 + コミット済み。

### S2 — Phase 1: packages/core + packages/contracts（契約ファースト）

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T06 | packages/core 新設（D-04） | shared/types.ts + engine.ts の移設・独自 tsc ビルド・exports | core 単体で `pnpm --filter core build && test` 緑。旧 shared/ が消え、全 import が @white-box/core を向く |
| T07 | packages/contracts 骨格 + zod 導入（D-02） | contracts パッケージ・Task/Session/AppState 等のスキーマ（z.ZodType<T> で core と結線） | スキーマの型注釈が core の interface と一致しないと tsc が落ちることを、1 フィールド変えて実証→戻す |
| T08 | 全 33 コマンドの契約定義 | コマンド名 → args/result スキーマの対応表 1 ファイル | 33 コマンド全部に args・result スキーマが存在（テストで件数を固定） |
| T09 | レンダラ bridge の型付き化 | bridge.ts: `invoke('session:start', {...})` が契約から型推論される形 | `call('文字列', any)` の素通し呼び出しが src/ から 0 件（grep）。引数名を 1 つ変えると typecheck が落ちることを実証→戻す |
| T10 | メイン側受け口の契約検証 | ipcMain ハンドラで args を契約 validate してから run() へ | 不正 args が {ok:false} で拒否されるテスト。`as any` 3 箇所が 0 件 |
| T11 | 契約 round-trip テスト | contracts のテスト | 全コマンドの代表 args が parse を通り、壊れた args が落ちる |
| T12 | ゲート実行と進捗更新 | — | 共通ゲート全緑・進捗表更新・コミット |

### S3 — Phase 2: バックエンドのオニオン化（apps/desktop）

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T13 | apps/desktop 骨格と electron/ の移設 | src/{domain,app,infra,presentation} 配置（中身はまず現行のまま層に振り分け） | ビルド・起動・e2e 緑 |
| T14 | domain: task-ops 純関数化（D-05） | mutations.ts → domain/task-ops.ts（新しい値を返す形） | task-ops の単体テスト新設（create/update/move/delete/子孫削除） |
| T15 | app: ユースケース抽出（Port 注入） | run() の switch 33 case → app/ の関数群 + StorePort/WindowPort/ClockPort/TickerPort | 全ユースケースが fake Port で Electron 起動なしにテスト可能。start→pause→switch→end の系列テストが通る |
| T16 | presentation: IPC ルータ | 契約 validate → app 呼び出しだけの薄いルータ | main.ts が組み立てと起動のみ（±120 行以内） |
| T17 | 復旧・電源・トレイの infra 化 | infra/{store,windows,tray,shortcuts,power} | e2e 19 チェック維持 |
| T18 | ユースケース網羅テスト | apps/desktop/tests/ | 33 コマンド全部に少なくとも 1 テスト（件数固定テスト） |
| T19 | ゲート実行と進捗更新 | — | 共通ゲート全緑・コミット |

### S4 — Phase 3 前半: renderer の構造移動と重複統合

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T20 | apps/renderer へ移設・features/ 分割 | src/ → apps/renderer/src/{components,features,pages,stores,lib} | ビルド・起動・e2e 緑 |
| T21 | components/ui の 1 ファイル 1 部品化 | primitives.tsx（9 部品）の分解 | 各部品が単独ファイル。import が全て新パスへ |
| T22 | 表示ロジック重複の統合 | 「（削除されたタスク）」7 箇所・符号付き残り時間 3 箇所・Ctrl 表記 3 箇所 → lib/ の関数へ | 各リテラル・パターンの grep が定義 1 箇所のみになる |
| T23 | selectors のテスト新設 | lib/selectors のテスト | stalledTasks・candidateTasks・columnRoots 等の主要関数にテスト |
| T24 | ゲート実行と進捗更新 | — | 共通ゲート全緑・コミット |

### S5 — Phase 3 後半: CSS 分割・境界強制・見た目一致の実証

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T25 | 移行前スクショの基準撮り | shoot.cjs で 6 窓の PNG（基準） | 6 枚存在（S4 開始前のコードで撮る。撮り忘れていたら S4 直前コミットから撮る） |
| T26 | app.css の feature 分割（D-06） | styles/ を feature 単位へ | セレクタ差分ゼロ（分割前後で全ルールの集合が一致することを機械比較） |
| T27 | import 境界の eslint 強制（D-07） | eslint 設定 | renderer から contracts/core 以外の workspace import を書くと lint が落ちる（違反を 1 個書いて実証→消す） |
| T28 | スクショ比較と進捗更新 | 移行後 PNG 6 枚 | 基準との目視比較で差異なし（画素完全一致が理想だがフォントレンダリング差は許容し、差異は列挙して判断）。共通ゲート全緑・コミット |

### S6 — Phase 4: Storybook（U3 解消）

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T29 | Storybook 導入 | apps/renderer の Storybook 設定 | `pnpm storybook` が起動し 1 個の story が表示される |
| T30 | ui 部品の story 網羅 | components/ui 全部品 + 主要画面（HUD・満了・開始）の story | 部品ごとに主要状態の story が存在（状態を渡すだけ。機構を写さない） |
| T31 | ゲート実行と進捗更新 | — | 共通ゲート全緑・コミット |

### S7 — Phase 5: 配布と仕上げ（U2 解消）

| ID | タスク | 成果物 | 完了条件（機械判定） |
|---|---|---|---|
| T32 | scripts の新構造対応 | pack.mjs / e2e.mjs / shoot.cjs / make-icon.mjs | `pnpm pack:app` で release/ が組み上がる |
| T33 | 実 exe の e2e | — | `WHITEBOX_EXE` 経路で e2e 19 チェック全 PASS |
| T34 | docs 同期 | architecture.md 全面改訂・progress.md・CLAUDE.local.md「壊してはいけないもの」更新 | 文書内の全パス・全記述が新構造と一致（リンク切れ 0） |
| T35 | 最終ゲートと完了宣言 | rebuild-plan.md 進捗表 | 全 Phase「完了」。まひろへデモ報告 |

## 4. 全体の合格ゲート（まひろ判定）

1. 全セッションの共通ゲートが最終構造で緑（typecheck / test / e2e 19 チェック / 実 exe e2e）
2. 契約: 文字列 + any の IPC が 0 件。契約を 1 箇所壊すと typecheck が落ちる実演
3. 境界: renderer から desktop 内部を import すると lint が落ちる実演
4. ユースケース: Electron 起動なしで全 33 コマンドのテストが回る実演
5. 見た目: 6 窓のスクショが移行前と一致
6. rebuild-plan.md・architecture.md がコードと一致

## 5. リスクと手当て

| リスク | 手当て |
|---|---|
| 巨大 PR 化（LL-140 の再発） | 1 セッション = 1 PR、各セッション末に必ずコミットとゲート。次セッションは前セッションのマージ済み状態から |
| pnpm × Electron 配布の非互換（U2） | S7 で実測。最悪でも pack.mjs を「必要物の実体コピー」方式へ書き換える逃げ道がある（asar 不使用なので構造は単純） |
| 移動と変更の混在で回帰の切り分け不能 | 「移動だけのコミット」と「変更のコミット」を分ける。CSS はセレクタ集合の機械比較（T26） |
| セッション途中の断絶 | handover 書式を tasks/ に固定（T04）。本書の状態列が生きた文書 |

## 6. 状態

| セッション | 状態 |
|---|---|
| S1 | **完了**（2026-08-21。T01〜T05 全達成。コミット 5365145 / d3866de / 1ada431） |
| S2 | 実行中（2026-08-21） |
| S3〜S7 | 未着手 |
