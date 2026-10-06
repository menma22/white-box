import hashlib
import json
import re
import sys
from pathlib import Path

root = Path.cwd()
log = root / sys.argv[1]
raw = log.read_bytes()
encoding = 'utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
text = raw.decode(encoding)
paths = list(dict.fromkeys(re.findall(r'(?:Evidence|Screenshots|画像と隔離記録): ([^\r\n]+)', text)))
runs = []
for value in paths:
    path = Path(value)
    result_path = path / 'result.json'
    result = json.loads(result_path.read_text(encoding='utf-8-sig')) if result_path.exists() else {}
    raw_checks = result.get('checks', [])
    checks_present = result_path.exists() and isinstance(raw_checks, list) and all(isinstance(c, dict) for c in raw_checks)
    checks = raw_checks if checks_present else []
    runs.append({
        'directory': path.relative_to(root).as_posix(),
        'exitCode': result.get('exitCode'),
        'startedAt': result.get('startedAt'),
        'completedAt': result.get('completedAt'),
        'passed': sum(c.get('passed') is True for c in checks) if checks_present else None,
        'failed': sum(c.get('passed') is False for c in checks) if checks_present else None,
        'structuredResultPresent': result_path.exists(),
        'structuredChecksPresent': checks_present,
        'resultSha256': hashlib.sha256(result_path.read_bytes()).hexdigest() if result_path.exists() else None,
        'failedChecks': [c for c in checks if c.get('passed') is False],
    })
summary = {
    'log': log.relative_to(root).as_posix(),
    'logSha256': hashlib.sha256(raw).hexdigest(),
    'runs': runs,
    'scope': 'Structured checks are not available from every script; use process exit and log for those scripts.',
}
if len(sys.argv) > 2:
    (root / sys.argv[2]).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(summary, ensure_ascii=False, indent=2))
