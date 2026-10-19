from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
PUBLIC = ROOT / 'docs/reviews/20261006-strict-pr-review/evidence'
BASE = '97e583d59ac39e43d3570fb9173a3ecf77c1bec7'
HEAD = '125026f7088487a429170f6276786a13f0e40c4c'
FINGERPRINT = '82bf060cb087935cea75de51d7837b168d56e5d4feea4889ec342af556fdde3e'
PURPOSE = 'PshutdownRecoveryCheckpoint'

inventory = json.loads((HERE / 'checkpoint-repair-inventory.json').read_text(encoding='utf-8'))
assert (inventory['base'], inventory['head'], inventory['fingerprint']) == (BASE, HEAD, FINGERPRINT)
units = inventory['units']
counts = Counter(unit['kind'] for unit in units)
assert len(units) == 61 and counts == {'added': 56, 'deleted': 5}
assert {unit['id'] for unit in units} == {str(number) for number in range(1, 62)}

probe_paths = {
    'baseline': 'artifactreview/strict-20261006/shutdown-heartbeat-check/run-ZNk8kJ/results.json',
    'fixed': 'artifactreview/strict-20261006/shutdown-heartbeat-check/run-Ygtt2H/results.json',
}
probes = {}
for phase, filename in probe_paths.items():
    path = ROOT / filename
    data = json.loads(path.read_text(encoding='utf-8'))
    commit = BASE if phase == 'baseline' else HEAD
    for source, expected in data['provenance'].items():
        committed = subprocess.check_output(['git', '-C', str(ROOT), 'show', f'{commit}:{source}'])
        assert sha256(committed).hexdigest() == expected
    by_fault = {result['fault']: result for result in data['results']}
    assert set(by_fault) == {'none', 'runtime-write', 'runtime-rename'}
    assert by_fault['none']['shutdown']['canceled'] is False
    assert by_fault['none']['activeRecordedMs'] == 3_600_000 and by_fault['none']['unrecordedFocusMs'] == 0
    for fault in ['runtime-write', 'runtime-rename']:
        result = by_fault[fault]
        shutdown = result['shutdown']
        assert shutdown['injectedFaults'] == (1 if fault == 'runtime-write' else 4)
        assert shutdown['periodicInjectedFaults'] == (19 if fault == 'runtime-write' else 76)
        if phase == 'baseline':
            assert shutdown['canceled'] is False and shutdown['tickerRunning'] is False
            assert shutdown['databaseRenames'] == 1 and result['unrecordedFocusMs'] == 300_000
            assert result['activeRecordedMs'] == 3_300_000
        else:
            assert shutdown['canceled'] is True and shutdown['tickerRunning'] is True
            assert shutdown['quitting'] is False and shutdown['databaseRenames'] == 0
            assert shutdown['databaseFinalMarkerSaved'] is False
            assert shutdown['heartbeatAfterShutdown'] == result['timestamps']['lastGoodAliveAt']
    probes[phase] = {'path': filename, 'sha256': sha256(path.read_bytes()).hexdigest(), 'matched_commit': commit, 'source_provenance_matches_commit': True, 'expected_cancellation': data['expectedCancellation']}

sources = [
    {'path': 'docs/decisions.md', 'lines': '226-234', 'primary_requirement': 'Decision025 requires the recovery marker and database to save before stopping services; any save failure cancels shutdown and displays an error.'},
    {'path': 'docs/stories/20261006_story_phase2-completion.md', 'lines': '15-20,24,32-33', 'primary_requirement': 'Cancel failed shutdown and permit continued work; await renderer preparation; do not claim the historical unreproduced native hang is solved.'},
    {'path': 'docs/product-spec.md', 'lines': '99-107', 'primary_requirement': 'Declared execution records must preserve what/when work occurred.'},
    {'path': 'docs/architecture.md', 'lines': '117-140', 'primary_requirement': 'Recovery uses the latest successful marker/action; ordinary periodic marker failure remains best-effort and previous committed files remain intact.'},
]
for source in sources:
    source['content_sha256_at_classification'] = sha256((ROOT / source['path']).read_bytes()).hexdigest()

result = {
    'fingerprint': FINGERPRINT,
    'comparison': {'repository': 'menma22/white-box', 'base': BASE, 'head': HEAD, 'working_tree_included': False, 'scope': 'Only the additional required shutdown recovery-checkpoint repair. Preserve all prior 97e583d purpose inventories and suite evidence as historical snapshots.'},
    'purposes': {PURPOSE: 'Require a successful recovery checkpoint before final shutdown persistence/service stop, while preserving existing periodic best-effort heartbeat behavior; synchronize StorePort/actual Store/prepareQuit and add two real-Store write/rename fault regressions with the actual prepareQuit wired into the test SystemPort.'},
    'assignments': {unit['id']: PURPOSE for unit in units},
    'coverage': {'files': len({unit['file'] for unit in units}), 'hunks': len({(unit['file'], unit['hunk']) for unit in units}), 'units': len(units), 'added': counts['added'], 'deleted': counts['deleted'], 'metadata': counts['metadata'], 'purposes': 1, 'missing': 0, 'duplicate_assignments': 0, 'deleted_tests_or_comments': 0},
    'counts_by_purpose': {PURPOSE: {'added': 56, 'deleted': 5, 'metadata': 0}},
    'classification_groups': [
        {'units': '1-2', 'path': 'apps/desktop/src/app/lifecycle.ts:120', 'purpose': PURPOSE, 'rationale': 'Opt in at the mandatory shutdown checkpoint; existing catch resets quitting and rethrows before database save or ticker stop.'},
        {'units': '3-4', 'path': 'apps/desktop/src/app/ports.ts:13', 'purpose': PURPOSE, 'rationale': 'Optional port argument carries the mandatory checkpoint requirement without invalidating zero-argument callers/adapters.'},
        {'units': '5-9', 'path': 'apps/desktop/src/infra/store.ts:201', 'purpose': PURPOSE, 'rationale': 'Real Store retains the same temp-write/bounded rename mechanism and rethrows only under explicit requireSuccess; ordinary marker calls still swallow write/rename failure.'},
        {'units': '10-11', 'path': 'apps/desktop/tests/store-save.test.ts:10', 'purpose': PURPOSE, 'rationale': 'Import actual prepareQuit alongside existing actual recovery instead of testing an unconnected fake quit action.'},
        {'units': '12-61', 'path': 'apps/desktop/tests/store-save.test.ts:161', 'purpose': PURPOSE, 'rationale': 'Two fault cases traverse receive/handler/test SystemPort/real prepareQuit/real Store, assert canceled stop and unchanged bytes, retry normally, then reload/recover the successful checkpoint.'},
    ],
    'primary_sources': sources,
    'explicit_scope': 'Parent authorized this required-checkpoint repair, retained periodic best-effort compatibility, prohibited source/QA/build/UI edits for this audit, and supplied fixed base/head. Current document hashes identify requirements read; documentary publication is outside this comparison.',
    'conditions': [
        {'id': 'C1', 'verdict': 'satisfied', 'condition': 'Successful no-fault shutdown saves the exact quit-time marker and final database before stopping ticker; restart retains the full declared interval.', 'sources': ['Decision025', 'completion-story:17'], 'evidence': [probe_paths['baseline'], probe_paths['fixed'], 'apps/desktop/src/app/lifecycle.ts:117'], 'observed': 'Both control probes record 60 minutes, one DB rename, updated quit marker and zero lost focus.'},
        {'id': 'C2', 'verdict': 'satisfied', 'condition': 'A required marker write or replacement failure cancels shutdown, clears quitting, keeps ticker active, preserves old marker/database bytes, and does not perform final DB rename.', 'sources': ['Decision025', 'completion-story:16-17'], 'evidence': [probe_paths['fixed'], 'apps/desktop/tests/store-save.test.ts:161'], 'observed': 'Both fixed real-Store probe faults cancel, keep tickerRunning=true and databaseRenames=0. Committed tests add exact DB/marker-byte assertions.'},
        {'id': 'C3', 'verdict': 'satisfied', 'condition': 'Fault removal allows a normal retry and restart recovery retains the new checkpoint instead of the previously stale marker.', 'sources': ['Decision025', 'completion-story:16-17'], 'evidence': ['apps/desktop/tests/store-save.test.ts:197', probe_paths['fixed']], 'observed': 'New regressions assert successful retry, ticker stop, marker at 35 minutes and fresh Store recovery at that marker. The independent fixed probe separately confirms no-fault 60-minute recovery; this audit did not rerun the new test suite.'},
        {'id': 'C4', 'verdict': 'satisfied', 'condition': 'Ordinary periodic and wake heartbeat failures remain nonthrowing; the optional flag does not change existing zero-argument calls, prior-byte preservation, or retry bounds.', 'sources': ['architecture periodic compatibility', 'explicit parent preservation scope'], 'evidence': ['apps/desktop/src/infra/store.ts:201', 'apps/desktop/src/presentation/main.ts:88', 'apps/desktop/src/presentation/main.ts:159', probe_paths['baseline'], probe_paths['fixed']], 'observed': 'Both probes tolerate all 19 failed periodic writes or 76 failed bounded periodic rename attempts before quitting; only required shutdown failure now propagates.'},
        {'id': 'C5', 'verdict': 'satisfied', 'condition': 'The actual production before-quit path receives the required checkpoint error, releases prepared editors, displays the existing failure dialog, and clears preparingQuit without stopping later services.', 'sources': ['Decision025', 'completion-story:17-18'], 'evidence': ['apps/desktop/src/presentation/main.ts:169', 'apps/desktop/src/app/lifecycle.ts:117'], 'observed': 'Unchanged before-quit callback calls real prepareQuit before service stops; its existing catch/release/native-error dialog and finally reset handle the newly propagated error.'},
        {'id': 'C6', 'verdict': 'unverified', 'condition': 'Native renderer preparation, failure dialog and actual service continuation under required checkpoint faults are observed in the newly built source/package app; final whole-suite and native exit outcomes belong to the new125 snapshot.', 'sources': ['completion-story:18,20,32-33'], 'evidence': ['Parent scheduled fresh gates and 13/12 UI suites; artifacts will be independently counted after their final logs exist.'], 'observed': 'This inventory task does not run UI/build/tests. Historical97 successes are not reused as125 runtime evidence.'},
    ],
    'deleted_guarantee_checks': [
        {'units': ['1'], 'retained_guarantee': 'Shutdown still records alive time before main save and ticker stop; swallowing that mandatory failure is intentionally removed to meet Decision025.'},
        {'units': ['3', '5'], 'retained_guarantee': 'Zero-argument StorePort and actual Store callers remain compatible through optional/default options; periodic failure semantics stay best-effort.'},
        {'units': ['7'], 'retained_guarantee': 'Catch still swallows ordinary heartbeat failure and preserves the existing comment; only explicit mandatory success rethrows the original cause.'},
        {'units': ['10'], 'retained_guarantee': 'Existing restoreOpenSession import/tests remain; actual prepareQuit is added for a properly connected regression path.'},
    ],
    'independent_probe_evidence': probes,
    'reproduction': {'valid_baseline': 'run-ZNk8kJ', 'fixed_probe': 'run-Ygtt2H', 'baseline_control_minutes': 60, 'baseline_fault_recovery_minutes': 55, 'baseline_fault_loss_minutes': 5, 'fixed_fault_outcome': 'shutdown canceled; ticker continues; no final DB rename', 'excluded_baseline': 'The first root red regression used a fake SystemPort that never called prepareQuit; it does not establish the product failure. Only the independent ZNk8kJ probe is counted as the before baseline.'},
    'test_boundaries': ['New committed tests use real Store, actual receive/handlers, actual prepareQuit and actual restoreOpenSession; their SystemPort fake calls prepareQuit synchronously.', 'Production SystemPort invokes app.quit and Electron before-quit awaits renderer preparation asynchronously. The unit ok:false reply is not evidence that the actual public quit IPC returns a failure reply; production failure is surfaced by the existing native error dialog.', 'The preparingQuit=false assertion in the synchronous fake begins false; it is not a measured native true-to-false preparation transition. The production finally reset is inspected separately.', 'The probe ticker is a fake Port whose stop invocation is recorded; healthy/faulting native ticker/runtime behavior requires separate runtime evidence.', 'Exception-safety preservation does not establish physical power-loss or disk-flush durability, and does not identify the historical intermittent quit-hang root cause.'],
    'scope_exclusions': ['Renderer, core and all QA scripts are unchanged97-to125.', 'Previous97 inventories and source/package-suite tables remain byte-for-byte unmodified by this classifier.', 'Later documentary publication and newly rerun UI-suite results are separate evidence scopes.'],
}
assert {number for group in result['deleted_guarantee_checks'] for number in group['units']} == {unit['id'] for unit in units if unit['kind'] == 'deleted'}
output = HERE / 'checkpoint-repair-assignments.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
PUBLIC.mkdir(parents=True, exist_ok=True)
for filename in ['checkpoint-repair-inventory.json', 'checkpoint-repair-assignments.json']:
    (PUBLIC / filename).write_bytes((HERE / filename).read_bytes())
print(json.dumps(result['coverage']))
