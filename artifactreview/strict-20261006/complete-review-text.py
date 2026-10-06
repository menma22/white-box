import json
from pathlib import Path

root = Path.cwd()
review = root / 'docs/reviews/20261006-strict-pr-review'
evidence = review / 'evidence'
audit = root / 'artifactreview/strict-20261006'

def replace(path, old, new):
    text = path.read_text(encoding='utf-8-sig')
    assert old in text, (path, old)
    path.write_text(text.replace(old, new), encoding='utf-8')

def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

replace(review / 'pr-21.md', 'S14の独立修正後3条件は成功し、新しい統合版の最終ゲート・UI再測定は未完である。',
        'S14の独立修正後3条件と、最終製品125026f7の617テスト・pack、QA130016c8のsource/配布検証も成功した。最終統合測定は末尾と入口で範囲を区別する。')
replace(review / 'pr-21.md', '独立3条件成功、修正後の全体ゲート/UIは未完', '独立3条件成功、修正後の全体617テスト・source/配布も成功')
replace(review / 'pr-21.md', '独立3条件。native Electron全体と最終統合UIは再測定待ち',
        '独立3条件。正常終了のnative統合検証も成功。故障時nativeエラーダイアログのpixelsとは区別')
replace(review / 'pr-21.md', '新しいsnapshotの全体typecheck・lint・test・packとsource/配布版UIは再測定待ちであり、97e583d5の615件・UI成功をその代わりに使わない。',
        '新しい製品snapshotは全体typecheck・lint・617テスト・packが成功し、最終QAのsource/配布も成功した。97e583d5の615件を新しい617件の証拠へ置き換えていない。')
replace(review / 'pr-22.md', 'A later shutdown-heartbeat correction at 125026f adds a new integration stage whose final gates and runtime reruns are pending.',
        'The final product125026f7 also passes all617 tests, typecheck, lint and pack; QA130016c8 passes the source composite13 and full packaged12 scripts. These are separate from the retained97 stage.')
replace(review / 'pr-22.md', 'final source 940x620 geometry checks passed; manual pixels pending',
        'source940x620 geometry and pixels verified; renderer bytes unchanged at final product/QA; packaged geometry verified')
replace(review / 'pr-22.md', 'its new integrated static/runtime gates remain pending.', 'its final integrated static/runtime gates now pass, with exact scope in the final measurement below.')
replace(review / 'pr-23.md', 'この新しいsnapshotの全体型検査・lint・test・packとsource/配布版のUIは再測定待ちである。',
        'この製品snapshotの全体型検査・lint・617テスト・packは成功し、最終QA130016c8のsource/配布版UIも成功した。')
replace(review / 'pr-24.md', '最終型検査・lint・61ファイル615テスト・pack・Storybookは成功。ソース版13本は全体exit0。planning79・Task Priority65・activity54・quit観測11条件が成功し、失敗入力・競合を含む実ピクセルも確認した。配布版は測定中。',
        '製品125026f7の最終型検査・lint・61ファイル617テスト・packが成功。QA130016c8のソース13本は内容一致11本と基本・Note再測定で構成し、配布12本は一括exit0。planning79・Task Priority65・activity54・Note22・quit観測11条件が成功した。Storybookと実ピクセルは変更のないrendererで先行検証した。')

trace = json.loads((audit / 'notes-navigation-check/navigation-trace.json').read_text(encoding='utf-8'))
trace.pop('executable', None)
trace.pop('qaRun', None)
trace['scope'] = 'Synthetic isolated app/profile; a single observer run preserved verify/key sequence.'
trace['oldFailedTimeoutCauseEstablished'] = False
trace['observedDomAbsenceBeforeUnlockOnAnotherTransition'] = True
trace['diagnosticChecksPassed'] = 22
write_json(evidence / 'notes-navigation-summary.json', trace)
settlement = json.loads((audit / 'cdp-settlement-check/results.json').read_text(encoding='utf-8'))
settlement['scope'] = 'Actual extracted connect function, fake WebSocket/timers only; not a native app shutdown probe.'
settlement['oldTaskPriorityNativeHangCauseEstablished'] = False
write_json(evidence / 'cdp-settlement-summary.json', settlement)

failures = json.loads((evidence / 'known-failures.json').read_text(encoding='utf-8'))
failed_note = root / '.e2e/notes-run-g4uzMR/result.json'
note = json.loads(failed_note.read_text(encoding='utf-8'))
failures['failures'].append({'artifact': '.e2e/notes-run-g4uzMR/result.json', 'stage': 'product125/QA125 package',
                            'exitCode': note['exitCode'], 'checksPassedBeforeTimeout': len(note['checks']),
                            'failure': 'Timed out: return to notes', 'rendererErrors': note['errors'],
                            'rootCauseEstablished': False})
failures['failures'].append({'artifact': 'artifactreview/strict-20261006/e2e-package-ready-final.log',
                            'stage': 'product125/QA15 package', 'exitCode': 13,
                            'failure': 'Detected unsettled top-level await while awaiting own closing main page app:quit response',
                            'rootCauseEstablishedByActualFunctionProbe': True,
                            'fixedAtQa': '130016c83ce352598283ca8378362dad3c1821b0'})
write_json(evidence / 'known-failures.json', failures)
print(json.dumps({'textUpdated': True, 'summariesWritten': 2, 'retainedFailedAttempts': len(failures['failures'])}))
