# Schedule write recovery engine — 0.19

This release implements and tests the write-ahead journal and executor needed for future schedule
application. **No production schedule transport, HA write service, background worker or Apply button
is registered.** The current station still has unverified writes, incomplete holiday coverage and
unknown user defaults. Existing proposals and comparison baselines do not authorize deployment.

## Implemented contract

A trusted future adapter must supply an explicitly owned, fully observed resource set and stable,
private fingerprints of device identity, firmware/capabilities, source revision, ownership and
external dependencies. The executor checks this context and relevant resources before every step,
and again after saving intent, before calling the adapter. A transport must independently establish
its write contract; a device capability flag alone cannot set `writes_verified`.

The compiler supplies dependency order: weekly and holiday resources, holiday group, template.
The journal stores the immutable draft/bindings/capabilities, keyed before/after configuration
fingerprints and step states. Unknown fields or unavailable records cannot be normalized away.
No missing resource is interpreted as a free slot; allocation and adoption remain separate work.

| State | Meaning | Permitted automatic action |
| --- | --- | --- |
| ready | Next step has no saved write intent | Fresh preflight, then one saved intent and one write |
| recovery_required | An intent exists but the outcome is not confirmed | Read only; never resend the intent |
| conflict | Context or a controlled resource changed unexpectedly | Stop; retain partial work |
| verified | Every candidate matched a successful observation | No additional action; this is not physical enforcement proof |

Before a write, intent is persisted atomically. A failed save prevents the request; cancellation
waits for the save to finish. After a write, acknowledgement is insufficient: the complete controlled
resource set is read and compared again. Exact desired readback verifies that step; unchanged original
readback retains uncertainty. A third value is a conflict. Previously verified resources are checked
before later steps, so external edits cannot be silently overwritten by continuing a transaction.

After a lost acknowledgement or process interruption, recovery only reads. If desired contents are
observed, it records that result but does not start pending writes. Continuing pending steps requires
a separate execution request. If original contents remain, the intent stays unresolved; this release
has no reset/retry action for it. It does not automatically roll back partially applied schedules.

## Persistence and isolation

The journal accepts the project's atomic Save interface. Schema loading validates compiled hashes,
ordered transitions, revisions, context fingerprints and per-station exclusivity. Invalid storage
preserves the prior in-memory state. Successful previous transactions and a newer pending transaction
for that station survive reload together. Separate executors share the same station execution guard.
Nine synthetic stations were executed concurrently and reloaded successfully.

At most 32 transactions are retained; reaching the limit stops preparation. Only a transaction whose
steps are all unstarted may be discarded, and it cannot be discarded during execution. Partial,
ambiguous and completed records have no deletion/retention-rotation path in this release. Production
retention and operator conflict resolution remain integration work. No private journal store is
created in Home Assistant yet: runtime registration awaits the verified adapter and ownership layer.

Public summaries contain step keys/states, attempted flags, status, safe issue codes and timestamps.
They omit configuration contents, names, station identity, context fingerprints and keys. Adapter
exception text is not logged/exported or chained into storage failures. Private desired snapshots
would require the existing private HA storage protections when the production adapter is connected.

## Repeatable simulation

From a development checkout with project dependencies installed:

```console
python -m tools.simulate_schedule_recovery --output simulation.json
python -m tools.simulate_schedule_recovery --scenario crash_applied
```

The tool has no station address or credentials input and uses an in-memory transport. Every successful
save is serialized to JSON, then a new journal instance reloads only committed data. Nine scenarios
cover success, lost acknowledgements with/without a write, interruption with/without a write, offline
readback, external edits, changed dependencies and failed intent persistence. Reports explicitly say
`simulation_only: true`, `hardware_verified: false`, `network_requests: 0`; recovery writes are zero.
Synthetic report cases are regression evidence, not manufacturer/firmware acceptance.

## Remaining before production application

- Verified target-firmware PUT/readback semantics, including optional fields and window boundaries.
- Complete relevant inventory, explicit ownership/adoption, user/default dependency semantics and
  mapping from saved proposals into this trusted executor contract.
- HA private-store/Repair/worker integration, deliberate operator execution and conflict resolution,
  retention, lifecycle cleanup and user RightPlan assignment.
- Supervised weekly/holiday/midnight/DST enforcement with a dedicated test user and targeted cleanup.

The engine is implemented, but the production deployment pipeline remains partial. Mandatory
acceptance remains 28/38; Phase 5 remains 8/9 and Phase 6 remains 3 implemented / 2 partial / 4 absent.
