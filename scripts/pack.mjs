/**
 * Windows 用の実行ファイルを組み立てる（release/White Box/White Box.exe）。
 *
 * electron-builder は winCodeSign の展開にシンボリックリンク作成の権限を要求し、
 * 開発者モードでない Windows では止まる。ここは copy と rcedit だけで完結させている。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'release', 'White Box')
const EXE = path.join(OUT, 'White Box.exe')
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist')

// pnpm workspace: dist-electron からの実行時 import（@white-box/core, @white-box/contracts）が
// bare specifier のまま残る（tsc はバンドルしない）。node_modules を持たない配布先では
// Node の ESM 解決が通らないため、必要な実体だけを resources/app/node_modules に組み立てる。
const WORKSPACE_PACKAGES = ['core', 'contracts']

const need = ['dist', 'dist-electron', 'assets', ...WORKSPACE_PACKAGES.map((p) => `packages/${p}/dist`)]
for (const dir of need) {
  if (!fs.existsSync(path.join(ROOT, dir))) {
    console.error(`${dir}/ が無い。先に npm run build を通すこと。`)
    process.exit(1)
  }
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })

console.log('copying electron runtime...')
copyTree(ELECTRON_DIST, OUT)
fs.renameSync(path.join(OUT, 'electron.exe'), EXE)
fs.rmSync(path.join(OUT, 'resources', 'default_app.asar'), { force: true })

const APP = path.join(OUT, 'resources', 'app')
fs.mkdirSync(APP, { recursive: true })
for (const dir of ['dist', 'dist-electron', 'assets']) {
  copyTree(path.join(ROOT, dir), path.join(APP, dir))
}
fs.mkdirSync(path.join(APP, 'apps', 'desktop', 'src', 'presentation'), { recursive: true })
fs.copyFileSync(
  path.join(ROOT, 'apps', 'desktop', 'src', 'presentation', 'preload.cjs'),
  path.join(APP, 'apps', 'desktop', 'src', 'presentation', 'preload.cjs'),
)

console.log('assembling workspace dependencies...')
for (const name of WORKSPACE_PACKAGES) packWorkspacePackage(name)
packZod()

// 実行に要らないものは持ち込まない（開発用の依存やスクリプト）
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'))
fs.writeFileSync(
  path.join(APP, 'package.json'),
  JSON.stringify(
    {
      name: pkg.name,
      productName: 'White Box',
      version: pkg.version,
      description: pkg.description,
      main: pkg.main,
      type: pkg.type,
    },
    null,
    2,
  ),
  'utf-8',
)

// アイコンと製品情報を exe に焼く
const rcedit = findRcedit()
if (rcedit) {
  console.log('applying icon...')
  execFileSync(rcedit, [
    EXE,
    '--set-icon',
    path.join(ROOT, 'assets', 'icon.ico'),
    '--set-version-string', 'ProductName', 'White Box',
    '--set-version-string', 'FileDescription', 'White Box',
    '--set-version-string', 'CompanyName', 'menma22',
    '--set-file-version', pkg.version,
    '--set-product-version', pkg.version,
  ])
} else {
  console.warn('rcedit が見つからないので、exe のアイコンは Electron の既定のままになる。')
}

console.log('')
console.log('done: ' + EXE)
console.log('ショートカットを作る: powershell -ExecutionPolicy Bypass -File scripts\\make-shortcuts.ps1 -Exe "' + EXE + '"')

/** robocopy を使う。node の cpSync は Electron の配布ツリー（数千ファイル）で落ちることがある。 */
function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true })
  const res = spawnSync('robocopy', [src, dst, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1'], {
    stdio: 'ignore',
  })
  // robocopy は 0〜7 が成功、8 以上が失敗
  if ((res.status ?? 16) >= 8) {
    throw new Error('copy failed: ' + src + ' -> ' + dst + ' (robocopy ' + res.status + ')')
  }
}

/** dist/ と exports だけを resources/app/node_modules/<name> に実体コピーする（開発用依存は持ち込まない）。 */
function packWorkspacePackage(dirName) {
  const src = path.join(ROOT, 'packages', dirName)
  const pkg = JSON.parse(fs.readFileSync(path.join(src, 'package.json'), 'utf-8'))
  const dest = path.join(APP, 'node_modules', ...pkg.name.split('/'))
  copyTree(path.join(src, 'dist'), path.join(dest, 'dist'))
  fs.writeFileSync(
    path.join(dest, 'package.json'),
    JSON.stringify({ name: pkg.name, version: pkg.version, type: pkg.type, exports: pkg.exports }, null, 2),
    'utf-8',
  )
}

/** pnpm はシンボリックリンクで .pnpm ストアを指すだけなので、実体（realpath）をコピーする。 */
function packZod() {
  const link = path.join(ROOT, 'packages', 'contracts', 'node_modules', 'zod')
  copyTree(fs.realpathSync(link), path.join(APP, 'node_modules', 'zod'))
}

function findRcedit() {
  const cache = path.join(process.env.LOCALAPPDATA ?? '', 'electron-builder', 'Cache', 'winCodeSign')
  if (!fs.existsSync(cache)) return null
  for (const entry of fs.readdirSync(cache)) {
    const candidate = path.join(cache, entry, 'rcedit-x64.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}
