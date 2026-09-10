# Project progress

## Current release — 0.34.0-beta.1

N65 (named camera layouts) and N77 (fleet clock comparison) are implemented and release-validated. N73 has four opt-in diagnostic entities; reliable pending-work age remains open. The additional forty-task batch has 2 complete, 1 partial, and 37 not yet implemented. No N01–N40 work is closed by this delivery. [Release](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.34.0-beta.1), [evidence](evidence/release_0.34.0-beta.1.json), [continuation](DEVELOPMENT_CONTINUATION_HE.md). Core acceptance stays 31/38 (81.6%); Phase 5 remains open. Storage schemas unchanged from the previous Beta.

The following entries describe the earlier state.

## Previous release — 0.33.0-beta.1

Sixteen approved software items are implemented (01,02,04–11,13,14,16,17,19,37); mobile-credential feasibility (40) is documented. This is not completion of all forty tasks. [Delivery](BETA_033_HE.md), [validation](BETA_DEVELOPMENT.md), [per-item status](ROADMAP_NEXT_40_HE.md).

Access storage migrates to schema 6; profile settings to schema 2. [Beta is published](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.33.0-beta.1) at `60ca27ef897e8c631440fbb9ac983819e8f4770f` after all seven release jobs passed. [Verified results](evidence/release_0.33.0-beta.1.json). Core acceptance remains **31/38** and Phase 5 is still open.

## Next development plan — after Beta publication

[The next forty tasks](ROADMAP_AFTER_BETA_40_HE.md) retain all 23 unfinished tasks and add 17 substantive improvements tied to the original specification. Each has a completion condition and dependencies. The first proposed delivery improves user-directory scale, station health, operation tracing, concurrent edits and guided recovery. Field acceptance runs alongside independent software work; additional convenience features do not delay core v1. The plan is not an implementation claim.

The owner subsequently requested forty additional tasks. [N41–N80](ROADMAP_ADDITIONAL_40_HE.md) adds forty separately scoped items, with priorities, dependencies, acceptance conditions and original-spec references. N01–N40 remain open; the combined planning backlog is 80 tasks, not 80 newly discovered v1 blockers. Core acceptance and runtime version are unchanged.

The checkpoints below describe their earlier state.

## Historical planning checkpoint — original 40-task roadmap

The owner confirms installed MSE video works well and plans the audio check later.
This confirms playback on the reported path, not RTC, speaker audibility or fleet acceptance.
[Owner report](evidence/owner_media_confirmation_2026-09-10.json).

[Next 40-task development plan](ROADMAP_NEXT_40_HE.md) proposes 25 software improvements,
10 investigation/acceptance tasks and five later extensions. Existing functionality is not
counted as missing, and none of the proposed tasks is marked implemented. Core acceptance
remains 31/38; Phase 5 closure depends on the remaining lab and fleet evidence.
No software version bump accompanies this planning-only update.

## Previous release — 0.32.1-alpha.1

[Published diagnostic patch](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.32.1-alpha.1) from `2c4d485d25ff8b50de6cb815f87f31267ae69b00`.
The audio foldout now shows microphone bytes written to the station, numeric HTTP upload
status, sample time and retained microphone peak. Server counters refresh during talk and
can be read without downloading a file; download has its own explicit button.
[Investigation and use](AUDIO_TALKBACK_DIAGNOSTICS_HE.md).

Two real stations report matching G.711ulaw and talk volume 7/10. Their channels toggle
closed/open correctly, accept silence upload with HTTP 200 and close without changing
configuration. The owner's speech-to-speaker issue remains unresolved; installed HA byte
counters and a coordinated audible comparison are still required. No physical acceptance
percentage is increased by this diagnostic release.

[All seven release jobs](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34494380104) passed: **938 Python tests per version, 304 HA tests and 327 browser tests**,
static checks, reproducible build, HACS and Hassfest. [Evidence](evidence/release_0.32.1-alpha.1.json).
Storage remains schema 5.

## Previous release — 0.32.0-alpha.1

Enabled custom user fields and memberships are visible in the table and mobile cards.
Groups grant their combined station door permissions; personal additions and denials override
them. Editors show permission sources and allow returning to inherited permissions.
Group changes commit atomically with affected users in schema 5 and use existing durable
reconciliation, offline revocation, ownership and readback. Old assignments remain personal.
[Delivery and migration](GROUP_PERMISSIONS_032_HE.md).

Published [v0.32.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.32.0-alpha.1) from `e5f50a10bd93d23b28b40de8312b9a333d040e8a`.
[All seven release jobs](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34488590232) passed: **934 Python tests per version (3.12/3.14),
304 HA tests and 322 browser tests**, static checks, reproducible bundles, HACS and Hassfest.
The unchanged audio soak passed in CI. [Publication evidence](evidence/release_0.32.0-alpha.1.json).
Fresh owner approval resolved the earlier public-upload block; the first CI formatting issue
was fixed before release. No new physical acceptance gate is claimed and no live station
permissions were changed by development tests.

[Automatic HACS update discovery](HACS_UPDATES_HE.md) explains the one-time prerelease
switch and custom-repository polling delay. HA notification arrival is not remotely verified.
Historical phase counts below retain their original acceptance boundaries.

## Previous release — 0.31.0-alpha.1

User row actions now sit inside Edit, with Sync now beside Edit. Global profile options
provide configurable fields, groups, filters and optional camera-captured portraits. User data
migrates atomically to schema 4; profile-only changes preserve device synchronization state.
The selected go2rtc add-on serves both RTC and MSE. Real browser probes decoded video
from two stations in both modes; TCP removed packet loss observed on the tested UDP path.
[Delivery and setup](PROFILES_MEDIA_031_HE.md), [sanitized media evidence](evidence/media_031.json).

Published [v0.31.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.31.0-alpha.1) from `c90ba1e9185f9113d3396ad463bdf4d02df5750a`.
[All seven release jobs](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34481556058) passed: **926 Python tests per version (3.12/3.14),
301 HA tests and 315 browser tests**, static checks, reproducible bundles, HACS and Hassfest.
The unchanged audio soak passed in CI. [Publication evidence](evidence/release_0.31.0-alpha.1.json).
The earlier upload block was resolved by fresh owner approval. This delivery does not claim
new physical acceptance gates; installed-HA playback and physical speaker audibility remain
owner checks. Historical phase counts below retain their existing acceptance boundaries.

Previous release **0.30.0-alpha.1** adds global HLS / RTC / MSE settings under WisKey Management tools,
real binary MSE playback through authenticated HA, and microphone/transport diagnostics.
Preferences persist centrally and apply to all WisKey live players across stations and browsers.
[Setup, responsive screenshot and evidence](MEDIA_030_HE.md).

Published [v0.30.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.30.0-alpha.1) from `bc17023b540d5bf109bf5f2f3617553f189a52ed`.
[All seven release jobs](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34471533161) passed: **909 Python tests per version (3.12/3.14),
290 HA tests and 302 browser tests**, Ruff, mypy, TypeScript, Prettier, reproducible bundles,
HACS and Hassfest. The tag, manifest, panel and audio worklet match the tested commit.
[Publication evidence](evidence/release_0.30.0-alpha.1.json). Access storage schema remains 3;
playback preferences use a separate versioned storage file.

The owner confirmed successful card creation/writing, assignment, updating and deletion.
The separate multi-card acceptance case is not explicitly confirmed. Live MSE returned H.264 data
from two stations, and concurrent ISAPI audio sessions passed receive/silence-transmit/close checks.
Microphone-to-speaker audibility remains unverified; no recording or persistent device changes.
Mandatory acceptance remains **31/38 (81.6%)**, Phase 5 **8/9 (88.9%)**, combined **37/47 (78.7%)**.
These conservative criteria are not automatically closed by transport counters or generic card CRUD evidence.
[Deferred physical checks](DEFERRED_VALIDATION.md). The earlier overnight automation stays paused.

## Historical checkpoints (earlier counts below are not current)

Current 0.25 checkpoint: mandatory acceptance **31/38 (81.6%)**, Phase 5 **8/9 (88.9%)**.
Phase 6: four software features implemented, three partial, two absent. Combined scope remains
**77.7%**. The [current delivery ledger](ADMIN_UI_025_HE.md) covers Users, Events, Sync and
administrator history, including responsive station-labelled sync, filter recovery and grouped
record details. Owner usability feedback and the remaining physical gates stay open.
Published [v0.25.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.25.0-alpha.1)
from `10f9d43311661a81124cd20bc8e49b9581729a98`.
[Release run 34390267958](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34390267958)
passed all seven jobs: 838 Python tests per version, 238 HA tests, 145 browser tests, mypy56,
Ruff, TypeScript, Prettier, reproducible bundle, HACS and Hassfest. The tag, manifest, bundle
and expected sources were verified after publication. Access payload schema remains 3.



Current 0.24 checkpoint: mandatory acceptance **31/38 (81.6%)**, Phase 5 **8/9 (88.9%)**.
Phase 6: four software features implemented, three partial, two absent. The combined scope
measure remains **77.7%**, not an effort estimate or proof of physical acceptance.
The [current delivery ledger](CORE_UI_024_HE.md) records the redesigned overview/navigation/user
editor, station-scoped event identity fixes, two-station read-only evidence and the remaining
95% plan gates. The owner reports MSE playback; WebRTC awaits provider NAT repair and acceptance.
Access payload schema remains 3.

Published [v0.24.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.24.0-alpha.1)
from `124abaa`, UI `e546099`, event identity `a5d0a14`.
[Release run 34387022883](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34387022883)
passed all seven jobs: 838 Python tests per version, 238 HA tests (100% ConfigFlow coverage),
134 browser tests, mypy56, Ruff, TypeScript, Prettier, reproducible bundle, HACS and Hassfest.
The published tag, manifest, bundle and expected sources were verified; private evidence was excluded.


Current 0.23 checkpoint: mandatory acceptance **31/38 (81.6%)**, Phase 5 **8/9 (88.9%)**.
Phase 6: four software features implemented, three partial, two absent. The approximate
combined scope measure remains **77.7%**, not an effort estimate or proof of physical acceptance.
The [current execution ledger](BULK_ACCESS_AUDIT_HE.md) records all twenty implemented software
deliverables: reviewed bulk access changes, durable receipts, administrator history and read-only
permission comparison. Physical call, card, validity, WebRTC and nine-station gates remain open.

Published [v0.23.0-alpha.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v0.23.0-alpha.1)
from `bb2c9a6`, implementation `5276b65`, plan `6206fff`. [Release run34361493111](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34361493111)
passed all seven jobs: 822 Python tests per version, 237 HA tests (100% ConfigFlow coverage),
130 browser tests, mypy56, Ruff, TypeScript, Prettier, HACS and Hassfest. Tag/manifest/bundle
and expected source files were verified after publication; private evidence was excluded.
The access store migrates from schema 2 to 3; downgrades require a compatible HA backup.



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


## Phase 6 — installed schedule operations workspace, 0.20.0-alpha.1

Local responsibility and bounded preflight jobs (`55d9a4d`), HA storage/API integration
(`d5c8ec7`) and administrator operations/archive UI (`469933b`) connect the existing proposals
and recovery journal. The first six proposed tasks are addressed: four local workflow tasks
are complete, while execution-plan and queue tasks remain partial until production writes are
verified. [The detailed task ledger](SCHEDULE_OPERATIONS.md) records all twelve tasks.

The full local Python suite passed 706 tests. Browser checks cover local lifecycle, lost
acknowledgements, admin access and Hebrew mobile layout; targeted proposal/assessment/transfer
regressions passed. Actual HA, typing, full browser suite, HACS and Hassfest results follow
once CI completes. No device requests occurred; physical schedule gates remain unchanged.


0.20 final code `947a2d0` passed **1,012 tests** (709 protocol/access/tools, 203 actual HA,
100 browser), ConfigFlow100%, strict mypy46, Ruff, TypeScript, Prettier, reproducible build,
HACS and Hassfest. The shutdown/enqueue race fix is included. Gated release34335552283
was dispatched once against this exact merged commit. Four local workflow tasks are complete;
two deployment tasks remain partial and six further tasks remain as mapped in SCHEDULE_OPERATIONS.md.
The owner's two-station PIN replacement acceptance is recorded separately from schedule validation.


## Owner-reported user deletion acceptance — 2026-09-09

The owner reports that user deletion works well. Station targets, credential rejection after
removal and offline behavior were not specified; those observations are not inferred. The
existing DoD22 closure receives additional installed-system evidence, without changing28/38.
PIN-only removal while retaining the user remains separate. Card lifecycle and enrollment
checks are deferred until next week; there is no scheduled automation or confirmed test date.
The current pending-test table now reflects the already-confirmed two-station PIN replacement,
while retaining the earlier failed commissioning session as historical evidence. No device
requests or code changes were made for this documentation update.


## Owner-confirmed PIN removal and live video; next batch awaits approval — 2026-09-09

The owner explicitly confirms PIN-only removal while retaining the user, with the removed code
rejected. They also confirm stable live video in the HA camera entity and panel on desktop/mobile,
while noting that WebRTC is not used. DoD5,6,16 now close:31/38=81.6%,7/38=18.4% remain.
Original temporary-user cleanup remains a separate commissioning follow-up, not an open PIN feature.
The offline-change/reboot/reconnect scenario is reported as "seems to work" and retained as tentative
positive evidence for two stations, not nine-station soak acceptance.

The screenshot shows a PIN authentication accepted event with unidentified person and historical
label. The UI uses that label when both normalized person_name and employee_no are absent. Existing
normalization reads employeeNoString/employeeNo, and ingestion resolves names from an explicit ID.
The raw device event for this occurrence was not inspected; missing source identity, parser coverage
and history/freshness need investigation. The displayed UTC offset alone cannot prove time correctness
or access-window enforcement. No user is inferred from the secret PIN or timing alone.

This turn is planning/documentation only. Twenty additional tasks and a transparent coarse scope
estimate are in NEXT_BATCH_20_TASKS_HE.md. Implementation, new releases and device operations await
the owner's approval of that plan. The source image was not copied into the public repository.


## 0.21 publication verified

Published v0.21.0-alpha.1 from `e1b23627a1bba72882d7616b64ee886492eb2254`.
All final checks passed:754 Python +215 actualHA +112 browser =1081 tests;
ConfigFlow100%, strict mypy51 modules, HACS/Hassfest and reproducible frontend build.
Release workflow34345012158; exact tag, manifest and bundle verified remotely.
No device mutation was performed. The current evidence ledger is CORE_MEDIA_BATCH_HE.md.
