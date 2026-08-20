# White Box — コードを触る前の前提

このファイルは、**知らないと壊す**ことだけを持つ。背景・設計・手順は [docs/](docs/) にある。

- 何をなぜ作るのか → [docs/product-spec.md](docs/product-spec.md)（迷ったら §25 の判断基準）
- 現在地と次にやること → [docs/progress.md](docs/progress.md)
- 構成 → [docs/architecture.md](docs/architecture.md)
- 見た目 → [docs/design-language.md](docs/design-language.md)
- 検証 → [docs/verification.md](docs/verification.md)
- 配布 → [docs/packaging.md](docs/packaging.md)
- 判断の記録 → [docs/decisions.md](docs/decisions.md)

---

## 壊してはいけないもの

- **セッションの真実はメインプロセスが持つ。** タイマーをレンダラに置かない（ウィンドウを閉じても計測が続く必要がある）。
- **実作業時間 = 経過 − 一時停止の重なり。** この計算は `shared/engine.ts` の純関数だけが行い、`tests/engine.test.ts` が守る。
- **呼び出し元のウィンドウを閉じるコマンドは `closeLater()` を使う（150ms 待ってから閉じる）。** 先に返事を返さないと呼び出し側の `await` が永久に返らない。`setImmediate` では IPC の返事の送信と競合し、ソース実行では通るのにパッケージ版で止まる。
- **preload は `.cjs` のまま置く。** package.json が `type: module` なので `.js` にすると読み込みに失敗する。
- **縦並び（flex column）の箱の中身には `flex: none` を効かせる。** 効いていないと中身が高さ 0 に潰れて文字が消える（開始画面・満了ポップアップ・詳細パネルで実際に起きた）。
- **タスクを削除してもセッションの記録は消さない。** 記録側は「（削除されたタスク）」と表示する。
- **色は `src/styles/tokens.css` のトークン経由で使う。** 直接書かない。
- **`scripts/make-shortcuts.ps1` は ASCII のみ。** 日本語を入れると PowerShell 5.1 が化けてコードごと壊れる。
- **`src/dev/fixture.ts` と `scripts/shoot.cjs` にコマンドの処理を書かない。** 本体と二重実装になり、静かにずれる。

## 変更したら必ず通すもの

```bash
npm run typecheck && npm test && node scripts/e2e.mjs
```

見た目を変えたときは、加えて実際に描画した PNG を見る（[docs/verification.md](docs/verification.md)）。
