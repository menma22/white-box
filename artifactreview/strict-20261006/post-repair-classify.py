from collections import Counter, defaultdict
from hashlib import sha256
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = 'e620a26a37ef56b2bcf40b8809c7c8bc5e56e9f5'
HEAD = '97e583d59ac39e43d3570fb9173a3ecf77c1bec7'
FINGERPRINT = 'e06d99e1cb840f3eb7a58d3406ef7b641cf52aedc0bd8ef548cd8f9ee9fce7d3'

PURPOSES = {
    'PstoreMarkerRecovery': 'Preserve the previous committed heartbeat and its known work after write/rename failure, using the existing bounded replacement policy without changing main-save or nonthrowing heartbeat semantics; include real-file recovery regressions.',
    'PbackupOwnedPreservation': 'Preserve write-once pre-import/quarantine recovery copies on timestamp collisions and restrict daily retention to regular files with exact valid generated daily names; retain the existing newest-thirty policy and its regressions.',
    'PmanagedExportProtection': 'Prevent exports from replacing managed live files, pending heartbeat files, recovery originals, or any reserved backup-subtree destination, including Windows casing and directory aliases; verify unchanged bytes/state and ordinary export behavior.',
    'PcontrolFailedDrafts': 'Make Blocked reason and submitted external-wait saves participate in existing editor flush: await pending saves, keep failed input/error, reject close/navigation after failure, serialize follow-up reason edits, freeze pending actions, and permit explicit retry/revert/cancellation; do not autosave unsubmitted external forms.',
    'PcontrolEditorFocus': 'Honor the existing waiting-section scroll/focus request after every ancestor inert lock releases, then stop observing; retain unmount cleanup and add direct focus/lock-release evidence.',
    'PcontrolEditorIdentity': 'Give sibling waiting/context editors distinct stable task-specific React keys so reconciliation preserves exactly one functional editor of each kind and same-task input identity.',
    'PcapturedClose': 'Capture the original BrowserWindow at close reservation, retain the 150 ms reply/flush delay, and avoid closing a later reopened window, destroyed target, missing target, or window during shutdown; preserve main wiring and native preparation regressions.',
    'PnativeVisibility': 'Show Main/Current once after load or first paint without losing inactive opening, placement, shutdown/destroyed guards, or review-only first-paint behavior; verify real owned Win32 visibility before QA CDP activation.',
    'PqaReceiverIdentityTransport': 'Bind quit QA to the launched Electron identity, verified loopback browser endpoint and expected build target/session; preserve error/timeout/value handling and record receiver identity instead of relying on an unverified page endpoint.',
    'PqaRealStateEvidence': 'Add independent public IPC/UI/disk assertions for history month totals/layout, editor count/reason persistence, Task/Note conflicts, failed duration/waiting drafts and explicit resolution, and natural application exit; keep forced cleanup as failure.',
    'PqaFailureDiagnostics': 'Add opt-in isolated source quit observation and bounded before-cleanup snapshots of owned processes, renderer locks/focus/errors, IPC/flush/native events; preserve original return/throw behavior and record failed evidence without turning it into success.',
}

GROUPS = [
    (1, 14, 'PmanagedExportProtection', 'One mixed guard protects managed live/recovery namespaces; canonicalization and the shared rejection belong to that guard.'),
    (15, 16, 'PbackupOwnedPreservation', 'Quarantine copy becomes exclusive without changing failed-load abort or original-file preservation.'),
    (17, 24, 'PstoreMarkerRecovery', 'Extract and call the unchanged main-save replacement loop for reuse by heartbeat; backup remains after successful replacement.'),
    (25, 31, 'PbackupOwnedPreservation', 'Narrow the daily retention set by regular-file type, exact name, and valid calendar date.'),
    (32, 35, 'PstoreMarkerRecovery', 'Write a heartbeat temporary file before committing it through bounded rename.'),
    (36, 37, 'PbackupOwnedPreservation', 'Exclusive pre-import snapshot write prevents timestamp collision from erasing the first recovery copy.'),
    (38, 55, 'PnativeVisibility', 'Move the identical placement/focus body into a once-only show callback and add editor load fallback.'),
    (56, 69, 'PcapturedClose', 'Capture native window instances in the delayed helper and connect the WindowPort to it.'),
    (70, 151, 'PmanagedExportProtection', 'Real-file export refusal cases protect recovery snapshots, casing/aliases, the reserved subtree, quarantined originals, and runtime.tmp.'),
    (152, 191, 'PbackupOwnedPreservation', 'Two public Store collision regressions preserve first import/quarantine bytes and current DB state.'),
    (192, 280, 'PstoreMarkerRecovery', 'Six failure/retry cases verify prior marker bytes, real restart recovery, next heartbeat, and bounded rename behavior.'),
    (281, 317, 'PbackupOwnedPreservation', 'Public daily saves independently exercise unrelated-entry preservation and exactly the newest thirty generated backups.'),
    (318, 319, 'PcapturedClose', 'Import the delayed native-window helper for its new regressions.'),
    (320, 321, 'PnativeVisibility', 'EventEmitter webContents models did-finish-load independently from ready-to-show.'),
    (322, 329, 'PcapturedClose', 'Shared native-window fixture now models destruction, necessary to distinguish old/reopened targets and avoid duplicate closes; visibility also uses it.'),
    (330, 394, 'PnativeVisibility', 'Assert load-first/paint-first once-only display, inactive behavior, destroyed/shutdown guards, and unchanged review behavior.'),
    (395, 462, 'PcapturedClose', 'Restore timer state and exercise captured target identity, 150 ms preparation, and shutdown no-ops.'),
    (463, 474, 'PcontrolFailedDrafts', 'Create the real draft controller, keep its current save callback, reconcile clean reasons, and register existing flush participation.'),
    (475, 491, 'PcontrolEditorFocus', 'Split focus from draft ownership: observe only inert attributes until connected target focus succeeds or component unmounts.'),
    (492, 512, 'PcontrolFailedDrafts', 'Route reason/external submission through the draft controller and preserve controls, form values, failures, and explicit cancellation.'),
    (513, 516, 'PcontrolEditorIdentity', 'Distinct control/context key prefixes preserve sibling identity without recreating the same-task editor.'),
    (517, 721, 'PcontrolFailedDrafts', 'New draft-controller file and seven behavioral tests, including both new-file metadata units; reason/external/flush are one close-preservation responsibility.'),
    (722, 748, 'PqaRealStateEvidence', 'History paging preserves independent totals; dependency pointer flow confirms one editor of each kind and persisted reason.'),
    (749, 760, 'PqaFailureDiagnostics', 'Dependency failure-only DOM/lock/focus/error capture preserves the original test failure.'),
    (761, 787, 'PqaRealStateEvidence', 'Public cross-window Task and linked Note edits check both texts, blocked close/autosave, and explicit resolution.'),
    (788, 860, 'PqaReceiverIdentityTransport', 'Replace unverified page CDP with a verified browser/PID/build/session transport; preserve value, error, close, and timeout paths.'),
    (861, 862, 'PqaFailureDiagnostics', 'Shared spawnSync import primarily supports bounded live native-process diagnostics; it also supports native visibility evidence.'),
    (863, 863, 'PqaReceiverIdentityTransport', 'Import exact process identity/ownership helpers used to bind diagnostic receivers to the launched app.'),
    (864, 867, 'PqaFailureDiagnostics', 'Source-only observer and optional kept-page branch require explicit diagnostic opt-in and reject package misuse.'),
    (868, 869, 'PqaReceiverIdentityTransport', 'Hold launch identity and the owned-process registry rather than using only numeric PID.'),
    (870, 882, 'PqaFailureDiagnostics', 'Allow bounded browser diagnostic connections/session commands; normal page defaults keep their original enable and timeout behavior.'),
    (883, 895, 'PnativeVisibility', 'Win32 probe verifies owned process identity, window owner, title, native handle, and IsWindowVisible.'),
    (896, 899, 'PqaFailureDiagnostics', 'Select trace directory and source observer entry only when opt-in is set; default launch is preserved.'),
    (900, 905, 'PqaReceiverIdentityTransport', 'Capture process creation identity and root registration for the actual launched executable.'),
    (906, 907, 'PqaFailureDiagnostics', 'Persist isolated launch context for later failed-state interpretation.'),
    (908, 913, 'PnativeVisibility', 'Assert physical Main visibility before any page CDP activation and save the measured Win32 result.'),
    (914, 984, 'PqaFailureDiagnostics', 'Collect timeout state before cleanup, retain original focus wait inside diagnostic catch, and record process/quit chronology without accepting late exit as success.'),
    (985, 992, 'PcontrolEditorFocus', 'Split this mixed hunk: successful focus assertions explicitly require target focus and every ancestor inert lock released.'),
    (993, 1041, 'PqaRealStateEvidence', 'Keep the duration failure fix and add waiting-save failure/close/persisted-state/explicit-revert-or-cancel checks.'),
    (1042, 1044, 'PqaFailureDiagnostics', 'Failure-live observation is opt-in and best-effort; capture errors are saved separately.'),
    (1045, 1062, 'PqaRealStateEvidence', 'Open the public Main quit receiver and replace successful-path child.kill with app:quit, deadline, exit-zero assertion, and failure-only cleanup.'),
    (1063, 1098, 'PqaFailureDiagnostics', 'Observer adds safe window state, flush/IPC, renderer, and native-error-box traces while forwarding original functions and outcomes.'),
]

SOURCES = {
    'Srecord': {'path': 'docs/product-spec.md', 'lines': '99-107', 'role': 'Primary invariant: meaningful work must leave what/when execution records.'},
    'Sarchitecture': {'path': 'docs/architecture.md', 'lines': '117-135', 'role': 'Storage/recovery design: preserve original/copies, temporary replacement, export protection, last heartbeat/action recovery. Supplementary current document; not added to this fixed code comparison.'},
    'Sclaude': {'path': 'CLAUDE.local.md', 'lines': '18-34', 'role': 'Local invariants: main owns session truth, 150 ms closeLater reply delay, no business-mechanism duplication in verification surfaces.'},
    'Sdependencies': {'path': 'docs/stories/20261005_story_dependencies-and-external-follow-up.md', 'lines': '9-19 and design notes', 'role': 'Primary waiting fields, save-failure rollback/error, direct focus and isolated public-IPC/UI/restart criteria; bounded rename design.'},
    'Srisk': {'path': 'docs/stories/20261005_story_effort-slack-aging-and-risk.md', 'lines': '16-21', 'role': 'Primary same-task input preservation, waiting-section direct focus, failed-state preservation, and actual UI evidence.'},
    'Scompletion': {'path': 'docs/stories/20261006_story_phase2-completion.md', 'lines': '5,15-20,24,32-33', 'role': 'Primary preserve input on failed close/move; await matched renderer flush, freeze editing, stop shutdown reopening, and do not call unreproduced quit hangs solved.'},
    'Sactivity': {'path': 'docs/stories/20261005_story_activity-views.md', 'lines': '9-16', 'role': 'Primary period/full total agreement, preserved history, minimum-width actual source/package UI evidence.'},
    'Sverification': {'path': 'docs/verification.md', 'lines': '20-21,51', 'role': 'Real event/state/file/PID evidence, isolated fixtures, baseline before fault injection, and forced cleanup never proving natural exit. Supplementary current document.'},
    'Srequest': {'kind': 'delegated explicit preservation request', 'role': 'Parent task messages on 2026-10-06 authorized only minimal recovery/backup preservation fixes, synthetic files and process-local clocks, no user-data/system-clock manipulation, source freeze and exact line-purpose coverage. This task does not claim private user fixtures were inspected.'},
    'L21': {'path': 'docs/reviews/20261006-strict-pr-review/pr-21.md', 'role': 'Evidence index for actual Store/heartbeat/import preservation defects; a review ledger is evidence, not a new primary product requirement.'},
    'L23': {'path': 'docs/reviews/20261006-strict-pr-review/pr-23.md', 'role': 'Evidence index for failed duration/input/Note preservation and original purpose map.'},
    'L24': {'path': 'docs/reviews/20261006-strict-pr-review/pr-24.md', 'lines': 'Q9-Q13', 'role': 'Evidence index for duplicate editor keys, inert focus rejection, wrong QA receiver, captured-close target, and protected export snapshots.'},
    'L22': {'path': 'docs/reviews/20261006-strict-pr-review/pr-22.md', 'role': 'Evidence index for bounded month presentation and unchanged independent all-time history totals.'},
    'Lsafe': {'path': 'docs/reviews/20261006-strict-pr-review/final-safety-review.md', 'role': 'Evidence index for independent failure/captured-close probes and their stated runtime limits.'},
}

CONDITIONS = {
    'PstoreMarkerRecovery': [
        ('satisfied', 'Failed new heartbeat preserves prior Good bytes/readLastAlive and known recovery time; next successful heartbeat/restart succeeds.', ['Srecord', 'Sarchitecture', 'Srequest'], ['apps/desktop/tests/store-save.test.ts:157', 'artifactreview/strict-20261006/heartbeat-atomic-probe/run-tmECIC/result.json', 'artifactreview/strict-20261006/heartbeat-atomic-probe/run-wQMCe6/result.json', 'artifactreview/strict-20261006/final-boundary-regressions.log:59']),
        ('satisfied', 'Shared rename retains four total attempts, retryable-code restriction, three 20 ms waits, main-save throwing semantics and heartbeat nonthrow semantics.', ['Sdependencies', 'Sarchitecture'], ['apps/desktop/src/infra/store.ts:162', 'apps/desktop/tests/store-save.test.ts:72', 'apps/desktop/tests/store-save.test.ts:216']),
    ],
    'PbackupOwnedPreservation': [
        ('satisfied', 'Only exact valid daily regular files are counted/pruned, newest thirty remain, and unrelated file bytes/directories survive.', ['Srecord', 'Srequest', 'Sarchitecture'], ['apps/desktop/src/infra/store.ts:187', 'apps/desktop/tests/store-save.test.ts:246', 'artifactreview/strict-20261006/final-boundary-regressions.log:59']),
        ('satisfied', 'Timestamp collisions cannot replace the first pre-import or quarantined recovery copy; failed import leaves current DB/file unchanged, and a later distinct import remains possible.', ['Srecord', 'Srequest', 'Sarchitecture'], ['apps/desktop/src/infra/store.ts:146', 'apps/desktop/src/infra/store.ts:223', 'apps/desktop/tests/store-save.test.ts:31', 'artifactreview/strict-20261006/final-boundary-regressions.log:59']),
    ],
    'PmanagedExportProtection': [
        ('satisfied', 'Export refuses live/pending/recovery/backup-namespace destinations before writing; Windows casing and existing-directory aliases do not bypass the guard.', ['Srecord', 'Srequest', 'Sarchitecture'], ['apps/desktop/src/infra/dataio.ts:21', 'apps/desktop/tests/dataio.test.ts:80', 'artifactreview/strict-20261006/final-boundary-regressions.log:6']),
    ],
    'PcontrolFailedDrafts': [
        ('satisfied', 'Pending/failed reason or submitted external saves block flush/close, preserve entered values, survive old notifications, support retry/revert/cancel, and wait for both parallel submitted responsibilities.', ['Sdependencies', 'Srisk', 'Scompletion'], ['apps/renderer/src/features/board/task-control-draft.ts:25', 'apps/renderer/src/lib/useEditorFlush.ts:24', 'apps/renderer/tests/task-control-draft.test.ts:13', 'artifactreview/strict-20261006/final-boundary-regressions.log:4']),
        ('unverified', 'Final frozen build visibly preserves failed waiting form/input/error across pointer close and explicit resolution in both source and package flows.', ['Sdependencies', 'Srisk', 'Scompletion'], ['scripts/e2e-task-priority.mjs:523', 'docs/reviews/20261006-strict-pr-review/pr-23.md']),
    ],
    'PcontrolEditorFocus': [
        ('satisfied', 'Requested target scroll/focus waits for connected non-inert ancestors and observer stops after success or unmount, while the original focus behavior remains.', ['Sdependencies', 'Srisk'], ['apps/renderer/src/features/board/TaskControlEditor.tsx:26', 'scripts/e2e-task-priority.mjs:330', 'L24']),
        ('unverified', 'Actual final source/package focus reaches the waiting target after ancestor locks release.', ['Sdependencies', 'Srisk'], ['scripts/e2e-task-priority.mjs:343', 'artifactreview/strict-20261006/priority-focus-before.log', 'artifactreview/strict-20261006/priority-focus-after.log']),
    ],
    'PcontrolEditorIdentity': [
        ('satisfied', 'Sibling editor keys differ but remain task-stable; dedicated UI checks still require one waiting editor, one context editor and persisted reason.', ['Sdependencies', 'Srisk'], ['apps/renderer/src/features/board/TaskDetail.tsx:196', 'scripts/e2e-dependencies.mjs:293', 'L24']),
        ('unverified', 'Final frozen source/package pointer flow and restart retain one functional editor each.', ['Sdependencies', 'Srisk'], ['scripts/e2e-dependencies.mjs:293']),
    ],
    'PcapturedClose': [
        ('satisfied', '150 ms close addresses only captured original instances, respects native input preparation and shutdown guards, and cannot close a subsequently created/reopened instance.', ['Sclaude', 'Scompletion'], ['apps/desktop/src/infra/windows.ts:281', 'apps/desktop/src/presentation/main.ts:100', 'apps/desktop/tests/windows-shutdown.test.ts:109', 'artifactreview/strict-20261006/final-boundary-regressions.log:5']),
    ],
    'PnativeVisibility': [
        ('satisfied', 'Main/Current load-first and paint-first both show once with placement/inactive behavior retained; destroyed/shutdown windows never show and review remains paint-dependent.', ['Scompletion', 'Srequest'], ['apps/desktop/src/infra/windows.ts:225', 'apps/desktop/tests/windows-shutdown.test.ts:36', 'artifactreview/strict-20261006/final-boundary-regressions.log:5']),
        ('unverified', 'The final frozen Main is physically Win32-visible on its owned PID before any CDP activation.', ['Scompletion', 'Sverification'], ['scripts/e2e-task-priority.mjs:101', 'scripts/e2e-task-priority.mjs:144']),
    ],
    'PqaReceiverIdentityTransport': [
        ('satisfied', 'Quit QA refuses non-loopback/wrong-port/credentialed/non-browser endpoints, mismatched browser PID/build target/session, stale process identity, and changed evaluation URL; preserve rejection and bounded timeout/value behavior.', ['Scompletion', 'Sverification', 'Srequest'], ['scripts/e2e-quit.mjs:47', 'scripts/e2e-quit.mjs:88', 'scripts/e2e-quit.mjs:120', 'L24']),
        ('unverified', 'Frozen source quit QA completes real transport and failure behavior under the actual protocol/runtime; protocol inspection is not a runtime pass and this source-only quit script does not claim package support.', ['Scompletion', 'Sverification'], ['scripts/e2e-quit.mjs:88']),
    ],
    'PqaRealStateEvidence': [
        ('satisfied', 'Changed QA asserts public result and saved/DOM state rather than reproducing business transitions: month/all-time totals, conflicts, failed input, explicit resolution and natural exit with failure-only cleanup.', ['Sactivity', 'Sdependencies', 'Srisk', 'Scompletion', 'Sclaude', 'Sverification'], ['scripts/e2e-activity.mjs:378', 'scripts/e2e-dependencies.mjs:293', 'scripts/e2e-phase2-planning.mjs:512', 'scripts/e2e-task-priority.mjs:502', 'scripts/e2e.mjs:329']),
        ('unverified', 'All added QA expectations pass against the final frozen source and package, with real pixels, no unexpected renderer errors and truthful process outcomes.', ['Scompletion', 'Sverification'], ['docs/reviews/20261006-strict-pr-review/README.md']),
    ],
    'PqaFailureDiagnostics': [
        ('satisfied', 'Observer is explicit source-only opt-in; failure capture uses launch/process/build identity and bounded calls before cleanup; wrappers forward original arguments, this, values and throws and never accept forced cleanup as successful natural exit.', ['Scompletion', 'Sverification', 'Srequest'], ['scripts/e2e-task-priority.mjs:12', 'scripts/e2e-task-priority.mjs:153', 'scripts/e2e-task-priority.mjs:198', 'scripts/quit-observer.mjs:26']),
        ('unverified', 'The intermittent native quit hang is causally identified; before-cleanup native-timeout capture and keep-page branch are exercised under the final frozen script.', ['Scompletion', 'Sverification'], ['artifactreview/strict-20261006/priority-quit-diagnosis.json']),
    ],
}

DELETION_GROUPS = [
    ([1, 2, 3], 'Existing live-file export rejection remains in the canonical managed namespace guard; Windows casing remains case-insensitive and aliases/new backup destinations receive stronger protection.', ['apps/desktop/src/infra/dataio.ts:21', 'apps/desktop/tests/dataio.test.ts:99']),
    ([15], 'Failed-load original remains untouched and startup still aborts; exclusive quarantine copy additionally prevents an earlier recovery original from being overwritten.', ['apps/desktop/src/infra/store.ts:146', 'apps/desktop/tests/store-save.test.ts:56']),
    ([22, 24], 'Rename loop and backup-after-success order move into helper/call wiring; original main save retry and rollback cases remain, without increasing retry bounds.', ['apps/desktop/src/infra/store.ts:155', 'apps/desktop/tests/store-save.test.ts:72']),
    ([25], 'Keep-thirty sorted retention remains; only unsupported prefix-owned entries leave the deletion set. No retention test is removed.', ['apps/desktop/src/infra/store.ts:187', 'apps/desktop/tests/store-save.test.ts:246']),
    ([32], 'Heartbeat format/read API/caught failure semantics remain; direct overwrite is replaced by temporary commit and prior-byte/restart assertions.', ['apps/desktop/src/infra/store.ts:201', 'apps/desktop/tests/store-save.test.ts:157']),
    ([36], 'Pre-import snapshot still precedes DB replacement; wx makes collision fail before replacing either old recovery copy or current DB.', ['apps/desktop/src/infra/store.ts:223', 'apps/desktop/tests/store-save.test.ts:31']),
    (list(range(49, 56)), 'Original placement/focused-versus-inactive show body and guards move into once-only callback; review remains ready-to-show only.', ['apps/desktop/src/infra/windows.ts:225', 'apps/desktop/tests/windows-shutdown.test.ts:36']),
    ([66, 68, 318], 'WindowPort still provides 150 ms delayed native close and input preparation; native instance capture replaces late name lookup and helper import/wiring is explicit.', ['apps/desktop/src/presentation/main.ts:23', 'apps/desktop/src/presentation/main.ts:100', 'apps/desktop/tests/windows-shutdown.test.ts:109']),
    ([320, 323, 325], 'Only shared mock internals change to model load events/destruction. Existing shutdown cases remain; no test or explanatory comment is deleted.', ['apps/desktop/tests/windows-shutdown.test.ts:9', 'apps/desktop/tests/windows-shutdown.test.ts:102']),
    ([465, 492], 'Reason string, user edit and blur save remain through the draft controller; pending/failure/old-notification behavior now has independent regressions.', ['apps/renderer/src/features/board/TaskControlEditor.tsx:13', 'apps/renderer/tests/task-control-draft.test.ts:13']),
    ([475, 476, 477], 'Original scroll and preventScroll focus operations remain inside a guarded retry; cleanup prevents observer retention after unmount/success.', ['apps/renderer/src/features/board/TaskControlEditor.tsx:26', 'scripts/e2e-task-priority.mjs:343']),
    ([494, 495, 498, 499, 500, 501, 502, 503, 504], 'All who/what/since/last-contact/follow-up values, null handling, required fields, save success and explicit cancellation remain. Added pending locks/error/flush preserve submitted failures rather than discarding them.', ['apps/renderer/src/features/board/TaskControlEditor.tsx:72', 'apps/renderer/tests/task-control-draft.test.ts:72']),
    ([513, 515], 'Task-specific key stability remains; component-specific prefixes remove sibling collision without changing props or recreating repeated same-task selection.', ['apps/renderer/src/features/board/TaskDetail.tsx:196', 'scripts/e2e-dependencies.mjs:293']),
    ([788, 812, 813, 814, 824, 826, 828, 829, 833, 836, 837, 838], 'fileURLToPath import, socket-close rejection, exceptionDetails/error propagation, 5 s evaluation timeout and returned by-value result remain in verified browser/session send plus evaluate; unverified raw page receiver is intentionally replaced.', ['scripts/e2e-quit.mjs:88', 'scripts/e2e-quit.mjs:99', 'scripts/e2e-quit.mjs:109', 'scripts/e2e-quit.mjs:132']),
    ([861, 870, 872, 874, 876, 878, 880, 881, 896, 898], 'spawn/default source launch, Runtime/Log enable, normal 10 s command timeout and 30 s screenshot timeout remain; optional session/browser timeout/observer entry support isolated diagnostics only.', ['scripts/e2e-task-priority.mjs:52', 'scripts/e2e-task-priority.mjs:116']),
    ([961, 968], 'Default page-close timing remains when keep-page is false and all original quit observation fields remain; added fields distinguish timeout, late exit, cleanup and identity.', ['scripts/e2e-task-priority.mjs:230', 'scripts/e2e-task-priority.mjs:247']),
    ([971], 'The identical waiting-editor focus wait is reintroduced in try/catch before stronger successful focus/ancestor assertions; failed diagnostic capture does not make the wait pass.', ['scripts/e2e-task-priority.mjs:330', 'scripts/e2e-task-priority.mjs:343']),
    ([1045, 1047, 1048], 'HUD startup remains and Main is added as public quit receiver. Owned child cleanup remains on failure; kill-and-sleep no longer counts as successful shutdown.', ['scripts/e2e.mjs:166', 'scripts/e2e.mjs:329']),
    ([1063, 1065], 'All original Electron imports/window fields remain; error-box and safe per-window snapshot traces only add observations. Original business return/throw behavior is forwarded.', ['scripts/quit-observer.mjs:1', 'scripts/quit-observer.mjs:12', 'scripts/quit-observer.mjs:73']),
]

inventory = json.loads((HERE / 'post-repair-inventory.json').read_text(encoding='utf-8'))
assert (inventory['base'], inventory['head'], inventory['fingerprint']) == (BASE, HEAD, FINGERPRINT)
units = {int(unit['id']): unit for unit in inventory['units']}
assignments = {}
classified_groups = []
for first, last, purpose, rationale in GROUPS:
    group_units = []
    for number in range(first, last + 1):
        assert number in units and str(number) not in assignments
        assignments[str(number)] = purpose
        group_units.append(units[number])
    locations = defaultdict(list)
    for unit in group_units:
        locations[(unit['file'], unit['kind'], unit['hunk'])].append(unit['line'])
    classified_groups.append({'units': f'{first}-{last}', 'purpose': purpose, 'rationale': rationale, 'locations': [
        {'file': file, 'kind': kind, 'hunk': hunk, 'line_first': min((line for line in lines if line is not None), default=None), 'line_last': max((line for line in lines if line is not None), default=None)}
        for (file, kind, hunk), lines in locations.items()
    ]})
assert len(assignments) == len(units) == 1098
assert set(assignments) == {str(number) for number in units}

deletion_checks = []
checked_deletions = set()
for numbers, preservation, evidence in DELETION_GROUPS:
    for number in numbers:
        assert units[number]['kind'] == 'deleted' and number not in checked_deletions
        checked_deletions.add(number)
    deletion_checks.append({'units': numbers, 'preserved_or_intentionally_replaced_guarantee': preservation, 'evidence': evidence, 'verdict': 'satisfied at source/regression-assertion boundary; final actual runtime remains separately unverified'})
assert checked_deletions == {number for number, unit in units.items() if unit['kind'] == 'deleted'}

for source in SOURCES.values():
    if 'path' in source:
        source['content_sha256_at_classification'] = sha256((ROOT / source['path']).read_bytes()).hexdigest()

totals = Counter(unit['kind'] for unit in units.values())
counts = {purpose: dict(Counter(units[int(number)]['kind'] for number, assigned in assignments.items() if assigned == purpose)) for purpose in PURPOSES}
acceptance = {purpose: [{'verdict': verdict, 'condition': condition, 'sources': sources, 'evidence': evidence} for verdict, condition, sources, evidence in conditions] for purpose, conditions in CONDITIONS.items()}
result = {
    'fingerprint': FINGERPRINT,
    'comparison': {'repository': 'menma22/white-box', 'base': BASE, 'head': HEAD, 'working_tree_included': False, 'publication_docs_included': False, 'purpose': 'Post-repair product and QA snapshot after the previous fixed repair comparison; later documentation publication requires a separate audit.'},
    'purposes': PURPOSES,
    'assignments': assignments,
    'coverage': {'files': len({unit['file'] for unit in units.values()}), 'hunks': len({(unit['file'], unit['hunk']) for unit in units.values() if unit['hunk'] is not None}), 'units': len(units), 'added': totals['added'], 'deleted': totals['deleted'], 'metadata': totals['metadata'], 'purpose_count': len(PURPOSES), 'unassigned': 0, 'duplicate_assignments': 0, 'deletions_with_preservation_checks': len(checked_deletions), 'deleted_tests_or_comments': 0},
    'counts_by_purpose': counts,
    'classification_groups': classified_groups,
    'sources': SOURCES,
    'independent_acceptance_conditions': acceptance,
    'deleted_guarantee_checks': deletion_checks,
    'evidence_read': ['artifactreview/strict-20261006/final-boundary-regressions.log:4', 'artifactreview/strict-20261006/final-boundary-regressions.log:59', 'artifactreview/strict-20261006/test.log:473', 'artifactreview/strict-20261006/test.log:1607', 'artifactreview/strict-20261006/test.log:1664', 'artifactreview/strict-20261006/test.log:1895', 'artifactreview/strict-20261006/gates.json'],
    'limits': ['Exactly-one-purpose accounting proves diff coverage, not semantic correctness or universal absence of bugs.', 'Satisfied conditions are limited to the source and regression assertions/evidence stated; no UI/build/test commands were run for this classification task.', 'The read parent gate logs show Store22/DataIO17/Windows24/draft7 and full615 tests; the fingerprint fixes source units independently of those logs.', 'Final frozen source/package UI and native visibility/quit outcomes must be entered by the parent after actual runs; earlier successful runs are not reused as frozen-snapshot proof.', 'The intermittent quit hang remains causally unresolved; optional keep-page and a live native-timeout capture are unverified.', 'Heartbeat exception preservation is not a physical power-loss/disk-flush durability guarantee.', 'Unrelated backup entries are synthetic preservation preconditions, not observed user data; exact valid generated-name regular files remain the managed retention family.', 'Current documentary-source hashes pin what was read, including parent-owned pending documentation; those files do not add units to this fixed product/QA comparison.'],
}
(HERE / 'post-repair-assignments.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result['coverage']))
