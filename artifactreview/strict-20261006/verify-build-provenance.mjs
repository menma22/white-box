import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const ownFile = fileURLToPath(import.meta.url)
const outputDirectory = path.dirname(ownFile)
const root = path.resolve(outputDirectory, '../..')
const packagedRoot = path.join(root, 'release', 'White Box', 'resources', 'app')
const startedAt = new Date().toISOString()
const relative = (file) => path.relative(root, file).split(path.sep).join('/')
const ordered = (items) => items.sort((a, b) => a < b ? -1 : a > b ? 1 : 0)
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const shaFile = (file) => digest(fs.readFileSync(file))
const fingerprint = (rows) => digest(Buffer.from(JSON.stringify(rows), 'utf8'))
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'))

function gitHead() {
  const gitEntry = path.join(root, '.git')
  const directory = fs.statSync(gitEntry).isDirectory() ? gitEntry : path.resolve(root, fs.readFileSync(gitEntry, 'utf8').trim().replace(/^gitdir:\s*/, ''))
  const head = fs.readFileSync(path.join(directory, 'HEAD'), 'utf8').trim()
  if (!head.startsWith('ref: ')) return head
  const ref = head.slice(5)
  const commonEntry = path.join(directory, 'commondir')
  const common = fs.existsSync(commonEntry) ? path.resolve(directory, fs.readFileSync(commonEntry, 'utf8').trim()) : directory
  const loose = path.join(common, ref)
  if (fs.existsSync(loose)) return fs.readFileSync(loose, 'utf8').trim()
  const packed = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8').split(/\r?\n/).find((line) => line.endsWith(` ${ref}`))
  if (!packed) throw new Error(`Git HEAD reference is not available: ${ref}`)
  return packed.split(' ')[0]
}

function files(directory) {
  const result = []
  function visit(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const file = path.join(current, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile()) result.push(path.relative(directory, file).split(path.sep).join('/'))
      else throw new Error(`Unexpected non-file entry: ${file}`)
    }
  }
  visit(directory)
  return ordered(result)
}

const mappings = [
  { name: 'renderer', source: 'dist', target: 'dist', compiled: true },
  { name: 'desktop', source: 'dist-electron', target: 'dist-electron', compiled: true },
  { name: 'core', source: 'packages/core/dist', target: 'node_modules/@white-box/core/dist', compiled: true },
  { name: 'contracts', source: 'packages/contracts/dist', target: 'node_modules/@white-box/contracts/dist', compiled: true },
  { name: 'preload', source: 'apps/desktop/src/presentation/preload.cjs', target: 'apps/desktop/src/presentation/preload.cjs', compiled: true, singleFile: true },
  { name: 'assets', source: 'assets', target: 'assets' },
  { name: 'mcp', source: 'scripts/white-box-mcp.mjs', target: 'scripts/white-box-mcp.mjs', singleFile: true },
  { name: 'zod', source: 'packages/contracts/node_modules/zod', target: 'node_modules/zod' },
]
const manifest = []
const expectedPackagedFiles = new Set()
const discrepancies = []

function compare(mapping, source, target, bytes = fs.readFileSync(source), generated = false) {
  const targetRelative = path.relative(packagedRoot, target).split(path.sep).join('/')
  expectedPackagedFiles.add(targetRelative)
  const targetExists = fs.existsSync(target)
  const packed = targetExists ? fs.readFileSync(target) : null
  const byteEqual = packed !== null && bytes.equals(packed)
  const record = {
    mapping: mapping.name, source: relative(source), packaged: relative(target),
    generated, compiled: Boolean(mapping.compiled), bytes: bytes.length,
    ...(generated ? { sourceInputSha256: shaFile(source) } : {}),
    sha256: digest(bytes), packagedSha256: packed === null ? null : digest(packed), byteEqual,
  }
  manifest.push(record)
  if (!byteEqual) discrepancies.push({ file: targetRelative, problem: targetExists ? 'different-bytes' : 'missing-file' })
}

for (const mapping of mappings) {
  const source = path.join(root, mapping.source)
  const target = path.join(packagedRoot, mapping.target)
  if (mapping.singleFile) compare(mapping, source, target)
  else {
    const sourceFiles = files(source)
    const targetFiles = files(target)
    const expected = new Set(sourceFiles)
    for (const extra of targetFiles.filter((file) => !expected.has(file))) discrepancies.push({ file: `${mapping.target}/${extra}`, problem: 'unexpected-file' })
    for (const file of sourceFiles) compare(mapping, path.join(source, file), path.join(target, file))
  }
}

const packageSource = path.join(root, 'package.json')
const pkg = readJson(packageSource)
compare({ name: 'application-package' }, packageSource, path.join(packagedRoot, 'package.json'), Buffer.from(JSON.stringify({
  name: pkg.name, productName: 'White Box', version: pkg.version, description: pkg.description, main: pkg.main, type: pkg.type,
}, null, 2), 'utf8'), true)
for (const name of ['core', 'contracts']) {
  const source = path.join(root, 'packages', name, 'package.json')
  const workspace = readJson(source)
  compare({ name: `${name}-package` }, source, path.join(packagedRoot, 'node_modules', ...workspace.name.split('/'), 'package.json'), Buffer.from(JSON.stringify({
    name: workspace.name, version: workspace.version, type: workspace.type, exports: workspace.exports,
  }, null, 2), 'utf8'), true)
}

const packedFiles = files(packagedRoot)
for (const extra of packedFiles.filter((file) => !expectedPackagedFiles.has(file))) discrepancies.push({ file: extra, problem: 'unmapped-package-file' })
manifest.sort((a, b) => a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
const compiled = manifest.filter((record) => record.compiled)
const compiledPairs = compiled.map((record) => [record.source, record.sha256])
const packagedCompiledPairs = compiled.map((record) => [record.source, record.packagedSha256])

const qaFile = path.join(root, 'docs', 'qa', '20261006_phase2-completion.json')
const qa = readJson(qaFile)
const verifierNames = ordered([...new Set([
  ...qa.commonRegressions.scripts, 'e2e-phase2-planning.mjs', 'e2e-quit.mjs', 'run-ui-e2e.ps1',
  'owned-processes.mjs', 'owned-processes.test.mjs', 'quit-observer.mjs', 'verify-input-activity.mjs', 'verify-note-reminders.cjs',
])])
const verifierScripts = verifierNames.map((name) => ({ file: `scripts/${name}`, sha256: shaFile(path.join(root, 'scripts', name)) }))
verifierScripts.push({ file: relative(ownFile), sha256: shaFile(ownFile) })

const compatibilityFile = path.join(outputDirectory, 'production-compatibility.json')
const compatibility = readJson(compatibilityFile)
if (!process.env.APPDATA) throw new Error('APPDATA is not available')
const productionDb = path.join(process.env.APPDATA, 'White Box', 'data', 'data.json')
const productionSha256 = shaFile(productionDb)
const executable = path.join(root, 'release', 'White Box', 'White Box.exe')
const compiledFingerprint = fingerprint(compiledPairs)
const allSourceEqualsPackage = discrepancies.length === 0 && manifest.every((record) => record.byteEqual)
const productionUnchanged = productionSha256 === compatibility.sha256
const report = {
  schema: 1, startedAt, completedAt: new Date().toISOString(), repository: root,
  measuredHead: gitHead(),
  mappingSources: [{ file: 'scripts/pack.mjs', sha256: shaFile(path.join(root, 'scripts', 'pack.mjs')) }, { file: relative(qaFile), sha256: shaFile(qaFile) }],
  mappings, fileCount: manifest.length, packagedFileCount: packedFiles.length,
  compiledFileCount: compiled.length,
  fingerprintAlgorithm: 'SHA256 of UTF-8 compact JSON [relative source path, SHA256] pairs sorted by ASCII path ascending; no BOM or trailing newline',
  compiledFingerprint, packagedCompiledFingerprint: fingerprint(packagedCompiledPairs),
  fullManifestFingerprint: fingerprint(manifest.map((record) => [record.source, record.sha256])),
  allSourceEqualsPackage, discrepancies,
  executable: { file: relative(executable), sha256: shaFile(executable) },
  historicalQa: { recordedCompiledFingerprint: qa.buildProvenance.compiledFingerprint, matchesCurrentFingerprint: qa.buildProvenance.compiledFingerprint === compiledFingerprint },
  verifierScripts,
  productionDatabase: { path: '%APPDATA%/White Box/data/data.json', readOnly: true, contentOutput: false, sha256: productionSha256,
    comparison: relative(compatibilityFile), comparisonFileSha256: shaFile(compatibilityFile), expectedSha256: compatibility.sha256, unchanged: productionUnchanged },
  manifest,
}
const output = path.join(outputDirectory, 'build-provenance.json')
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ fileCount: report.fileCount, compiledFileCount: report.compiledFileCount,
  allSourceEqualsPackage, discrepancies: discrepancies.length, productionUnchanged, output }, null, 2))
if (!allSourceEqualsPackage || !productionUnchanged) process.exitCode = 1
