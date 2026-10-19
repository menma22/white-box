import json
from pathlib import Path

folder = Path(__file__).resolve().parent
root = folder.parent.parent
inventory = json.loads((folder / 'repair-inventory.json').read_text(encoding='utf-8'))
purposes = {
    'R1': 'Validate DB load/import/export, preserve original records, and roll back failed atomic changes',
    'R2': 'Preserve session timestamp, closure, heartbeat, recovery, and task-management pause consistency',
    'R3': 'Validate task parent/dependency graphs and traverse deep valid structures without losing control rules',
    'R4': 'Retain task context/title/note drafts, reject stale writes, and flush safely before transitions',
    'R5': 'Retain optional duration drafts during saves/failures without replacing unfinished input',
    'R6': 'Preserve DST/day boundaries, Date-valid inputs, monthly history, and complete aggregate totals',
    'R7': 'Restrict the unit-test runner to canonical package test directories',
}

assignments = {}
for unit in inventory['units']:
    file = unit['file'].split(' b/', 1)[1]
    line = unit.get('line') or 0
    content = unit.get('content', '')
    if file == 'vitest.config.ts':
        purpose = 'R7'
    elif file == 'apps/desktop/src/app/handlers.ts':
        if 'assertTaskContextUnchanged' in content:
            purpose = 'R4'
        elif unit['hunk'] in [1, 15, 16, 17, 24]:
            purpose = 'R2'
        else:
            purpose = 'R1'
    elif file == 'apps/desktop/src/domain/task-ops.ts':
        purpose = 'R4' if unit['hunk'] == 4 else 'R3'
    elif file == 'apps/desktop/src/infra/store.ts':
        purpose = 'R3' if 'validateTaskHierarchy' in content else 'R2' if unit['hunk'] == 5 else 'R1'
    elif file == 'apps/desktop/src/infra/database-validation.ts':
        if line in [29, 30, 33, 42, 44, 47, 56, 57, 58, 59]:
            purpose = 'R6'
        elif 31 <= line <= 49 and line != 32:
            purpose = 'R2'
        else:
            purpose = 'R1'
    elif file == 'apps/desktop/tests/storage-integrity.test.ts':
        if line in [9, 10, 11] or 104 <= line <= 120 or 129 <= line <= 166 or line >= 227:
            purpose = 'R6' if 112 <= line <= 116 else 'R2'
        elif 121 <= line <= 128:
            purpose = 'R3'
        else:
            purpose = 'R1'
    elif file == 'packages/contracts/src/commands.ts':
        purpose = 'R4' if unit['hunk'] == 1 else 'R6'
    elif file == 'packages/contracts/tests/commands.test.ts':
        purpose = 'R6'
    elif file in ['apps/desktop/src/app/lifecycle.ts', 'apps/desktop/src/domain/session-ops.ts', 'apps/desktop/tests/session-boundaries.test.ts']:
        purpose = 'R2'
    elif file in ['apps/desktop/src/infra/dataio.ts', 'apps/desktop/src/presentation/main.ts', 'apps/desktop/tests/dataio.test.ts']:
        purpose = 'R1'
    elif file in ['apps/desktop/src/domain/task-hierarchy.ts', 'apps/desktop/tests/task-hierarchy.test.ts', 'packages/core/src/task-control.ts', 'packages/core/tests/task-control.test.ts']:
        purpose = 'R3'
    elif 'optional-duration-draft' in file or 'OptionalDurationField' in file:
        purpose = 'R5'
    elif file in ['packages/core/src/activity.ts', 'packages/core/src/engine.ts', 'packages/core/tests/activity.test.ts', 'packages/core/tests/engine.test.ts', 'apps/renderer/src/lib/selectors.ts', 'apps/renderer/src/features/history/HistoryView.tsx', 'apps/renderer/src/styles/screens/history.css']:
        purpose = 'R6'
    elif file.startswith('apps/renderer/') or file in ['apps/desktop/src/app/note-handlers.ts', 'apps/desktop/src/domain/note-ops.ts', 'apps/desktop/tests/context-conflicts.test.ts', 'apps/desktop/tests/note-ops.test.ts', 'packages/contracts/src/notes.ts', 'packages/contracts/tests/notes.test.ts']:
        purpose = 'R4'
    else:
        raise ValueError(f'Unclassified file: {file}')
    assignments[unit['id']] = purpose

deleted_tests = [unit for unit in inventory['units'] if '/tests/' in unit['file'] and unit['kind'] == 'deleted']
preserved_imports = []
for unit in deleted_tests:
    original = unit['content']
    if not original.startswith('import {'):
        raise ValueError(f'Deleted test guarantee needs manual tracing: {unit}')
    names = [name.strip() for name in original.split('{', 1)[1].split('}', 1)[0].split(',')]
    replacement = next((candidate['content'] for candidate in inventory['units'] if candidate['file'] == unit['file'] and candidate['kind'] == 'added' and candidate['content'].startswith('import {') and all(name in candidate['content'] for name in names)), None)
    if replacement is None:
        raise ValueError(f'Original test imports are not all retained: {unit}')
    preserved_imports.append({'unit': unit['id'], 'file': unit['file'], 'originalNames': names, 'replacement': replacement})

conditions = {
    'R1': {
        'required': 'Reject malformed/incompatible DB before replacement; preserve recognized legacy defaults and historical deleted references; failed saves must not leak into subsequent saves; export must not overwrite live DB files.',
        'sources': ['docs/product-spec.md', 'docs/stories/20261006_story_phase2-completion.md', 'docs/reviews/20261006-strict-pr-review/pr-21.md', 'docs/reviews/20261006-strict-pr-review/pr-24.md'],
        'evidence': ['apps/desktop/tests/storage-integrity.test.ts', 'apps/desktop/tests/dataio.test.ts'],
    },
    'R2': {
        'required': 'Reject future live starts, preserve valid historical edits, close safely after clock rollback, ignore predecessor DB heartbeat on import, and keep management time out of focus through failures/restart.',
        'sources': ['docs/product-spec.md', 'docs/stories/20261004_story_task-management-time.md', 'docs/stories/20261004_story_session-modes.md', 'docs/reviews/20261006-strict-pr-review/pr-21.md'],
        'evidence': ['apps/desktop/tests/session-boundaries.test.ts', 'apps/desktop/tests/storage-integrity.test.ts'],
    },
    'R3': {
        'required': 'Reject self/indirect/new missing parent links, preserve retained deleted references and past Sessions, validate deep acyclic dependencies, and reject cycles without call-stack failure.',
        'sources': ['CLAUDE.local.md', 'docs/stories/20261005_story_dependencies-and-external-follow-up.md', 'docs/reviews/20261006-strict-pr-review/pr-21.md'],
        'evidence': ['apps/desktop/tests/task-hierarchy.test.ts', 'packages/core/tests/task-control.test.ts'],
    },
    'R4': {
        'required': 'Keep latest drafts and conflict feedback; reject observed stale expected values; failed/unfinished writes must block navigation, close, switching and flush-triggered transitions.',
        'sources': ['docs/stories/20261006_story_phase2-completion.md', 'docs/stories/20261004_story_notes-editor.md', 'docs/reviews/20261006-strict-pr-review/pr-24.md'],
        'evidence': ['apps/desktop/tests/context-conflicts.test.ts', 'apps/desktop/tests/note-ops.test.ts', 'apps/renderer/tests/context-draft.test.ts', 'apps/renderer/tests/task-title-draft.test.ts', 'apps/renderer/tests/note-autosave.test.ts', 'apps/renderer/tests/editor-flush.test.ts'],
        'scopeLimit': 'Root observed duplicate sibling React keys after this fixed commit; its separate two-line repair and final GUI recheck are outside this comparison. Coverage does not establish every final UI condition.',
    },
    'R5': {
        'required': 'Do not clear invalid/unfinished or newer duration input on blur/failure/in-flight older saves; clear/zero meanings remain distinct.',
        'sources': ['docs/stories/20261005_story_effort-slack-aging-and-risk.md', 'docs/reviews/20261006-strict-pr-review/pr-23.md'],
        'evidence': ['apps/renderer/tests/optional-duration-draft.test.ts'],
    },
    'R6': {
        'required': 'Use local calendar day boundaries across DST, reject Date-invalid public/persistent timestamps, bound rendered history to a month while preserving complete totals and stored records.',
        'sources': ['docs/stories/20261005_story_activity-views.md', 'docs/reviews/20261006-strict-pr-review/pr-22.md'],
        'evidence': ['packages/core/tests/activity.test.ts', 'packages/core/tests/engine.test.ts', 'packages/contracts/tests/commands.test.ts', 'apps/desktop/tests/storage-integrity.test.ts'],
    },
    'R7': {
        'required': 'Run canonical apps/packages unit tests and exclude copied worktrees/probe artifacts without removing any canonical test guarantee.',
        'sources': ['CLAUDE.local.md', 'docs/architecture.md', 'docs/verification.md'],
        'evidence': ['vitest.config.ts'],
    },
}
for purpose in conditions.values():
    purpose['verdict'] = 'See primary ledgers and final integration gates; line coverage alone is not a semantic pass'
    for source in purpose['sources'] + purpose['evidence']:
        if not (root / source).exists():
            raise ValueError(f'Missing requirement/evidence source: {source}')

payload = {
    'fingerprint': inventory['fingerprint'], 'purposes': purposes, 'assignments': assignments,
    'comparison': {'base': inventory['base'], 'head': inventory['head'], 'workingTreeIncluded': False},
    'conditions': conditions,
    'deletedTestsReview': {'deletedLineCount': len(deleted_tests), 'removedAssertionCount': 0,
                           'originalGuaranteesRetained': True, 'preservedImports': preserved_imports},
}
(folder / 'repair-assignments.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'assignedUnits': len(assignments), 'deletedTestLines': len(deleted_tests), 'removedAssertions': 0}))
