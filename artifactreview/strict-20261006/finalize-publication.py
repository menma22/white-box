import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import quote, unquote

root = Path.cwd()
audit = root / 'artifactreview/strict-20261006'
review = root / 'docs/reviews/20261006-strict-pr-review'
evidence = review / 'evidence'
head = '130016c83ce352598283ca8378362dad3c1821b0'
product_head = '125026f7088487a429170f6276786a13f0e40c4c'
original = '779df6e566a77d0c4fef4c8ef575d885e565f799'

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def read_log(path):
    raw = path.read_bytes()
    return raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')

def portable(text):
    return text.replace(str(root), '.').replace(root.as_posix(), '.').replace('file:///' + quote(root.as_posix(), safe='/:') + '/', 'file:///<checkout>/')

assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip() == head
assert subprocess.run(['git', 'diff', '--quiet', head, '--', 'apps', 'packages', 'scripts', 'vitest.config.ts']).returncode == 0
assert subprocess.run(['git', 'diff', '--quiet', product_head, head, '--', 'apps', 'packages', 'vitest.config.ts']).returncode == 0
gates = read_json(audit / 'gates-final.json')
assert len(gates) == 4 and all(g['exitCode'] == 0 and g['measuredHead'] == product_head for g in gates)
assert re.search(r'Tests\s+617 passed', read_log(audit / 'test-final.log'))
source = read_json(evidence / 'final-source-publication.json')
package = read_json(evidence / 'final-package-publication.json')
for suite, expected in [(source, 13), (package, 12)]:
    assert suite['frozen_product_and_qa_commit'] == head
    assert suite['suite_exit_code'] == 0 and suite['script_count'] == expected
    assert suite['script_exit_zero_count'] == expected and suite['structured_failed_assertions'] == 0

provenance = read_json(audit / 'build-provenance.json')
assert provenance['measuredHead'] == head and provenance['allSourceEqualsPackage']
assert provenance['fileCount'] == 864 and provenance['compiledFileCount'] == 135
assert not provenance['discrepancies']
public_provenance = {key: value for key, value in provenance.items() if key not in ['repository', 'productionDatabase']}
write_json(evidence / 'build-provenance-final.json', public_provenance)
public_gates = [{**gate, 'originalLog': gate['log'],
                 'log': '../reviews/20261006-strict-pr-review/evidence/' + Path(gate['log']).name}
                for gate in gates]
write_json(evidence / 'gates-final.json', public_gates)
for name in ['typecheck-final', 'lint-final', 'test-final', 'pack-final', 'build-provenance-final',
             'e2e-source-checkpoint-final', 'e2e-package-checkpoint-final',
             'quit-observer-off-checkpoint-final', 'quit-live-checkpoint-final',
             'notes-source-ready-final', 'basic-source-cdp-final', 'e2e-package-ready-final',
             'e2e-package-cdp-final', 'build-provenance-cdp-final']:
    (evidence / (name + '.log')).write_text(portable(read_log(audit / (name + '.log'))), encoding='utf-8', newline='\n')

log_transforms = []
for published_log in sorted(evidence.glob('*.log')):
    normalized = published_log.read_bytes().decode('utf-8-sig').replace('\r\r\n', '\n').replace('\r\n', '\n').replace('\r', '\n')
    published_log.write_text(normalized, encoding='utf-8', newline='\n')
    original_log = audit / published_log.name
    if not original_log.is_file():
        continue
    raw = original_log.read_bytes()
    log_transforms.append({'original': original_log.relative_to(root).as_posix(),
                           'originalSha256': hashlib.sha256(raw).hexdigest(),
                           'originalEncoding': 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8',
                           'published': published_log.relative_to(root).as_posix(),
                           'publishedSha256': hashlib.sha256(published_log.read_bytes()).hexdigest(),
                           'publishedEncoding': 'utf-8',
                           'equalsCurrentPortableTransform': published_log.read_text(encoding='utf-8') == portable(read_log(original_log))})
write_json(evidence / 'log-transforms.json', {
    'scope': 'Suite tables retain hashes of original logs. Published logs are UTF-8/LF copies with checkout paths normalized; compare each recorded hash only to its named byte stream.',
    'logs': log_transforms})

quit_runs = []
for mode, log_name, expected in [('default', 'e2e-source-checkpoint-final', 11),
                               ('observer-off', 'quit-observer-off-checkpoint-final', 7),
                               ('multiple-windows', 'quit-live-checkpoint-final', 11)]:
    text = read_log(audit / (log_name + '.log'))
    paths = re.findall(r'Evidence: ([^\r\n]+)', text)
    directory = Path(next(value for value in reversed(paths) if '.e2e-quit' in value))
    path = directory / 'result.json'
    result = read_json(path)
    assert result['exitCode'] == 0 and len(result['checks']) == expected and all(c['passed'] for c in result['checks'])
    quit_runs.append({'mode': mode, 'directory': directory.relative_to(root).as_posix(), 'exitCode': 0,
                      'passed': expected, 'failed': 0, 'checks': result['checks'],
                      'resultSha256': hashlib.sha256(path.read_bytes()).hexdigest()})
write_json(evidence / 'quit-final-checkpoint.json', {'measuredHead': product_head, 'runs': quit_runs,
           'scope': 'Source Electron only; packaged natural quits are recorded separately in the planning/priority suite.'})

qa = {
    'schema': 1, 'date': '2026-10-06', 'status': 'verified-with-listed-unverified-cases',
    'productMeasuredHead': product_head, 'qaMeasuredHead': head, 'finalGatesComplete': True,
    'originalPrHeads': {'21': '48cc55f7a33147e0c3fd7ab946d7cd9324faeb0e',
                       '22': 'c9c19782365353094a3842b05b76b5373fb69031',
                       '23': '123666b1c94224ffaa62b8e415dfca1e891fafdb', '24': original},
    'repairsConsolidatedInPr': 24, 'earlierPrHeadsUnchanged': True,
    'staticGates': public_gates,
    'publishedLogMapping': '../reviews/20261006-strict-pr-review/evidence/log-transforms.json',
    'unitTests': {'passed': 617, 'failed': 0, 'files': 61, 'ownedProcessTests': 14},
    'storybook': {'exitCode': 0, 'measuredHead': '97e583d59ac39e43d3570fb9173a3ecf77c1bec7',
                  'rendererUnchangedToFinal': True, 'evidence': '../reviews/20261006-strict-pr-review/evidence/storybook.log'},
    'runtimeSuites': [{'mode': suite['suite'], 'scripts': suite['script_count'],
                       'structuredAssertions': suite['recorded_structured_assertions'],
                       'evidence': '../reviews/20261006-strict-pr-review/evidence/' + name}
                      for suite, name in [(source, 'final-source-publication.json'), (package, 'final-package-publication.json')]],
    'quitModes': {'default': 11, 'observerOff': 7, 'multipleWindows': 11,
                  'evidence': '../reviews/20261006-strict-pr-review/evidence/quit-final-checkpoint.json'},
    'buildProvenance': {'appFiles': 864, 'compiledFiles': 135, 'packageEqualsBuild': True,
                        'compiledFingerprint': provenance['compiledFingerprint'],
                        'packageExecutableSha256': provenance['executable']['sha256'],
                        'evidence': '../reviews/20261006-strict-pr-review/evidence/build-provenance-final.json'},
    'lineCoverage': {'originalPrUnits': 8460, 'initialRepairUnits': 1915,
                     'postRepairUnits': 1098, 'checkpointRepairUnits': 61, 'qaReadinessUnits': 2, 'qaCdpRepairUnits': 18,
                     'meaning': 'Per-fixed-diff purpose assignment; not a semantic correctness rate or unique final-line total.'},
    'retainedFailureHistory': '../reviews/20261006-strict-pr-review/evidence/known-failures.json',
    'limitations': ['The old intermittent native quit timeout root cause is not established by subsequent passes.',
                    'A packaged Note return-shortcut timeout was retained; an observer demonstrated DOM absence before unlock on another transition, but did not establish that original timeout cause.',
                    'Not every common script proves natural exit; captured native code zero, PID absence and cleanup fallback are separated.',
                    'Native file-picker and physical titlebar close operation were not verified.',
                    'The real main heartbeat failure dialog is mapped by source; the faulted required-checkpoint probes use actual Store and controlled Ports, not native-dialog pixels.',
                    'OS power-loss durability and preservation of new fields by every old executable are outside measured guarantees.',
                    'Best-effort periodic heartbeat cannot guarantee uncommitted work after its last successful timestamp.',
                    'Daily-use EXE was not updated, PRs were not merged, and production contents/counts/hashes are excluded from public evidence.'],
}
write_json(root / 'docs/qa/20261006_strict-pr-review.json', qa)

selected_audit = ['final-safety-probes.mjs', 'notes-transition-probe.mjs', 'task-title-row-transition-probe.mjs',
                  'final-boundary-probes.test.ts', 'final-boundary-probes.config.ts',
                  'classify-pr24.py', 'classify-repair.py', 'post-repair-classify.py', 'checkpoint-repair-classify.py',
                  'verify-build-provenance.mjs', 'export-review-evidence.py',
                  'summarize-ui-evidence.py', 'publish-final-evidence.py', 'finalize-publication.py', 'complete-review-text.py',
                  'pr24-final-body.md', 'heartbeat-atomic-probe/probe.mjs', 'heartbeat-atomic-probe/probe-after.mjs',
                  'shutdown-heartbeat-check/probe.test.ts', 'shutdown-heartbeat-check/vitest.config.ts',
                  'notes-navigation-check/e2e-notes-diagnostic.mjs',
                  'cdp-settlement-check/probe.mjs', 'cdp-settlement-check/actual-connect-baseline.mjs',
                  'cdp-settlement-check/actual-connect-fixed.mjs']
changed = subprocess.check_output(['git', 'diff', '--name-only', original, head], text=True, encoding='utf-8').splitlines()
documents = ['docs/architecture.md', 'docs/decisions.md', 'docs/verification.md', 'docs/progress.md', 'docs/qa/20261006_strict-pr-review.json']
published = sorted(set(changed + documents + [p.relative_to(root).as_posix() for p in review.rglob('*') if p.is_file()] +
                       ['artifactreview/strict-20261006/' + value for value in selected_audit] +
                       ['docs/reviews/20261006-strict-pr-review/changes.md']))
lines = ['# 変更ファイル一覧', '', '原PR #24 headから製品・QA測定点 `' + head + '` までの修正と、提出した文書・監査証拠。',
         '日常利用データ、配布build出力、既存の未追跡レビュー文書はこの提出一覧に含めない。', '']
groups = [('実装', lambda p: '/src/' in p), ('回帰テスト', lambda p: '/tests/' in p or p == 'vitest.config.ts'),
          ('実画面の検証器', lambda p: p.startswith('scripts/')), ('文書・監査成果物', lambda p: True)]
remaining = list(published)
for title, predicate in groups:
    group = [p for p in remaining if predicate(p)]
    remaining = [p for p in remaining if p not in group]
    if not group:
        continue
    lines.extend(['## ' + title, ''])
    for relative in group:
        label = relative
        role = '保存・状態・画面の修正' if title == '実装' else '故障・境界・互換性の回帰' if title == '回帰テスト' else '実IPC・DOM・プロセスの証拠' if title == '実画面の検証器' else '引き継ぎ・測定結果・再現用の記録'
        target = Path(os.path.relpath(root / relative, review)).as_posix()
        lines.append('- [' + label + '](' + quote(target, safe='/._-') + ') — ' + role)
    lines.append('')
(review / 'changes.md').write_text('\n'.join(lines), encoding='utf-8')
write_json(audit / 'publication-files.json', {'measuredHead': head, 'files': published})

broken = []
for document in review.rglob('*.md'):
    for link in re.findall(r'\]\(([^)]+)\)', document.read_text(encoding='utf-8-sig')):
        target = link.strip('<>').split('#', 1)[0].split('?', 1)[0]
        if not target or re.match(r'^[a-z][a-z0-9+.-]*://', target, re.I):
            continue
        target = re.sub(r':\d+$', '', unquote(target))
        if not (document.parent / target).exists():
            broken.append({'document': document.relative_to(root).as_posix(), 'link': link})
for path in review.rglob('*.json'):
    read_json(path)
assert not broken, json.dumps(broken, ensure_ascii=False)
print(json.dumps({'files': len(published), 'reviewJsonValid': True, 'brokenLocalLinks': len(broken),
                  'measuredHead': head, 'sourceScripts': 13, 'packageScripts': 12, 'unitTests': 617}))
