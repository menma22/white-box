# 実装の構成

どこに何があり、なぜそう分けたか。仕様は [product-spec.md](product-spec.md)、判断の記録は [decisions.md](decisions.md)（特に契約・monorepo・Storybook 化は 012〜016）。

pnpm monorepo（Quri と同じ形）に再編済み（[rebuild-plan.md](rebuild-plan.md)）。

---

## 全体像

```
apps/
  desktop/      バックエンド = Electron メインプロセス（オニオン構成）
    src/domain/       純関数のみ。外部を知らない（セッション・タスクの状態遷移）
    src/app/          ユースケース。IPC コマンド 1 つ = 関数 1 つ。Port を注入されて動く
    src/infra/        実装詳細。保存・ウィンドウ・トレイ・ショートカット・1秒ticker
    src/presentation/ IPC ルータ（契約で検証してから app を呼ぶだけ）+ 起動の組み立て + preload
    tests/            ユースケースと domain 純関数の単体テスト（Electron 起動なしで回る）
  renderer/     フロントエンド = React（表示と入力だけ）
    src/components/ui/  画面をまたぐ部品（1 ファイル 1 部品）
    src/features/        機能ごとの画面部品（board / today / history / settings / welcome / sessions）
    src/pages/            窓 1 つ = ファイル 1 つ（main / start / hud / expire / review / current）
    src/stores/           zustand。メインから配られた状態を持つだけ（計算はしない）
    src/lib/              bridge（型付き IPC 呼び出し）・selectors（表示用に導く関数）・format
    src/styles/            tokens → components → screens/*.css → notion.css の順で読む
    src/dev/               ブラウザ単体プレビュー用の固定データ（fixture.ts）
    src/stories/           Storybook（ui / screen）
    tests/                 selectors（状態から表示用の値を導く）と format の単体テスト
packages/
  core/         両側が使う純粋な時間計算と型（依存ゼロ）。@white-box/core
  contracts/    全 IPC コマンドの zod スキーマ（唯一の合意点）。@white-box/contracts
              （どちらも tests/ を持つ）
scripts/      アイコン生成・デモデータ・撮影台・通し確認（e2e）・配布物の組み立て（pack）
docs/         この文書群
assets/       アイコン（PNG / ICO）。scripts/make-icon.mjs が生成する
```

テストは必ず所属パッケージの `tests/` に置く。`tsconfig.test.json` が `apps/*/tests` と `packages/*/tests` だけを型検査するので、外に置くと型検査を素通りする（vitest は型を見ずに実行する）。
テストの相対 import は `.js` 拡張子で書く。`tsconfig.test.json` は NodeNext の規則を使うため、拡張子を省くと Vitest が成功しても型検査は失敗する。

### 依存の向き（機械で強制する）

```
renderer  →  contracts, core        # これ以外の import は eslint で落ちる
desktop   →  contracts, core
contracts →  core, zod
core      →  （依存なし）
```

レンダラから見える世界は `@white-box/contracts`（+ 表示用の `@white-box/core`）だけ。バックエンドの内部（`apps/desktop` 配下）へ直接届く import は禁止で、境界は `eslint.config.mjs` の `no-restricted-imports` が機械強制する（renderer のソースだけに掛かる。品質系ルールの一般適用はスコープ外）。違反すると `pnpm lint` が落ちる。

## 契約（packages/contracts）— FE と BE の唯一の合意点

全 IPC コマンドは `packages/contracts/src/commands.ts` の `COMMANDS` に **コマンド名 → 引数スキーマ / 返り値スキーマ** として定義されている。振る舞いを変える前に、まずここを変える。

- **型の正は `packages/core` の interface。** `packages/contracts/src/schemas.ts` は zod スキーマの推論型と core の型を `Exact` 型で照合し、ずれると `tsc` が落ちる（decisions 002 系の一方向ルール。zod から core の型を生やす逆方向は core の依存ゼロを壊すので採らない）
- レンダラの `apps/renderer/src/lib/bridge.ts` は `invoke<N extends CommandName>(name, args)` の形で、コマンド名・引数・返り値が契約から型推論される。文字列 + `any` の素通し呼び出しは無い
- メイン側は `apps/desktop/src/presentation/ipc.ts` が `isCommand` / `parseArgs` で検証してから `app/handlers.ts` の `dispatch` へ渡す。壊れた引数・未知のコマンドは `{ok:false, error}` で拒否される（`scripts/e2e.mjs` が実 IPC 越しにこれを確認している）
- なぜ OpenAPI ではなく zod の TS スキーマか、なぜ IPC チャンネル名を変えなかったかは decisions 013 / [plans/rebuild-sessions.md](plans/rebuild-sessions.md) D-02・D-03 を参照

## なぜメインプロセスがセッションを持つのか

**ウィンドウを全部閉じてもタイマーが動き続ける必要がある**（仕様 §16）。レンダラにタイマーを置くと、ウィンドウを閉じた瞬間に計測が止まる。

だからメインプロセスが唯一の真実を持ち、レンダラは表示と入力に徹する。

```
レンダラ  ──[ whitebox:cmd ]──▶  メインプロセス（apps/desktop/src/presentation/ipc.ts）
   │                                  │  契約で検証 → app/handlers.ts のユースケースへ
   │                                  │  状態を変える・ファイルへ保存
   ◀──[ whitebox:state ]──────────────┘  変わった状態を全ウィンドウへ配る（AppState 全体）
   ◀──[ whitebox:tick  ]──────────────┘  毎秒の軽い更新（経過・残り。LiveTick）だけ
```

- **状態の配布はミューテーションのときだけ。** 毎秒の更新で状態全体を送ると無駄が大きいので、経過時間だけを別の軽い経路（tick）で流す
- **レンダラからメインへ触れるのは `window.whitebox` だけ。** `apps/desktop/src/presentation/preload.cjs` が公開している関数（`call` / `onState` / `onTick` / `windowKind`）以外は届かない

## ウィンドウ

1つのレンダラを URL の hash（`#main`, `#start`, `#hud`, `#expire`, `#review`, `#current`）で使い分ける。生成・登録は `apps/desktop/src/infra/windows.ts` に集約し、対応するページは `apps/renderer/src/pages/` に1ファイルずつ置く。

| kind | 役割 | 特徴 |
| --- | --- | --- |
| `main` | 今日 / ボード / 記録 / 設定 / 道標 / 問題・改善 | 通常ウィンドウ |
| `start` | 何をやるか選んで開始 | 最前面・枠なし・キーボード完結 |
| `hud` | 実行中のミニカード | 最前面・透過・クリック素通り。経過と残り（休憩中は休憩の時間）を表示し、設定で非表示にできる |
| `expire` | 予定時間に到達 | 最前面（全画面アプリの上にも出す） |
| `review` | 終了レビュー | 通常ウィンドウ |
| `current` | 現在の仕事 | 最前面 |

最前面は `setAlwaysOnTop(true, 'screen-saver')` で出す。通常の alwaysOnTop では全画面アプリの下に隠れる。

## 時間の計算（packages/core）

**実作業時間 = 経過時間 − 一時停止の重なり。** この計算は `packages/core/src/engine.ts` の純関数だけが行う。副作用を持たず、`@white-box/core` の依存はゼロ（decisions 002 系）なので、そのまま単体テストで固定できる。

```
focusMs(session, now)      セッション全体の実作業時間
remainingMs(...)           残り。満了後はマイナスになり超過を表す
dayKey(ts, dayStartHour)   現地時刻の一日の境目を考慮した日付キー
```

区間（Task Segment）ごとの計算で「その区間に重なる停止だけを引く」ことが要点。セッション全体の停止をどの区間からも引くと、合計が合わなくなる。データ型（`Task` / `Session` / `AppState` など）の正も同じく `packages/core/src/types.ts` にある。

日付の境目は現地の暦と `dayStartTs` で比較する。固定ミリ秒の減算で日付を決めると夏時間の切替日にずれる。Historyの日別表示は選択月だけを列挙し、全期間の合計は月別表示とは独立して算出する。長い有効な記録を削ったり、日数を上限で切り捨てたりしない。

## 状態遷移（apps/desktop/src/domain）

`domain/session-ops.ts` が、開始・一時停止・休憩・再開・タスク切替・延長・満了・終了・進捗記録を扱う。`domain/task-ops.ts` が Project / Task の作成・更新・移動・削除を扱う。**すべて「新しい値を返す」純関数**で統一されている（decisions D-05。以前は Session だけ純関数で Task は破壊的変更という割れがあったが、再編で解消した）。除外の申告では終了済みセッションの開始・終了時刻を動かさず、一時停止区間を追加する。既存の手動時刻編集は開始・終了時刻を変更でき、タスク別実作業の集計は変更後のセッション範囲で行う。

## app 層 — ユースケースと Port（apps/desktop/src/app）

IPC コマンド 1 つにつき `app/handlers.ts` の関数 1 つが対応する。app 層は `electron` を直接 import せず、`app/ports.ts` の Port（`StorePort` / `WindowPort` / `TickerPort` / `SystemPort` / `DataIOPort` をまとめた `Ctx`）だけに依存する。実装は `infra/` と `presentation/` が注入し、テストは偽物の Port を渡す（Electron 起動なしで全ユースケースを検証できる）。

`app/state.ts` が `Database` + 実行時状態から配信用の `AppState` / `LiveTick` を組み立て、`app/lifecycle.ts` が起動時の復旧判定（`restoreOpenSession`）と満了チェック（`checkExpire`）を担う。

## 保存（apps/desktop/src/infra/store.ts）

JSON 1ファイル + 日次バックアップ。

- 書き込みは**一時ファイルを作ってから置き換える**。置換失敗で既存本体を直接上書きしない。停電時のOS・ディスクによる耐久性まで保証する方式ではない
- 配布版の標準保存先は `%APPDATA%\White Box\data\data.json`。`WHITEBOX_DATA_DIR` で差し替えられる（テストと動作確認で使う）
- `backups/` に日ごとのコピー。通常ファイルかつ正しい日付の `data-YYYY-MM-DD.json` だけを30件へ整理し、他のファイルやディレクトリは消さない
- 読込・取込の境界でv1形式、レコード、ID重複、Sessionの開閉状態を検証する。旧v1でsettingsが省略されていれば既定値を補う
- 読込に失敗したファイルは元を保持し、退避コピーを残して起動を中止する。空DBに置き換えて起動を続けない。退避コピーと取込前backupは排他的に作成し、名前が衝突しても以前の復旧版を上書きしない
- 通常変更は `commitChanges` で保存失敗時にDBと実行時状態を巻き戻す。取込は検証・元DBのbackup・置換の順で行う
- 書き出しは稼働中の管理ファイル、`backups/` 配下、既存の破損DB退避コピーを宛先にできない。排他的な専用一時ファイルをflushしてから置き換え、失敗で既存出力を保持する

## 復旧（apps/desktop/src/app/lifecycle.ts）

生存時刻も `runtime.json.tmp` へ書いてから置き換える。途中の書込失敗でも前回成功した `runtime.json` を保持する。Windowsの一時的なrename失敗はDBと同じ限定再試行を使う。周期的な生存記録の失敗は従来どおり例外を外へ投げないため、成功した最新時刻以降の作業を復旧できる保証はない。

終了時の `prepareQuit` は `markAlive({ requireSuccess: true })` で最新の生存時刻を必須にする。保存失敗は例外を返して終了を取り消し、tickerと窓を維持する。通常の周期記録とwakeは、この必須指定を使わない。

セッション中にアプリが落ちると、次の起動時にそのセッションが開いたまま残る。実行中は定期的に「生きている時刻」を別ファイルへ書く。復旧判定には、その時刻と最新のセッション操作時刻のうち新しい方を使い、長い空白があればそこで止めて人間に聞く。休憩中なら確認を出さず、満了監視を再開する。

取込直後は、置換前のDBの生存記録を使用しない。物理的にCurrent Workが開いている場合は整理中の停止も取込後の状態へ再適用する。既に取込が保存された後の安全停止だけは、保存に失敗してもメモリ上で維持して実作業の増加を防ぐ。

- **その時刻で終了する** — PC が落ちていた時間は実作業に入らない
- **続きから再開する** — 短時間の再起動ならこちら

## レンダラの分け方（apps/renderer/src）

```
components/ui/   画面をまたぐ部品（Button・Ring・ProgressBar・Chip・Modal など）。1 ファイル 1 部品
features/        機能ごとの画面部品（board・today・history・settings・welcome・sessions・goals）
pages/            窓 1 つ = ファイル 1 つ（main → MainWindow.tsx など）
stores/           app.ts。メインから配られた状態を持つだけ。計算はしない（zustand）
lib/              bridge.ts（window.whitebox の型付き包み）・selectors.ts（状態から表示用の値を導く）・format.ts
styles/           tokens.css → base/components.css → app.css（screens/*.css を @import）→ notion.css の順で読む
dev/              fixture.ts。ブラウザで開いたときの見た目確認用の固定データ
stories/          Storybook。ui/ と screen/ に分かれ、screen は seed.ts の seedApp() で状態を渡すだけ
```

`dev/fixture.ts` と `stories/` には**コマンドの処理を書かない**（本体と二重実装になり、静かにずれる）。story も同じ規律で、結果の状態を渡すだけにする（decisions 015）。

### import 境界（eslint で機械強制。decisions D-07）

`eslint.config.mjs` が `apps/renderer/src/**/*.{ts,tsx}` に `no-restricted-imports` を掛け、許可する import を `react` / `react-dom` / `zustand` / `@white-box/core` / `@white-box/contracts` / `@/`（自 src のエイリアス）/ 相対 import だけに絞る。`apps/desktop` へ届く import や 3 階層以上の `../` での脱出は別ルールで明示的に禁止。`apps/renderer/src/stories/**` だけは Storybook 関連の import が追加で許可される（本体の境界は変えない）。

## 道標（goals）

道標の目標・問題・構造履歴は同じ Database の `goalMap` に保存する。タスクは既存の `tasks` を共有し、`goalNodeId` で目標へ関連付ける。木の参照・検証・レイアウトは `packages/core/src/goal-map.ts`、成果の判定は `packages/core/src/outcome.ts`、変更は `apps/desktop/src/domain/goal-ops.ts`（他の domain と同じく新しい値を返す純関数）。[統合と旧形式の変換](michishirube.md)を参照。

## Storybook（apps/renderer/src/stories）

`pnpm storybook` で起動する。`components/ui` の各部品と、主要な画面（窓）の一部に story がある。story は状態を渡すだけで、タイマーなどの機構は写さない（本体と二重実装になり黙ってずれるため。`dev/fixture.ts` と同じ規律。decisions 015）。

## 配布（scripts/pack.mjs）

配布手順・構成・詰まりやすい点は [packaging.md](packaging.md) にまとめてある。要点だけここに書く: `tsc` はワークスペースをバンドルしないため、`apps/desktop` のビルド出力（`dist-electron/`）には `@white-box/core` / `@white-box/contracts` への bare import がそのまま残る。`pack.mjs` はこれを解決するために、ビルド済みの `packages/*/dist` と `zod` の実体を `resources/app/node_modules/` へ組み立ててから配布物を作る（pnpm の node_modules はシンボリックリンク構成なので、`fs.realpathSync` で実体を解決してからコピーする）。
