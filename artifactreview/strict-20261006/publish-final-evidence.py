import hashlib
import json
import re
import shutil
from pathlib import Path
from urllib.parse import quote

root = Path.cwd()
audit = root / 'artifactreview/strict-20261006'
evidence = root / 'docs/reviews/20261006-strict-pr-review/evidence'
evidence.mkdir(parents=True, exist_ok=True)
head = '97e583d59ac39e43d3570fb9173a3ecf77c1bec7'

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def decode_log(path):
    raw = path.read_bytes()
    return raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig')

def portable(text):
    return text.replace(str(root), '.').replace(root.as_posix(), '.').replace('file:///' + quote(root.as_posix(), safe='/:') + '/', 'file:///<checkout>/')

for stem in ['post-repair-inventory', 'post-repair-assignments']:
    write_json(evidence / (stem + '.json'), read_json(audit / (stem + '.json')))

provenance = read_json(audit / 'build-provenance.json')
assert provenance['measuredHead'] == head
assert provenance['allSourceEqualsPackage'] and not provenance['discrepancies']
public_provenance = {key: provenance[key] for key in [
    'schema', 'startedAt', 'completedAt', 'measuredHead', 'mappingSources', 'mappings',
    'fileCount', 'packagedFileCount', 'compiledFileCount', 'fingerprintAlgorithm',
    'compiledFingerprint', 'packagedCompiledFingerprint', 'fullManifestFingerprint',
    'allSourceEqualsPackage', 'discrepancies', 'executable', 'verifierScripts', 'manifest',
]}
write_json(evidence / 'build-provenance.json', public_provenance)

for name in ['typecheck', 'lint', 'test', 'pack', 'storybook', 'owned-processes',
             'e2e-source-final', 'e2e-package-final', 'quit-observer-off-final', 'quit-live-final',
             'final-safety-probes', 'notes-transition-probe', 'task-title-row-transition-probe',
             'final-boundary-regressions']:
    path = audit / (name + '.log')
    (evidence / (name + '.log')).write_text(portable(decode_log(path)), encoding='utf-8')

write_json(evidence / 'gates.json', read_json(audit / 'gates.json'))
diagnosis = read_json(audit / 'priority-quit-diagnosis.json')
write_json(evidence / 'quit-diagnosis.json', diagnosis)

for source, target in [
    ('.e2e/phase2-planning-run-S4tppu/09a-task-context-conflict.png', 'task-context-conflict.png'),
    ('.e2e/phase2-planning-run-S4tppu/09b-linked-note-conflict.png', 'linked-note-conflict.png'),
    ('.e2e/phase2-planning-run-S4tppu/01-week-metrics-first-minimum.png', 'minimum-week.png'),
    ('.e2e/activity-run-n7t1nx/08-minimum-history.png', 'minimum-history.png'),
]:
    shutil.copyfile(root / source, evidence / target)

quit_runs = []
for mode, directory, expected in [('default', '.e2e-quit/run-OfILWA', 11),
                                  ('observer-off', '.e2e-quit/run-jwGnRW', 7),
                                  ('multiple-windows', '.e2e-quit/run-wtWkxL', 11)]:
    result = read_json(root / directory / 'result.json')
    checks = result['checks']
    assert result['exitCode'] == 0 and len(checks) == expected and all(c['passed'] for c in checks)
    quit_runs.append({'mode': mode, 'directory': directory, 'exitCode': result['exitCode'],
                      'passed': len(checks), 'failed': 0, 'checks': checks,
                      'resultSha256': hashlib.sha256((root / directory / 'result.json').read_bytes()).hexdigest()})
write_json(evidence / 'quit-final.json', {'measuredHead': head, 'runs': quit_runs,
           'scope': 'Source Electron only; these modes do not exercise the packaged executable.'})

failure_paths = ['.e2e/task-priority-run-XpI31l/failure.txt',
                 '.e2e/phase2-planning-run-IjlXpb/failure.txt',
                 '.e2e/task-priority-run-U2wlYs/failure.txt']
failures = []
for relative in failure_paths:
    path = root / relative
    if path.exists():
        failures.append({'artifact': relative, 'stage': 'repair-in-progress',
                         'failure': portable(path.read_text(encoding='utf-8-sig')),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
write_json(evidence / 'known-failures.json', {'failures': failures,
           'limits': 'Failures are retained as observed; later passes do not prove the old native quit root cause.'})

for path in evidence.glob('*.json'):
    read_json(path)
print(json.dumps({'evidenceFiles': len(list(evidence.iterdir())), 'measuredHead': head,
                  'publicProductionDataIncluded': False}))
