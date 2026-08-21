# 配布とインストール

`White Box.exe` を組み上げて、デスクトップとタスクバーから開けるようにするまで。

---

## 手順

```bash
npm run pack
powershell -ExecutionPolicy Bypass -File scripts\make-shortcuts.ps1 -Exe "release\White Box\White Box.exe"
```

- `release\White Box\White Box.exe` ができる
- デスクトップとスタートメニューにショートカットが置かれる
- タスクバーに常駐させるときは、スタートメニューの「White Box」を右クリック →「タスクバーにピン留めする」

アイコンを描き直したら `npm run icons` してから `npm run pack`。

## npm run pack は何をしているか

`scripts/pack.mjs`。electron-builder を使わず、次の5つだけをやっている。

1. `node_modules/electron/dist` を `release/White Box/` へコピー（`robocopy`）
2. `electron.exe` を `White Box.exe` に改名し、`default_app.asar` を消す
3. `resources/app/` にビルド済みの `dist` / `dist-electron` / `assets` / `preload.cjs` / 最小の `package.json` を置く
4. `resources/app/node_modules/` に、実行時に要るワークスペース依存の実体を組み立てる（次節）
5. `rcedit` で exe にアイコンと製品名を焼く

asar にまとめていないので、`resources/app` の中身をそのまま読める。個人の道具としては、この方が中を確認しやすい。

### pnpm monorepo と配布物の node_modules

`tsc` はワークスペースをバンドルしないため、`apps/desktop` のビルド出力（`dist-electron/`）には `@white-box/core` / `@white-box/contracts` への bare import（`import { dayKey } from '@white-box/core/engine'` など）がそのまま残る。開発ツリーでは ROOT の `node_modules`（pnpm のシンボリックリンク/ジャンクション）がこれを解決するが、`resources/app/` は ROOT と別のディレクトリツリーなので、そのままでは Node の ESM 解決が通らない（起動はするが `import` で即座に失敗する）。

そこで `pack.mjs` は、ビルド済みの以下だけを `resources/app/node_modules/` へ実体コピーする（開発用依存は持ち込まない）:

- `@white-box/core`・`@white-box/contracts` — 各パッケージの `dist/` + 最小の `package.json`（`exports` のみ）
- `zod`（`@white-box/contracts` の唯一の実行時依存）

pnpm の `node_modules/@white-box/*` や `node_modules/.pnpm/*` はジャンクション（Windows のディレクトリ reparse point）なので、`fs.realpathSync` で実体のパスを解決してからコピーしている（ジャンクションをそのまま配布物へ持ち出しても、`.pnpm` ストアが無い環境では壊れるため）。

### なぜ electron-builder を主経路にしないのか

`npm run dist`（electron-builder の NSIS インストーラ）は、`winCodeSign` の展開時に**シンボリックリンクを作る**。Windows でこれには開発者モードか管理者権限が要り、無い環境では毎回そこで止まる。

インストーラとアンインストーラが欲しくなったときだけ、開発者モードを有効にして `npm run dist` を使えばよい。

### 詰まりやすいところ

- **`fs.cpSync` は Electron の配布ツリー（数千ファイル）で落ちることがある。** `robocopy` を使っている（戻り値は 0〜7 が成功、8 以上が失敗）
- **`release/` が消せない（EBUSY）**: 以前起動した `White Box.exe` がまだ動いている。プロセスを終了してから
- **exe のアイコンが Electron のままになる**: `rcedit` が見つかっていない。`scripts/pack.mjs` の `findRcedit()` は electron-builder のキャッシュから探すので、一度 `npm i` で electron-builder が入っている必要がある
- **配布した exe だけ起動直後に落ちる（開発ツリーでは動く）**: `packages/core` か `packages/contracts` に新しい実行時依存を足したのに `pack.mjs`（`WORKSPACE_PACKAGES` / `packZod()`）を追従させていない。配布物の起動確認は必ず `WHITEBOX_EXE` 経路の `node scripts/e2e.mjs` で行う（開発ツリーの e2e 成功は配布物の成功を意味しない）

## ショートカット

`scripts/make-shortcuts.ps1` は **ASCII のみで書く**。日本語を入れると PowerShell 5.1 が BOM 無し UTF-8 を誤読し、化けたバイト列が隣の行のパースを壊してコードごと消える。

デスクトップの場所は `[Environment]::GetFolderPath('Desktop')` で実行時に解決する（OneDrive 配下にある場合があるため、パスを決め打ちしない）。

## 保存先

`%APPDATA%\white-box\data\data.json`（設定 → データ →「保存先を開く」で開ける）。

**アプリ名を変えると保存先も変わる。** 名前を変えるときは、設定から書き出し → 新しい名前で起動 → 読み込み、で移す。

## Windows 起動時の自動起動

設定から入り切りできる。パッケージした exe を指すので、開発中の `npm start` とは別物として登録される。
