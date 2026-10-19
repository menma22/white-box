import json
import re
from pathlib import Path

root = Path.cwd()
source = root / 'artifactreview/strict-20261006'
review = root / 'docs/reviews/20261006-strict-pr-review'
destination = review / 'evidence'
destination.mkdir(exist_ok=True)

for number in range(21, 25):
    for kind in ('inventory', 'assignments'):
        name = f'pr{number}-{kind}.json'
        data = json.loads((source / name).read_text(encoding='utf-8-sig'))
        (destination / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

for kind in ('inventory', 'assignments'):
    name = f'repair-{kind}.json'
    data = json.loads((source / name).read_text(encoding='utf-8-sig'))
    (destination / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')

fixtures = {
    'storage-malformed-after-import.json': Path('C:/Users/mahim/AppData/Local/Temp/white-box-pr21-strict-H7KUYm/malformedSession/data.json'),
    'storage-future-after-import.json': Path('C:/Users/mahim/AppData/Local/Temp/white-box-pr21-strict-H7KUYm/future/data.json'),
    'storage-heartbeat-after-import.json': Path('C:/Users/mahim/AppData/Local/Temp/white-box-pr21-heartbeat-wKTuZR/data.json'),
}
for name, fixture in fixtures.items():
    data = json.loads(fixture.read_text(encoding='utf-8-sig'))
    (destination / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

prefix = root.as_posix() + '/'
for file in review.glob('*.md'):
    content = file.read_text(encoding='utf-8')
    content = re.sub(r'\(<'+re.escape(prefix)+r'docs/([^>]+)>\)', lambda match: '(../../'+match[1]+')', content)
    content = re.sub(r'\(<'+re.escape(prefix)+r'(apps|packages)/([^>]+)>\)', lambda match: '(../../../'+match[1]+'/'+match[2]+')', content)
    content = re.sub(r'\(<'+re.escape(prefix)+r'artifactreview/strict-20261006/(pr\d+-(?:inventory|assignments)\.json)>\)', lambda match: '(evidence/'+match[1]+')', content)
    content = re.sub(r'\(../../../artifactreview/strict-20261006/(pr\d+-(?:inventory|assignments)\.json)\)', lambda match: '(evidence/'+match[1]+')', content)
    for name, fixture in fixtures.items():
        content = content.replace('(' + fixture.as_posix() + ')', '(evidence/' + name + ')')
    file.write_text(content, encoding='utf-8')

print('Exported eight original fixed-head coverage artifacts and portable documentation links.')
