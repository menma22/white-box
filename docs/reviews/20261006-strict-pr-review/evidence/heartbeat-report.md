# Synthetic heartbeat and backup preservation evidence

The [before result](heartbeat-before.json) and [after result](heartbeat-after.json) use actual Store and recovery TypeScript transpiled in memory. Only fresh synthetic directories and a process-local clock were used. The summaries retain each probe's source SHA256 snapshot and measured fields; no database fixture or production data is included.

## Heartbeat failure and recovery

A stopwatch began at 00:00 UTC and successfully committed a heartbeat at 00:30. A later native write partially wrote its destination and threw `ENOSPC`; restart was modeled at 01:00. Before the fix, the committed marker was corrupt, `readLastAlive` returned null, and recovery retained 0 of the known 30 minutes. The control recovered 30 minutes.

After the fix, the same fault model against the actual heartbeat write destination preserved the prior committed bytes and marker. A fresh Store plus actual recovery retained all 30 known minutes: the measured loss fell from 1,800,000 ms to 0. The next successful heartbeat committed the newer marker. The main-DB partial-write control also retained its prior committed bytes.

[Store.markAlive](../../../../apps/desktop/src/infra/store.ts) writes `runtime.json.tmp` and uses the existing bounded replacement helper. Its nonthrowing failure behavior remains. The helper retries only `EPERM`, `EBUSY`, and `EACCES`, with at most four rename attempts and three 20 ms waits. Other rename errors are not retried.

The [Store tests](../../../../apps/desktop/tests/store-save.test.ts) cover prior-byte preservation, actual recovery-close of known work, retry after a failed write, transient and persistent sharing conflicts, and immediate non-retry failure. The intermediate narrow run passed 20 tests; [the later boundary run](pr21-boundary-tests.json) passed 70 tests across four files, including 22 Store tests after the two collision cases were added. Intentional import/resume error logs are expected test output.

## Daily-backup retention

The old prefix filter deleted an unrelated synthetic file and attempted to delete a directory lookalike during public Store.save calls. The repaired filter selects only regular files matching `data-YYYY-MM-DD.json` with a valid round-trip calendar date. Tests preserve unrelated bytes, an impossible calendar filename, and a directory, while ordinary 31-day saves retain the newest 30 daily backups.

Exact valid daily regular-file names remain the managed naming family; this is not an ownership ledger for arbitrary files using the same name. Reserving the backup subtree against export is a separate design decision described in [PR21](../pr-21.md).

## Limits

These results establish preservation after synchronous write/rename exceptions. They do not establish power-loss durability or physical disk-flush guarantees. Time after the last successful heartbeat remains unobserved, and an already corrupt marker still falls back to the latest session action. The probes' source snapshots precede later collision guards; the final integrated source tests cover those additional guards separately.
