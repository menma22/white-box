import json
from pathlib import Path

root = Path(__file__).parent
data = json.loads((root / 'pr24-inventory.json').read_text(encoding='utf-8'))
purposes = {
    'P01': 'Validate, calculate, expose and persist weekly allocations and external fixed schedules',
    'P02': 'Preserve optional legacy data and immutable record identity when saving new metadata',
    'P03': 'Edit and inspect weekly allocations and external schedules when needed',
    'P04': 'Keep independent Project Priority and include it in task recommendation/display',
    'P05': 'Edit structured Task context and linked Notes, and show context when restarting work',
    'P06': 'Await and freeze editor saves before close, task switch, import and quit; veto failed transitions',
    'P07': 'Retain uncommitted weekly input under a Database-specific draft profile across restart',
    'P08': 'Present planning and context controls using existing tokens and fixed Storybook states',
    'P09': 'Test desktop, core and contracts acceptance and failure boundaries',
    'P10': 'Test renderer draft retention and editor save coordination',
    'P11': 'Exercise source and packaged app behavior through real IPC, UI and filesystem failures',
    'P12': 'Observe natural shutdown and distinguish owned process identity from reused PIDs',
    'P13': 'Record requirements, scope, implementation decisions and reproducible validation evidence',
    'P14': 'Exclude local quit-test output from the tracked repository',
}

def purpose(unit):
    file = unit['file'].split(' b/')[-1]
    content = unit['content']
    line = unit['line'] or 0
    if file == '.gitignore': return 'P14'
    if file.startswith('docs/'): return 'P13'
    if file.startswith('scripts/'):
        return 'P12' if any(name in file for name in ['owned-processes', 'quit-observer', 'e2e-quit']) else 'P11'
    if '/tests/' in file: return 'P10' if file.startswith('apps/renderer/') else 'P09'
    if '/stories/' in file or '/styles/' in file: return 'P08'
    if file.endswith(('weekly-budget.ts', 'planning.ts', 'planning-ops.ts', 'planning-handlers.ts')) or file == 'packages/core/package.json': return 'P01'
    if file.endswith('core/src/types.ts'):
        if line == 32: return 'P04'
        if line in (44, 45, 46): return 'P05'
        return 'P01'
    if file.endswith('contracts/src/schemas.ts'):
        if line == 54: return 'P04'
        if line in (67, 68, 69): return 'P05'
        return 'P01'
    if file.endswith('contracts/src/index.ts'): return 'P01'
    if file.endswith('contracts/src/commands.ts'):
        if 'problems:' in content or 'decisions:' in content or 'nextContext:' in content: return 'P05'
        if 'patch: ProjectSchema' in content or 'patch: TaskSchema' in content: return 'P02'
        return 'P01'
    if file.endswith('domain/task-ops.ts'):
        if any(name in content for name in ['problems', 'decisions', 'nextContext']): return 'P05'
        if 'priority' in content: return 'P04'
        return 'P02'
    if file.endswith(('infra/store.ts', 'app/commit.ts')): return 'P02'
    if file.endswith('app/handlers.ts'):
        if 'createPlanningHandlers' in content: return 'P01'
        if 'taskOps.createProject' in content or 'taskOps.updateProject' in content: return 'P02'
        return 'P06'
    if file.endswith('app/state.ts'): return 'P06' if 'preparingQuit' in content or 'pendingReview:' in content else 'P01'
    if file.endswith('infra/windows.ts') and ('draftProfile' in content or 'setWindowDraftProfile' in content): return 'P07'
    if file.endswith('presentation/main.ts') and 'setWindowDraftProfile(createHash' in content: return 'P07'
    if file.startswith('apps/desktop/src/'): return 'P06'
    if file.endswith(('WeeklyBudget.tsx', 'budget-drafts.ts')): return 'P07'
    if file.endswith(('FixedWorkEditor.tsx', 'FixedWorkOverview.tsx', 'TodayView.tsx', 'WeekView.tsx')): return 'P03'
    if file.endswith(('ProjectEditor.tsx', 'TaskRiskSummary.tsx', 'TaskWarnings.tsx', 'task-priority.ts', 'selectors.ts')): return 'P04'
    if file.endswith(('TaskContextEditor.tsx', 'TaskLinkedNotes.tsx', 'RestartContext.tsx', 'StartWindow.tsx', 'NoteEditor.tsx')): return 'P05'
    if file.endswith('BoardView.tsx'):
        if any(name in content for name in ['ProjectEditor', 'editingProject', 'projectToEdit', 'activeProject', 'priority', '重要度', '重要なプロジェクト']): return 'P04'
        if 'FixedWorkOverview' in content: return 'P03'
        return 'P06'
    if file.endswith('TaskDetail.tsx'):
        if 'FixedWorkOverview' in content: return 'P03'
        if 'TaskRiskSummary control=' in content: return 'P04'
        if any(name in content for name in ['TaskContextEditor', 'notes', 'Notes', 'メモ', 'placeholder=', 'rows={3}', '<textarea', '</textarea', 'value={notes}', 'onChange={(e) => setNotes', 'className="detail-field"']): return 'P05'
        if unit['kind'] == 'deleted' and 178 <= line <= 192: return 'P05'
        return 'P06'
    if file.endswith('CurrentWorkWindow.tsx'):
        if 'TaskContextEditor' in content or 'RestartContext' in content or 'この仕事の文脈' in content: return 'P05'
        return 'P06'
    if file.endswith('MainWindow.tsx'):
        if any(name in content for name in ['budgetDraft', 'BudgetDraft', 'draftProfileKey']): return 'P07'
        return 'P06'
    if file.endswith('bridge.ts') and ('draftProfileKey' in content): return 'P07'
    if file.endswith(('bridge.ts', 'editor-flush.ts', 'useEditorFlush.ts', 'GoalTasks.tsx')): return 'P06'
    raise ValueError(f'Unclassified changed unit {unit["id"]}: {file}')

assigned = {'fingerprint': data['fingerprint'], 'purposes': purposes,
            'assignments': {unit['id']: purpose(unit) for unit in data['units']}}
(root / 'pr24-assignments.json').write_text(json.dumps(assigned, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'units': len(data['units']), 'purposes': len(purposes), 'fingerprint': data['fingerprint']}))
