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

`scripts/pack.mjs`。electron-builder を使わず、次の4つだけをやっている。

1. `node_modules/electron/dist` を `release/White Box/` へコピー（`robocopy`）
2. `electron.exe` を `White Box.exe` に改名し、`default_app.asar` を消す
3. `resources/app/` にビルド済みの `dist` / `dist-electron` / `assets` / `preload.cjs` / 最小の `package.json` を置く
4. `rcedit` で exe にアイコンと製品名を焼く

asar にまとめていないので、`resources/app` の中身をそのまま読める。個人の道具としては、この方が中を確認しやすい。

### なぜ electron-builder を主経路にしないのか

`npm run dist`（electron-builder の NSIS インストーラ）は、`winCodeSign` の展開時に**シンボリックリンクを作る**。Windows でこれには開発者モードか管理者権限が要り、無い環境では毎回そこで止まる。

インストーラとアンインストーラが欲しくなったときだけ、開発者モードを有効にして `npm run dist` を使えばよい。

### 詰まりやすいところ

- **`fs.cpSync` は Electron の配布ツリー（数千ファイル）で落ちることがある。** `robocopy` を使っている（戻り値は 0〜7 が成功、8 以上が失敗）
- **`release/` が消せない（EBUSY）**: 以前起動した `White Box.exe` がまだ動いている。プロセスを終了してから
- **exe のアイコンが Electron のままになる**: `rcedit` が見つかっていない。`scripts/pack.mjs` の `findRcedit()` は electron-builder のキャッシュから探すので、一度 `npm i` で electron-builder が入っている必要がある

## ショートカット

`scripts/make-shortcuts.ps1` は **ASCII のみで書く**。日本語を入れると PowerShell 5.1 が BOM 無し UTF-8 を誤読し、化けたバイト列が隣の行のパースを壊してコードごと消える。

デスクトップの場所は `[Environment]::GetFolderPath('Desktop')` で実行時に解決する（OneDrive 配下にある場合があるため、パスを決め打ちしない）。

## 保存先

`%APPDATA%\white-box\data\data.json`（設定 → データ →「保存先を開く」で開ける）。

**アプリ名を変えると保存先も変わる。** 名前を変えるときは、設定から書き出し → 新しい名前で起動 → 読み込み、で移す。

## Windows 起動時の自動起動

設定から入り切りできる。パッケージした exe を指すので、開発中の `npm start` とは別物として登録される。
