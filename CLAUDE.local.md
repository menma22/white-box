# White Box — コードを触る前の前提

このファイルは、**知らないと壊す**ことだけを持つ。背景・設計・手順は [docs/](docs/) にある。

- 何をなぜ作るのか → [docs/product-spec.md](docs/product-spec.md)（迷ったら §25 の判断基準）
- 現在地と次にやること → [docs/progress.md](docs/progress.md)
- 構成 → [docs/architecture.md](docs/architecture.md)
- 見た目 → [docs/design-language.md](docs/design-language.md)
- 検証 → [docs/verification.md](docs/verification.md)
- 配布 → [docs/packaging.md](docs/packaging.md)
- 判断の記録 → [docs/decisions.md](docs/decisions.md)
- 開発の流れ（story 先行・1 story = 1 PR） → [GIT_WORKFLOW.md](GIT_WORKFLOW.md)・[docs/stories/](docs/stories/README.md)

---

## 壊してはいけないもの

- **セッションの真実はメインプロセスが持つ。** タイマーをレンダラに置かない（ウィンドウを閉じても計測が続く必要がある）。
- **実作業時間 = 経過 − 一時停止の重なり。** この計算は `packages/core/src/engine.ts` の純関数だけが行い、`apps/desktop/tests/session-ops.test.ts` が守る。
- **テストは各パッケージの `tests/` に置く。** `tsconfig.test.json` がそこだけを型検査するので、外に置くと型検査を素通りする（vitest は型を見ない）。
- **コマンドの追加・変更は `packages/contracts` が先。** 契約に無いコマンド・合わない引数は受け口（zod）で拒否される。レンダラとメインの両方が契約から型を得るので、契約を変えずに片側だけ変えるとコンパイルが落ちる（それが正しい挙動）。
- **renderer から `apps/desktop` へは import できない（lint が落とす）。** 境界を緩めない。レンダラが見てよいのは `@white-box/contracts` と `@white-box/core` だけ。
- **呼び出し元のウィンドウを閉じるコマンドは `closeLater()`（WindowPort）を使う（150ms 待ってから閉じる）。** 先に返事を返さないと呼び出し側の `await` が永久に返らない。`setImmediate` では IPC の返事の送信と競合し、ソース実行では通るのにパッケージ版で止まる。
- **preload は `.cjs` のまま `apps/desktop/src/presentation/` に置く。** package.json が `type: module` なので `.js` にすると読み込みに失敗する。
- **`packages/core`・`packages/contracts` に実行時依存を足したら `scripts/pack.mjs` の同梱リストを追従する。** 開発ツリーのテストは通り続けるのに配布物だけが起動しなくなる（`WHITEBOX_EXE` 経路の e2e でしか検出できない）。
- **縦並び（flex column）の箱の中身には `flex: none` を効かせる。** 効いていないと中身が高さ 0 に潰れて文字が消える（開始画面・満了ポップアップ・詳細パネルで実際に起きた）。
- **タスクを削除してもセッションの記録は消さない。** 記録側は「（削除されたタスク）」と表示する。
- **色は `apps/renderer/src/styles/tokens.css` のトークン経由で使う。** 直接書かない。
- **`scripts/make-shortcuts.ps1` は ASCII のみ。** 日本語を入れると PowerShell 5.1 が化けてコードごと壊れる。
- **`apps/renderer/src/dev/fixture.ts`・`scripts/shoot.cjs`・story にコマンドの処理や機構を書かない。** 本体と二重実装になり、静かにずれる。story に渡すのは結果の状態（固定 props）だけ。

## 変更したら必ず通すもの

```bash
pnpm typecheck && pnpm lint && pnpm test && node scripts/e2e.mjs
```

見た目を変えたときは、加えて実際に描画した PNG を見る（[docs/verification.md](docs/verification.md)）。UI 部品は `pnpm storybook` で状態ごとに確認できる。配布に関わる変更（scripts/・packages/ の依存）をしたら `npm run pack` → `WHITEBOX_EXE` 経路の e2e まで回す（[docs/packaging.md](docs/packaging.md)）。
