# Project progress

Source of truth: CODEX_MASTER_SPEC.md v1.2, read completely on 2026-09-07.

[Hebrew scope and phase audit — 0.14 baseline](STATUS_0_14_HE.md): mandatory v1 acceptance
28/38 (73.7%); Phase 5 deliverables8/9 (88.9%); Phase 6 software features3/9 (33.3%).
These use distinct denominators and are not effort estimates or interchangeable completion rates.

| Phase | Status | Remaining gate |
| --- | --- | --- |
| 0 — Reconnaissance | Protocol baseline and active relay mapping verified | Ring sequence and changed-PIN behavior |
| 1 — Core integration | Main components implemented; HACS installation/update owner-confirmed | Ringing and full installed camera/call acceptance |
| 2 — Access backend | CRUD/import/sync/recovery implemented; permanent user sync verified | PIN/card lifecycle and timed-validity enforcement/fixes |
| 3 — Admin panel | Main screens implemented; 0.9 completes Save controls, lock names and validity summaries | Installed-system acceptance |
| 4 — Events | Stream/history/normalization/recovery implemented and read against station | Actual bell sequence and physical event acceptance |
| 5 — Hardening | Diagnostics/Repairs/migrations/privacy/release automation implemented | Nine-station hardware soak and final acceptance |
| 6 — Optional extensions | CSV/reporting in 0.11; reader enrollment in 0.12; local schedule planning in 0.13 and read-only assessment in 0.15, comparison references in 0.16 and schedule workflows in 0.17 and local deployment proposals in 0.18 | Other optional features require capability/media-session evidence; see DEFERRED_VALIDATION.md |

The task-based audit now closes **28 of 38 applicable Definition of Done items (73.7%)**,
with **10 open (26.3%)**. See [the complete evidence ledger](COMPLETION_HE.md).
This replaces the earlier rough 90% software / 80% overall estimates with a fixed denominator;
it is not a regression, an effort estimate or a percentage derived from test counts.
The owner's two Relay 2 selection items are excluded. Optional Phase 6 is outside mandatory v1.
Historical "software complete" entries below record component milestones, not final acceptance.

No release until required CI passes on the exact main commit.
A Phase 0 tooling prerelease must say HA setup/entities arrive in Phase 1.
Do not describe physical Phase 0, the full project or installation acceptance as complete.

Permanent requirements: camera in HA and panel; explicit relay selection enforced by backend/UI;
persistent offline sync/tombstones; secret redaction and administrator-only access management.

Phase 0: 130 tests / 90% coverage, Ruff, mypy, HACS and Hassfest passed; commit `608abe7`
was published as `v0.1.0-alpha.1` by release workflow 34206758291.
Phase 1: commit `706ae2f` passed 190 protocol/configuration tests and 41 real HA tests
(100% ConfigFlow coverage), Ruff, mypy, HACS and Hassfest. Version `0.2.0-alpha.1`
was published from `edb6a81` by release workflow 34211929200.
Physical HA installation acceptance remains open.
See VALIDATION.md and CAPABILITY_MATRIX.md for evidence and remaining acceptance work.
The owner approved publication of source/history/specification and sanitized evidence.

Remote evidence now covers 20 successful ISAPI reads, idle call samples, local PIN mode,
real JSON alert-stream fixtures and independently decoded RTSP/snapshot frames.
The supervised second-station session confirmed API door 1, existing-card authentication and
initial six-digit local PIN acceptance. PIN modification was acknowledged and read back, but
both old and new PINs failed physically. Diagnosis and temporary-user cleanup remain open.
The owner excludes disabled relay 2 project-wide and defers answer testing because no
answering screen is installed. A witnessed bell attempt produced busy tone and only idle samples.
See the [station B evidence](../tests/fixtures/ds_kv6124_e1_fw_3_9_0_station_b/README.md).
Two stream reconnections returned HTTP 500 before a later successful retry.

Manufacturer review and continuation scope: [MANUFACTURER_PROTOCOL.md](MANUFACTURER_PROTOCOL.md).
The owner requested continued development while away from the equipment; physical checks
remain deferred, not counted as passed. Numeric PIN event meanings are now documented.

Phase 2 checkpoints: `c99beb0` passed 244 local tests and all CI; `26f9b34` passed
272 protocol tests and 54 real HA tests with 100% ConfigFlow coverage, HACS and Hassfest.
The final backend includes changed-field updates, cancellation-safe atomic persistence,
explicit import/conflict resolution, durable deletion, independent queues and offline recovery.
Current local verification: 280 tests, Ruff and mypy (20 protocol/access/tool files).
Real read-only access-client validation returned two users and one card with zero mutations.
The administrator panel follows in Phase 3. Physical commissioning is still open.

Phase 2 final commit `0c061d6` passed all checks (280 protocol + 54 HA tests). An automatic
approval review rejected updating default `main` and publishing `v0.3.0-alpha.1`, stating that
explicit default-branch authorization was missing. At that checkpoint the owner approval question was pending.
No workaround or default-branch mutation was attempted after that rejection.

Phase 3 checkpoint `384c179` passed 280 protocol tests, 86 actual HA tests (100% ConfigFlow),
9 Chromium UI tests, TypeScript, reproducible bundle checks, HACS and Hassfest. Subsequent UI
coverage now has 12 tests. The first HA run found outer schema errors could echo malformed
credential payloads; validation was moved inside admin handlers and the privacy regression passed.
UI screenshots use synthetic data and illustrative camera frames, never live station identities.

Phase 3 final `f7d925a` passed all CI: 281 protocol, 86 HA and 12 browser tests.
Phase 4 adds event framing, verified access normalization, event entities, bounded audit storage
and an administrator history view. A read-only manufacturer-documented event query returned
241 records in nine pages, with no credential writes or physical commands.

Phase 4 checkpoint `b0b7f67` passed 320 protocol and 94 real HA tests; the browser run
identified a filter-label locator problem, since fixed with explicit accessible labels.
All 14 local browser tests then passed. The production stream parser was subsequently
verified against nested MIME framing: 13 documents / 11 access events in 12 seconds.
Final Phase 4 adds a framing regression and capability-bounded dense-window recovery.

Phase 4 final `c15ef98` passed 321 protocol tests, 94 real HA tests, 14 browser tests,
HACS and Hassfest. It prepares `0.5.0-alpha.1`; no main mutation/publication occurred.
Phase 5 checkpoint `65ee939` passed 328 protocol and 14 browser tests, HACS and Hassfest.
The HA run identified a diagnostics capability-field mismatch (100 passed / 2 failed),
which was corrected to the actual capability model before final validation.
A real 60-second concurrent read-only check completed 28 polls, 3 snapshots and 50 event
messages, with zero errors and zero physical or credential writes. This is one station,
not the mandatory nine-station hardware soak. Six simulated fleet rotation/restart cycles pass.

Phase 5 final software commit `14e62c8` passed all GitHub checks: 328 protocol tests,
104 actual HA tests, 14 browser tests, HACS and Hassfest. ConfigFlow and config-entry
migration each have 100% line coverage in the HA job. Version `0.6.0-alpha.1` is prepared.
Owner-dependent commissioning, HA/HACS acceptance and nine-station physical soak remain.
No Phase 6 optional work is required for v1.
The latest local documentation commit records this evidence without changing runtime behavior.

Publication authorization: the owner explicitly approved merging Phases 2–5 into `main`
and publishing `v0.6.0-alpha.1` for installation and testing on 2026-09-08. This resolves
the earlier approval gate. The gated release workflow reruns CI on the exact main commit.
Hardware and real installation acceptance remain open; the owner will install and report.

Post-installation correction: the owner confirmed HACS installation and working integration,
then reported station-bound user sync failures. A production-manager test reproduced invalid
validity dates on the real station. Version 0.6.1-alpha.1 fixes permanent-user creation and adds
safe stage diagnostics plus actionable Sync errors. Real create/name-update/targeted-delete
passed without credentials or relay actions; original records remained unchanged. Timed
validity timezone interpretation remains explicitly unverified and blocks timed readback.

Fleet status completion (0.7.0-alpha.1) fills the required Overview/Intercom health details:
retained last access, successful status contact/request duration, pending unique users and
last successful reconciliation. PIN-removal queues are visible and masked-card suffix search
is available. No new ISAPI behavior or physical operation is introduced. The owner reports the
installed integration working well; outstanding physical gates remain tracked in HARDENING.md.

Station inspection and assignment completion (0.8.0-alpha.1) corrects the rescan/sync action
mix-up and fills Intercom capability/mapping/event-health presentation plus deliberate fleet
assignment selection. Read-only inspection and ordinary background synchronization have separate
semantics. No new ISAPI mutation, storage migration or physical action was introduced.


0.9.0-alpha.1 closes the three identified UI/software gaps: independent immediate-sync choice,
configured active-lock names across HA/panel, and configured validity summaries in the user list.
Save continues to participate in automatic reconciliation; it does not add a permanent hold state.
No device credentials, relay commands or firmware-validity behavior were changed for these features.
Local protocol/access regressions pass (354 tests); HA transport/entity/configuration regressions
and browser acceptance are included in the release's CI gate. Physical gates above remain open.


Admin-completion code `4efe4e0ebfe568dff1487542bcb2ced58ef30756` passed all branch CI:
354 protocol/access tests on Python 3.12 and 3.14, 119 actual Home Assistant tests,
30 browser tests, Ruff, mypy, TypeScript and reproducible frontend build. ConfigFlow retains
100% coverage. Python checks: 34254503208; HACS: 34254503166; Hassfest: 34254503200.
The owner is currently unavailable for supervised physical checks; those gates remain deferred.


0.9.1-alpha.1 addresses owner acceptance feedback: one pending release previously set the panel's
global busy flag and disabled every door. The browser regression reproduced this on 0.9.0.
Release state is now per station, with local progress/outcome and unchanged target validation.
A related panel reattachment/queued-refresh issue uncovered during lifecycle testing is corrected.
The owner confirmed updating to 0.9.0; no physical commissioning result is inferred from that.


Independent-door code `93538ecc24bd4e23791ac8ba3c3191be516b407f` passed all branch CI:
354 protocol/access tests on Python 3.12/3.14, 123 actual HA tests, 38 browser tests,
Ruff, mypy, TypeScript and reproducible bundle checks. ConfigFlow coverage remains 100%.
Python checks34259688049; HACS34259688072; Hassfest34259688067. HA job102174232294
confirms independent runtime completion, same-target guarding and safe failure translation.
These tests mock device I/O and do not close the outstanding physical commissioning gates.


0.10.0-alpha.1 adds a detailed read-only reconciliation comparison, logical change preview,
fleet impact, supported-action reasons and captured-revision protection. It closes UI inspection
and stale-approval gaps without adding unverified device behavior. The ten remaining acceptance
items are deliberately left open; tests cannot certify the previously failed physical PIN change.
Local verification: 367 protocol/access tests, Ruff and mypy (25 modules). The real HA transport
and responsive browser regressions are part of the exact-commit release gate.


Detailed-review code `bd036318b09b8e14c95b020838e9117aef888eac` passed every branch check:
367 protocol/access + 125 actual Home Assistant + 44 browser tests (536 total), HACS,
Hassfest, Ruff, mypy, TypeScript and reproducible bundle. ConfigFlow coverage is 100%.
Python checks34262840733; HACS34262840762; Hassfest34262840704.
It advances the main implementation to 0.10.0-alpha.1; the requirement-based tally remains
28 closed / 10 open / 2 owner-excluded. Physical acceptance has not been inferred from CI.


0.11.0-alpha.1 advances two optional Phase 6 features under the owner's continuation request:
reviewed CSV batches with atomic central storage and filtered activity reporting/export.
Large plans/encoding run outside the HA event loop; station queues remain independent and
coalesce batch scheduling. The [CSV guide](CSV_AND_REPORTS.md) records interchange semantics,
privacy and retention limits. [Deferred validation](DEFERRED_VALIDATION.md) preserves the
manufacturer basis, failed/untested firmware behavior and exact future commissioning steps.
No live device action or new ISAPI behavior was introduced. The mandatory tally remains 28/38;
optional additions do not close physical gates or imply two-way audio/schedules are available.


CSV/report code `442d798eb16f5a4b85b0682be416e2454ecdf833` passed all branch CI:
394 protocol/access + 134 actual HA + 51 browser tests, HACS, Hassfest, Ruff, mypy,
TypeScript and reproducible bundle. Checks:34268116415; HACS34268116401;
Hassfest34268116403. The owner-authorized main update and exact-commit release gate
advance `0.11.0-alpha.1`. No physical acceptance item changed status.


0.12.0-alpha.1 implements reader-based card enrollment using manufacturer pages87/481.
Fresh read-only firmware evidence confirms support and card length1–32, with the default
reader route (no advertised reader selection). Existing-user selection, masked review,
explicit approval, expiry/cancellation, administrator ownership and revision/conflict guards
are implemented. The separate collection lane leaves normal station I/O independent.
[Operator/protocol guide](CARD_ENROLLMENT.md) and HW-ENROLL preserve the physical test plan.
No collection request or access/relay mutation was performed during development. Mandatory
acceptance remains28/38; this optional implementation does not close physical card acceptance.


Enrollment code `018e10a94fd18fde85bf3b80821e0a0163406961` passed all branch CI:
425 protocol/access,142 actual HA,58 browser tests. HACS34274523587,
Hassfest34274523629 and Python/HA/frontend34274523581 all pass. The production
capability client also passed a read-only check against the real firmware. Owner-authorized
main publication runs the exact-commit release gate. Physical HW-ENROLL remains open.


0.13 continues the weekly/holiday extension with a complete local draft editor, durable storage,
window preview and read-only per-station readiness report. Four live capability GETs succeeded
but all four configuration samples returned device status 3. Allocation, writes and user linkage
remain unavailable; schedule enforcement is not counted as complete. See ACCESS_SCHEDULES.md.


Schedule code `ca2d9a2` passed all branch checks:475 protocol/access,153 real HA and65 browser
cases (693 total), strict typing31 modules, HACS and Hassfest. The code was fast-forwarded to
main under the existing publication authorization; release workflow34278274318 reruns all gates
on that exact SHA. Mandatory acceptance stays28/38; two optional schedule features are in
progress as local drafts, while device application still needs demonstrated contracts/ownership.

## 0.14 — station time compatibility

Default station/DST display, manual IANA override, explicit input zones, local report days and
read-only clock diagnostics are implemented. Two live GET-only samples confirmed the device
clock contract, including one with the production client. See [TIME_ZONES.md](TIME_ZONES.md).
This cross-phase correction does not close physical acceptance: 28/38 (73.7%) remains unchanged.

Clock implementation `8c09e8a` passed732 tests (501 protocol/access,159 actual HA,72 browser),
strict typing33 modules, HACS and Hassfest. See VALIDATION.md for exact jobs and release gate.


## 0.15 — schedule inventory and draft compatibility

Phase 6 schedule work now includes firmware-verified Search reads and comparison of the selected
local draft against advertised period, precision, weekday and resource limits. Live counts are
255 templates, 255 weekly plans, 64 holiday groups and a partial 300/1024 holiday plans.
An enabled holiday group and references from disabled templates demonstrate why disabled records
cannot be treated as free. No resource allocation, schedule writing or user association is enabled.
[Usage, protocol evidence and limits](SCHEDULE_INVENTORY.md).

The two schedule features remain partial. Phase 6 still has 3/9 implemented features, 2 partial
and 4 unimplemented; Phase 5 remains 8/9 deliverables. Mandatory acceptance stays 28/38 (73.7%).
No physical gate has been closed by this read-only development. The 0.14 report is retained as a
historical scope audit; the evidence above updates its schedule-reading limitation.


0.15 code checkpoint `a6c4c25`: all required branch checks passed with 775 tests (533 protocol/access,
165 actual HA, 77 browser), strict typing for 35 modules and ConfigFlow coverage 100%. HACS and
Hassfest passed. The code was merged to main and submitted to the gated release workflow.


## 0.16 — persistent schedule references and observed-change detection

Administrators can explicitly save a station observation, compare fresh assessments, replace or
clear a reference. Private keyed fingerprints survive restart without storing raw configurations.
Full and partial coverage have distinct presence-change rules; uncertain save replies and stale
approvals require fresh inspection. Device identity/firmware changes suppress comparison.
Two real read-only scans with an intervening reference reload showed no observed changes and
retained partial holiday coverage. No station resources were created or changed.
[Usage and limitations](SCHEDULE_BASELINES.md).

This implements observed-change detection but does not establish resource ownership, a write
journal, allocation or user association. Both schedule extensions remain partial; the Phase 6
feature tally and mandatory 28/38 acceptance tally are unchanged.


0.16 code `c7f776a` passed 821 tests (567 protocol/access, 172 actual HA, 82 browser), strict
mypy for 36 modules, Ruff, TypeScript, HACS and Hassfest. ConfigFlow coverage is 100%.
The checked code was merged to main and dispatched through the gated release workflow.


## Phase 6 — schedule workflow batch, 0.17.0-alpha.1

Four sequential tasks: dependency audit `a4c0212`, multi-station queue `1960979`, portable
atomic import/export `1007914`, and clone/copy editing `0ea93bd`. Each received targeted
checks and its own commit. Integration validation and release evidence are recorded in VALIDATION.md.

Live read-only dependency audit at 2026-09-09T05:28:38Z returned three users, all without explicit
RightPlan references. They remain unknown defaults; no schedule, credential or relay write occurred.
Counts are not identities, and no raw user records were retained in publication artifacts.
The schedule inventory still has partial holiday coverage. Dependency traversal is non-atomic.

This advances two partial optional Phase 6 features without closing hardware gates: mandatory
acceptance remains 28/38; Phase 5 remains 8/9; Phase 6 has 3 implemented, 2 partial, 4 outstanding.
See SCHEDULE_WORKFLOWS.md for operation, privacy and remaining enforcement limitations.


0.17 final code `41f044f` passed all gates: 593 protocol/access/tool cases, 178 actual HA cases
(ConfigFlow100%), and 92 browser cases — 863 total. Strict mypy37 modules, Ruff, TypeScript,
format/reproducible build, HACS and Hassfest passed. Release dispatch34315935383 targets the
same frozen main SHA. See VALIDATION.md for exact CI links. Physical gates remain unchanged.


## Phase 6 — deployment preparation batch, 0.18.0-alpha.1

Three software tasks are implemented: capability-checked candidate compilation (`b0ce799`),
selected-resource comparison/external dependency detection (`2466517`), and durable local proposals (`ace3df8`)
with administrator preview/save/recheck/export/delete. See [the workflow](SCHEDULE_DEPLOYMENT_PLANS.md).
Local reservations prevent conflicting saved proposals, but do not establish device ownership.
Original keyed configuration/capability fingerprints survive rechecks and local restart.
The UI invalidates changed source drafts and late responses; independent storage corruption raises
its own Repair while existing core access and drafts continue.

Production-client reads at 2026-09-09T06:29:29Z confirmed observed template/weekly differences,
an external weekly reference, three users with unknown defaults and unchanged observations after
local save/reload/recheck. Zero station writes occurred. Applying schedules, assigning users,
verified write recovery and physical enforcement remain open. Mandatory acceptance stays 28/38;
Phase 5 remains 8/9; Phase 6 has 3 implemented, 2 partial and 4 unimplemented extensions.

0.18 release code `2ec180c` passed all branch gates: **915 tests** (631 protocol/access,
188 actual HA, 96 browser), ConfigFlow100%, strict mypy41 modules, Ruff, TypeScript, Prettier,
reproducible build, HACS and Hassfest. Release run34320132238 targets that exact merged SHA.
Tasks `b0ce799`, `2466517` and `ace3df8` are complete; physical acceptance remains unchanged.


## Phase 6 — schedule recovery infrastructure, 0.19.0-alpha.1

Three implementation tasks are complete: durable write intent journal (`3803db8`), guarded executor
and readback-driven recovery (`d838f7f`), repeatable offline fault simulator (`787b912`). The executor
handles dependency order, preflight changes, ambiguous outcomes, cancellation and restart without
resending a persisted intent. Public reports omit private state. Fifty-five new regression cases
include nine synthetic stations and nine CLI scenarios. See [the contract](SCHEDULE_RECOVERY.md).

No production transport, HA write service/worker/store or Apply control is registered. Ownership,
complete relevant inventory, target-firmware write verification, operator recovery/retention and
user assignment remain required integration work. No device requests occurred in this batch.
Mandatory acceptance remains 28/38; Phase 5 remains 8/9; Phase 6 remains 3 implemented, 2 partial,
4 absent. Simulator success is not physical enforcement or a nine-station hardware soak.

0.19 final code `a48bada` passed all checks: **970 tests** (686 protocol/access/tools,
188 actual HA, 96 browser), ConfigFlow100%, strict mypy44, Ruff, TypeScript, Prettier,
reproducible build, HACS and Hassfest. Release34324306989 targets this exact main commit.
The three infrastructure tasks are complete; production deployment and physical acceptance remain open.


## Owner-reported two-station PIN acceptance — 2026-09-09

The owner reports connecting two intercoms to the installed integration, creating a user and
synchronizing it successfully to both. After replacing the PIN, the new PIN worked and the old
PIN was rejected. This confirms owner-witnessed creation and replacement in that installation;
the exact installed integration version and both firmware versions were not provided. It does
not establish the cause of the earlier commissioning failure, PIN removal without replacement,
cleanup of the original temporary user, or nine-station acceptance. No PIN values were requested
or recorded. DoD16 remains open only for its remaining removal/lifecycle evidence; the fixed
mandatory count remains28/38 until that combined requirement is completed.
