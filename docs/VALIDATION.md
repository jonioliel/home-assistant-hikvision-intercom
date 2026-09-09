# Current validation — 0.27.1-alpha.1 overnight recovery

Published code: `b6da2b03ab8f8ffeaf14736e8886e2123c721118`. [All seven release jobs](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34412993869) passed:
887 Python tests per version (3.12/3.14), 264 Home Assistant tests, 189 browser tests,
mypy57, Ruff, TypeScript, Prettier, reproducible bundles, HACS and Hassfest.
The published tag, manifest, panel and audio worklet were verified against the tested commit.
[Release evidence](evidence/release_0.27.1-alpha.1.json).

[Delivery, regression reproductions and limits](OVERNIGHT_2026_09_10_HE.md).
No physical device operations were performed for this patch. Audible audio, calls, cards,
timed validity, the original unidentified PIN event and nine-station hardware acceptance remain open.
Prior [0.27 evidence](RECOVERY_027_HE.md) retains its own physical/loopback scope.
Historical checkpoints below retain their original counts.

# Phase 0 validation — 2026-09-08

Current branch: `phase/1-core-integration`. Phase 0 protocol baseline is complete;
physical commissioning remains open. Historical Phase 0 validation follows below.

## Local validation

- Python 3.12.14 on Windows.
- pytest with coverage: **130 passed**, **90%** total measured coverage.
- Protocol parser: 99%; probe: 94%; redaction: 97%; transport: 100%.
- Ruff lint and formatting: passed.
- Strict mypy: passed for 13 source files.
- CLI `--help`: passed in the prepared virtual environment.
- `git diff --check`: passed.
- Master Spec matches the owner-supplied file byte-for-byte and is excluded from formatting.

The 32 added cases cover real firmware response shapes, capability inference, length-delimited
JSON/XML MIME, incomplete/oversized parts, fresh Digest after stream closure, extended read
allowlisting and sensitive-field redaction. Earlier tests cover Digest hashes, unsafe XML,
HTTP-200 device errors, deadlines/cancellation, bounds, pagination, archives and release gates.
A complete async CLI test also runs against a local HTTP simulator.

## Initial remote station validation

See [CAPABILITY_MATRIX.md](CAPABILITY_MATRIX.md) and the
[fixture provenance](../tests/fixtures/ds_kv6124_e1_fw_3_9_0/README.md).

- DS-KV6124-E1, V3.9.0 build 260115.
- Final extended scan: **20/20 reads** returned HTTP 200 and expected payloads.
- Eleven unattended call samples: all HTTP 200, state `idle`.
- Separate in-memory PyAV 16.1.0 check: five H.264 RTSP frames at 2688×1520;
  snapshot decoded at 704×576. PyAV was a local diagnostic dependency, not a runtime addition.
- JSON alert events received. Historical access events were not treated as new access attempts.
- Cached Digest after stream closure failed; fresh-challenge reads succeeded after the fix.
- Two short stream reconnections returned HTTP 500; a delayed check returned HTTP 200.
  Sustained reliability and the cause of the transient failures remain unverified.
- No device configuration, users, cards, PINs, relays or reboot state were changed.

## Distribution and remaining gates

Public repository: https://github.com/jonioliel/home-assistant-hikvision-intercom

Source and sanitized evidence are maintained on the Phase 0 branch. GitHub Actions runs
Python checks (3.12/3.14), HACS and Hassfest for each pushed commit; consult that commit's
[checks](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions) for exact results.
The final task report includes the pushed commit hash and its CI outcome.

Phase 0 was merged at `608abe7` and published as `v0.1.0-alpha.1` after release workflow
34206758291 passed. Core integration `0.2.0-alpha.1` passed software validation on `706ae2f`;
publication runs through the gated release workflow. HACS installation and update acceptance
on the owner's HA host remain pending.
The supervised session below supplies some physical evidence. Successful answer transitions,
PIN change/removal and rights enforcement remain unverified; they cannot be inferred from CI
or capability advertisements. Relay 2 is excluded by the owner, not counted as tested.

## Supervised second-station session

The owner provided a second DS-KV6124-E1 with the same firmware and one user/card.
See the [sanitized fixture provenance](../tests/fixtures/ds_kv6124_e1_fw_3_9_0_station_b/README.md).

- Ten baseline reads succeeded, including populated user/card searches.
- A witnessed bell attempt gave a busy tone; 283 call samples remained `idle`.
  Answer/hangup tests are deferred because no answering screen is installed.
- API door 1 accepted `open`; the owner confirmed release and automatic return.
  The owner specifies one active relay per station throughout the project. Relay 2 is disabled.
- The existing test card opened the door. Its binding and matching event number were
  compared in memory; identity values are redacted in exported evidence.
- A temporary user with `localPassword` was created without changing the owner user.
  The first six-digit PIN alone opened the door and the lock returned normally.
- Changing the PIN returned success and exact readback, but both old and new PINs
  failed at the keypad. The new PIN gave an error tone. Physical change is **failed**.
- A follow-up update uses the vendor UI's door-1 `RightPlan` structure while retaining
  the changed PIN. Readback passed; its physical outcome is pending. This is a diagnostic
  experiment, not a confirmed explanation or a validated production permission recipe.
- Temporary-user cleanup is pending the supervised lifecycle test. The existing user and
  card are preserved. No PIN, card number, employee number or station address is published.
- Simultaneous initial stream/poll authentication produced HTTP 401; isolated streams
  worked. The cause is unconfirmed and no authentication protection was disabled.

These observations advance Phase 0. They do not establish production HA/HACS acceptance,
card CRUD, duplicate behavior, schedule enforcement, reboot persistence or nine-station soak.

## Manufacturer-backed protocol checkpoint

130 tests passed with 90% coverage. Twelve new cases verify documented capacity/conflict
classification and busy responses without exposing private error text. Three additional
capability GETs returned HTTP 200. See MANUFACTURER_PROTOCOL.md for source references,
PIN-attempt-limit interpretation and the owner-authorized continuation to Phase 1.

## Phase 1 core validation

- 190 local protocol/configuration tests pass on Python 3.12.14.
- Ruff lint/format and strict protocol mypy checks pass (13 protocol/tool files).
- New live **read-only production-client** check on the commissioned station succeeded:
  identity/model/firmware, advertised relay IDs, documented call enums, JPEG snapshot and
  enabled RTSP channel configuration. Zero physical commands were sent.
- Real HA 2026.9.1 tests run separately on Linux/Python 3.14 with stream/camera dependencies.
  **41 tests passed on `706ae2f`**, including **100% ConfigFlow line coverage**.
  Setup/entities, admin service permissions, lock pulse, offline/recovery, reauth/reconfigure,
  shutdown/unload cleanup, HTTPS options and identity/mapping guards were exercised.
- HACS and Hassfest pass on `706ae2f`. Earlier failures exposed test-environment packaging
  and missing optional camera dependencies; they were corrected rather than disabling checks.
- The standard camera keeps its credential-bearing RTSP source backend-only. Diagnostics
  use a small allowlist and never serialize config entry data or raw station records.

Exact Phase 1 CI: [Python and HA](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34211383510),
[HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34211383521),
[Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34211383563).
Local protocol typing intentionally does not claim to type-check unavailable HA modules;
those adapters are exercised against the real pinned HA runtime in CI.

## Phase 2 backend validation

- `c99beb0`: 244 protocol tests and all CI passed.
- `26f9b34`: 272 protocol tests, 54 real HA 2026.9.1 tests, 100% ConfigFlow line coverage,
  Ruff, mypy, HACS and Hassfest passed. Exact [Python/HA run](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34216670915).
- Subsequent local tests: 280 pass. Added minimal person-field updates, before-image recovery,
  deletion during creation, manual credential-change conflicts, cancellation-safe persistence,
  deletion review and a nine-station simulator with one offline and at most three writers.
- HA storage tests use real private atomic files, including corrupt input and simulated disk failure.
  Existing users remain unmanaged at startup; admin-only actions and unload/reload are tested.
- New production access-client check was read-only: two users, one card, local PIN mode,
  capability PIN range and five-card limit. No credentials or relays were changed.
- Simulator success and readback do not close physical PIN/card lifecycle or nine-station soak gates.

## Phase 3 panel validation

- `384c179` passed all GitHub checks: 280 protocol tests, 86 real HA 2026.9.1 tests,
  100% ConfigFlow coverage, 9 Chromium UI tests, HACS and Hassfest.
  Exact [Python/HA/frontend run](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34220634464).
- Final local expansion: 281 protocol tests and 12 Chromium UI tests pass. Added detached
  tombstone projections, immediate ring/offline UI state, text-safe untrusted names and rejection
  of live video URLs outside HA. TypeScript, Prettier, Ruff and mypy pass.
- Real WebSocket tests cover every registered command's administrator authorization, private
  create/update/read/delete responses, malformed-PIN error/debug redaction, release guards and
  data-free subscription teardown. A discovered framework schema echo was fixed and retested.
- The bundled module is rebuilt in CI and compared with the committed HACS artifact; it has no
  external CDN dependency. English desktop and Hebrew mobile screenshots were visually reviewed.
- HA device I/O and browser test data are simulated. Actual HA install, media playback and hardware
  credential acceptance have not been inferred from these tests. Publication awaits owner approval.

## Phase 4 event validation

`c15ef98` passed 321 protocol tests, 94 real HA tests and 14 browser tests, HACS and
Hassfest: [exact CI](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34223969810).
Physical reads verified 241 query records over nine pages and nested MIME stream framing.
No physical release or credential mutation was performed during those checks.

## Phase 5 hardening validation

328 local protocol tests include deferred PIN retirement, schema migration, corrupt ownership,
admin rate/concurrency admission, private-free request metrics and six repeated rotation/restart
cycles across nine simulated stations. Deletion with one offline station retains its tombstone.
The real single-station concurrent read check made 31 requests (28 status + 3 snapshot) and
received 50 stream messages in 60 seconds. All requests succeeded; measured p95 was 500 ms.
The evidence contains counts and timing only. This does not replace sustained nine-station testing.

Final software commit `14e62c8`: 328 protocol tests, 104 actual HA tests, 14 Chromium tests,
HACS and Hassfest all passed. ConfigFlow and config migration have 100% line coverage.
Exact [Python/HA/frontend run](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34226155490),
[HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34226155305),
[Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34226155303).
The release metadata test now also checks the real repository's versioned changelog entry.
Code-only simulator checks do not close the physical/installation gates in HARDENING.md.

## Post-installation sync regression — 0.6.1-alpha.1

Owner confirmed the 0.6.0-alpha.1 HACS installation. Outbound user synchronization failed.
The real station reproduced the failure with the production manager, including the error that
identified begin/end validity fields. Read-only existing/missing-user searches all passed.
After using accepted permanent-validity bounds, production-manager create and name-only update
reached `synced`; the credential-free test user was deleted and absent. Existing user/card
canonical records were unchanged. No relay operation or PIN/card write was performed.

A time-limited UTC sample returned contradictory local/offset metadata, retained as an explicit
failure rather than interpreted. The separate earlier temporary PIN test still requires its
supervised retry and cleanup. The new synchronization test accounts were fully removed.

Local validation of the sync correction: 335 Python tests, 16 browser tests, Ruff, mypy
(24 modules), TypeScript and the bundled frontend build passed. GitHub CI additionally runs
the real Home Assistant suite, HACS and Hassfest; publication is gated on those checks.

## Fleet status and access summaries — 0.7.0-alpha.1

Local validation passed: 339 protocol/access/event tests, 20 browser tests, Ruff, mypy
(24 modules), TypeScript, frontend build and release metadata. New regressions cover
pending user/station deduplication with PIN/card/deletion overlap, offline revocation and
recovery, saved-state restart, chronological timezone ordering, late replay, clock outliers,
unknown access outcomes and privacy. Browser coverage includes masked-card suffix search,
removal acknowledgement refresh, offline details and Hebrew mobile layout.

The release workflow also gates publication on the real HA suite, HACS and Hassfest.
HA regressions exercise successful status timing, failure/recovery and the admin overview's
safe access projection. No live station writes or relay operations are needed for this update.

## Read-only station inspection and fleet assignment — 0.8.0-alpha.1

344 local protocol/access/event tests passed, including pending-write isolation during rescans,
shared-read cancellation, station unload, post-write inventory freshness and safe failure logs.
24 browser tests cover inspection controls, capability/connection distinctions, validated lock
mapping, explicit bulk assignments, cancellation before saving and Hebrew mobile layout.
Ruff, mypy (24 modules), TypeScript, bundle build and release metadata validation passed.

New real HA tests exercise both service and WebSocket rescan entry points, pending-write
isolation, exception privacy, capability projection, camera-only reload and unloaded station
mapping. Those checks, reproducible frontend output, HACS and Hassfest gate publication.
No physical station command or new ISAPI behavior is introduced by this update.


## Admin completion — 0.9.0-alpha.1

Local protocol/access checks: 354 passed. New regressions exercise Save without an immediate
worker, preservation of the scheduled callback, persistence and reconcile after restart, failed
storage without writes, and backwards-compatible optional lock names. Browser coverage includes
save/create/update/error handling, named-lock surfaces and unchanged targets, future/current/expired
periods across UTC offsets, refresh while offline, and Hebrew mobile actions/validity.
Real HA configuration, entity identity/name, admin projection and strict API-mode validation tests
are included in CI. Release publication remains gated on the complete checks for its main commit.
No physical credential/relay operation was performed for this release; unresolved commissioning
results from earlier sections are unchanged.


Admin-completion code `4efe4e0ebfe568dff1487542bcb2ced58ef30756` passed all branch CI:
354 protocol/access tests on Python 3.12 and 3.14, 119 actual Home Assistant tests,
30 browser tests, Ruff, mypy, TypeScript and reproducible frontend build. ConfigFlow retains
100% coverage. Python checks: 34254503208; HACS: 34254503166; Hassfest: 34254503200.
The owner is currently unavailable for supervised physical checks; those gates remain deferred.


## Independent door controls — 0.9.1-alpha.1

The new held-response browser regression failed on 0.9.0 because door 2 was disabled while door 1
was pending. Coverage now exercises independently clickable targets, out-of-order completion,
same-door guards across views, isolated failures/no automatic retry, slow overview refresh,
external HA unlocking state, discarded late results, reconnect subscriptions and Hebrew mobile.
HA transport tests use two distinct mock station runtimes and verify second-station completion
while the first remains blocked, rejection of a same-target duplicate, and a later first-station
failure without changing the second result. No live station or physical lock was used.


Independent-door code `93538ecc24bd4e23791ac8ba3c3191be516b407f` passed all branch CI:
354 protocol/access tests on Python 3.12/3.14, 123 actual HA tests, 38 browser tests,
Ruff, mypy, TypeScript and reproducible bundle checks. ConfigFlow coverage remains 100%.
Python checks34259688049; HACS34259688072; Hassfest34259688067. HA job102174232294
confirms independent runtime completion, same-target guarding and safe failure translation.
These tests mock device I/O and do not close the outstanding physical commissioning gates.


## Detailed reconciliation review — 0.10.0-alpha.1

Local protocol/access suite: **367 passed**. Ruff checks/formatting and mypy (25 modules) pass.
The browser suite contains **44 tests**, including ten-field comparison, masked equal-suffix card
changes, concurrent central updates, explicit fresh reads, unsupported-action explanations,
stale-device invalidation and Hebrew mobile layout. Screenshots contain synthetic data only.
Two new real HA WebSocket tests exercise the production manager's read-only review, redaction and
stale-revision rejection in both resolution directions. Exact CI results are recorded after the gate.

Review does not queue writes or mutate storage; regression tests compare repository snapshots and
track device mutation calls. It reuses existing canonical/desired-state builders and documented
read endpoints. Logical previews do not establish physical access or reserve capacity. No actual
hardware operation was performed for this change. See COMPLETION_HE.md for every acceptance item.


Final review code `bd036318b09b8e14c95b020838e9117aef888eac` passes **536 tests**:
367 protocol/access (both Python 3.12 and 3.14), 125 actual HA and 44 browser tests.
ConfigFlow coverage remains 100%; Ruff, mypy, TypeScript, formatting and reproducible bundle pass.
[Python checks](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34262840733),
[HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34262840762),
[Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34262840704).
HA job `102184823735` confirms 125 passing tests; frontend job `102184823802` confirms 44.
The release workflow `34263065754` reruns gates on this fixed code commit before publishing.
Feature commit `438f5b9` and follow-up `bd03631` remain independently reviewable in Git history.


## CSV batches and activity reports — 0.11.0-alpha.1

Local protocol/access validation: **394 passed**, Ruff lint/format and strict mypy on 27 modules
passed. The browser suite passed **51 tests**; the Hebrew mobile snapshot test was rerun after
updating the release version. TypeScript and the production frontend build pass.

New cases cover whole-batch credential/identifier collisions, explicit clearing versus omitted
fields, stable no-op export roundtrip, stale central/station reviews, offline retirement,
failed storage, cancellation during worker preparation and 500 users across nine simulated
stations with one queued request per station. Reporting covers all filtered retained pages,
UTC days and separate authentication/unlocking counts. The UI verifies private previews,
explicit confirmation, stale-review behavior, file downloads and discarded late exports.

New actual Home Assistant tests exercise the five admin-only commands, persisted CSV batches,
private debug logs, safe malformed/oversized input errors, failed storage and multi-page event
report/export. Their GitHub CI results are recorded after execution below. Device I/O is mocked;
no physical credential, relay or call test was performed in this release's development.


CSV/report code `442d798eb16f5a4b85b0682be416e2454ecdf833` passed every branch check:
**394 protocol/access + 134 actual Home Assistant + 51 browser tests (579 total)**.
Python 3.12/3.14, Ruff, mypy (27 modules), TypeScript, formatting, reproducible frontend
bundle, HACS and Hassfest all pass. ConfigFlow remains at 100% line coverage.

- [Python/HA/frontend checks](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34268116415)
- [HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34268116401)
- [Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34268116403)

HA job 102202548749 completed 134 tests; browser job 102202548790 completed 51 tests.
These tests use mock station I/O. The exact main code commit is submitted to the gated
release workflow for `v0.11.0-alpha.1`; the validation documentation commit changes no runtime.


## Reader-based card enrollment — 0.12.0-alpha.1

Local protocol/access validation: **425 passed**, including 31 new collection/session cases.
Ruff formatting/lint and strict mypy on 29 modules pass. New actual Home Assistant transport
cases cover collection capabilities/start/status/approval/cancellation, strict reader fields,
revision conflicts and private WebSocket debug logs. All five commands also inherit the
parameterized administrator-denial regression. Linux CI results are recorded below when complete.

Client tests verify explicit capability gates, default-reader omission, selected-reader checks,
malformed result rejection and normal station I/O completing while collection is pending.
Session tests cover private previews, admin ownership, expiry, cancellation/unload, capacity,
credential conflicts, stale revisions, failed storage and noninterruptible duplicate-safe saves.
Browser tests cover explicit confirmation, unsupported devices, late start/status cancellation,
concurrent user edits, uncertain save replies and Hebrew mobile footer controls.

A real read-only check retrieved device identity, AccessControl capabilities and CaptureCardInfo
capabilities. It confirmed DS-KV6124-E1 V3.9.0 build260115, support=true and card length1–32;
reader-selection capability was absent. No actual collection, access-record mutation or relay
command was issued. The sanitized response projection is stored in
[the fixture](../tests/fixtures/capture_capabilities_readonly.json).
[HW-ENROLL](CARD_ENROLLMENT.md) remains a deferred supervised test, as do prior physical gates.

Local frontend validation: **58 browser tests passed**, TypeScript and production build passed.
The Hebrew mobile screenshot was inspected after moving approval/retry controls into a wrapping
footer. An uncertain-save regression verifies that a stored card is not falsely described as
unsaved after its acknowledgement is lost.


Enrollment code `018e10a94fd18fde85bf3b80821e0a0163406961` passed every branch check:
**425 protocol/access + 142 actual Home Assistant + 58 browser tests (625 total)**.
Python3.12/3.14, Ruff, mypy29 modules, TypeScript, formatting, reproducible bundle, HACS
and Hassfest all pass. ConfigFlow line coverage remains100%.

- [Python/HA/frontend checks](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34274523581)
- [HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34274523587)
- [Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34274523629)

HA job102224124289 completed142 tests; frontend job102224124436 completed58 tests.
The production CardCaptureClient was also run in read-only capability mode against the
commissioned firmware. Identity verification and capability parsing passed; default reader
and length1–32 were returned. No collection or access/relay operation was requested.
The exact main code commit is submitted to the gated v0.12.0-alpha.1 release workflow;
this validation documentation commit changes no runtime behavior.


## 0.13.0-alpha.1 — local schedule planning and read-only readiness

Local protocol/access suite: **475 passed**, including50 new calendar, holiday-precedence,
revision, capacity, corrupt/failed/interrupted storage and no-write readiness cases.
Browser suite:58 existing cases passed and all7 new schedule cases passed after correcting
an explicit accessible label on the station selector. TypeScript/build/format/Ruff pass.
The Windows application-control policy blocked a mypy dependency DLL; strict typing and actual
Home Assistant tests are delegated to the required Linux GitHub checks before publication.

Two live GET-only passes verified advertised schedules and reproduced status3 on all four ID1
reads. The second pass used the production readiness client with expected station identity.
No device writes occurred. Physical schedule enforcement is unavailable, not validated.


Schedule implementation `ca2d9a239e7406a5cc6012b2786e6eb2dd51016e` passed every branch gate:
**475 protocol/access + 153 actual Home Assistant + 65 browser tests (693 total)**.
Python3.12/3.14, Ruff, mypy31 modules, TypeScript, formatting, reproducible bundle, HACS
and Hassfest passed. ConfigFlow remains100% line coverage. The initial holiday-list type
inference error was fixed before publication; Linux strict typing passes on this final code.

- [Python/HA/frontend](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34277952570)
- [HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34277952529)
- [Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34277952587)

HA job102235526270 completed153 tests; frontend102235526162 completed65 tests.
The code is on main and the [gated release run](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34278274318)
checks the same code before publishing v0.13.0-alpha.1. This documentation update changes no runtime code.

## 0.14.0-alpha.1 — device time zones and manual display override

Local browser suite: **72 passed**, including seven clock cases with America/Los_Angeles as
browser zone and the observed station rules. TypeScript, production build and formatting pass.
The Hebrew mobile clock screenshot was inspected. DST gaps/folds reject newly entered times;
existing exact instants and seconds survive a display-zone change. All pre-existing release
independence and station-inspection cases pass.

Local Python suite: **501 protocol/access tests**, including26 new clock cases. After the
version bump, the release-metadata test initially ran before the new changelog was written;
all eight tooling tests pass after documentation is complete. Ruff passes. Actual HA and strict mypy remain
required Linux CI gates, as the local Windows policy blocks a mypy dependency DLL.

Two live GET-only probes confirmed the clock contract. The production ClockClient verified
station identity, parsed the April/October device rules and returned localTime+03:00 in NTP
mode with rounded skew0 seconds. The committed fixture contains only clock data. No clock,
NTP, credential, schedule or relay settings were changed. See [TIME_ZONES.md](TIME_ZONES.md).

Clock implementation `8c09e8a26ccfaf9ee756dc91846b8c1be73b9b14` passed every branch gate:
**501 protocol/access + 159 actual Home Assistant + 72 browser tests (732 total)**.
Python3.12/3.14, Ruff, strict mypy33 modules, TypeScript, formatting, reproducible bundle,
HACS and Hassfest passed. ConfigFlow retains100% line coverage. The release-metadata test
passes in both full CI suites with the completed versioned changelog.

- [Python/HA/frontend](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34281690085)
- [HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34281690114)
- [Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34281689989)

HA job102247708197 completed159 tests; frontend102247708205 completed72 tests.
The code is on main; [gated release34281938284](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34281938284)
validates the same commit before publishing v0.14.0-alpha.1. This evidence update changes no runtime code.


## 0.15 — schedule inventory and compatibility assessment, 2026-09-09

Local Windows validation: **533 protocol/access tests** and **77 Chromium browser tests** passed.
Ruff lint/format, TypeScript, Prettier, frontend build and modified documentation links passed.
The Hebrew mobile assessment screenshot was visually checked. The Master Spec remains identical
to the owner-supplied file. The required Linux CI separately checks Python 3.12/3.14, strict mypy,
actual Home Assistant 2026.9.1, reproducible frontend output, HACS and Hassfest before release.
Local mypy remains unavailable because Windows application control blocks a dependency DLL;
no local bypass was used.

New tests exercise verified Search pagination/counts, partial bounds, invalid pages, identity,
authentication, privacy, disabled-record references, independent request locks and draft limit
assessment. HA cases cover invalid drafts before I/O, administrator guards, shared admission,
unavailable draft storage, no writes and late unload. Browser cases cover editing/station changes,
late responses, export, Hebrew mobile layout and other doors remaining independently available.

The production reader confirmed the commissioned device identity and returned 255/255 templates,
255/255 weeks, 64/64 holiday groups and 300/1024 holiday plans. The final inventory is partial
because the advertised search-position maximum is 256. One holiday group is enabled; disabled
templates reference 255 weekly IDs. No resource is inferred free. The read used 29 capability/search
calls after identity confirmation, without credential, schedule, clock or relay mutations.
See [the observed contract and sanitized fixture](SCHEDULE_INVENTORY.md). Physical gates and
mandatory acceptance (28/38) are unchanged.


Code commit `a6c4c25d8c50b8d7a06fae8bf24b9d95049404dd` passed all required branch gates:
[Python / actual HA / frontend](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34285972179),
[HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34285972146) and
[Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34285972221).
Verified CI totals: **533 protocol/access + 165 actual HA + 77 browser = 775 tests**.
Both Python versions passed; strict mypy checked 35 modules; ConfigFlow coverage remains 100%.
The exact code was fast-forwarded to main, and the gated 0.15.0-alpha.1 release was dispatched
against that frozen SHA. This paragraph records CI success; publication is verified separately.


## 0.16 — persistent schedule references, 2026-09-09

Local Windows checks passed with 567 protocol/access cases, Ruff lint/format and TypeScript.
The new browser cases cover explicit save/cancel, reference comparison, token-free report export,
local clear, unknown save outcomes, station isolation and Hebrew mobile layout. The mobile
comparison screenshot was visually reviewed; modified documentation links and the unchanged
Master Spec were verified. The full browser run passed all 82 cases; Prettier and the production frontend build passed.
Required Linux CI results are recorded below when complete.
Local strict mypy still uses the required Linux CI gate because Windows blocks a dependency DLL.

Reference tests cover independent private storage, per-installation keyed fingerprints, restart,
failed and cancelled persistence, stale/expired/cross-actor/cross-station tokens, bounded state,
identity/firmware changes, corrupt input, same-count content changes and partial-search uncertainty.
HA cases exercise real private Store roundtrips, administrator API/privacy, no device mutations,
unavailable reference storage, stale observation rejection and core setup after reference corruption.

Two production reads at 2026-09-09T04:43:50Z and 04:43:59Z used the same verified Search contract,
with a local reference save and reload between them. Each captured 255 templates, 255 weekly
plans, 64 holiday groups and 300 holiday plans. No content or capability differences were observed;
three resource searches were complete and holiday coverage remained partial. No station schedule,
credential, clock or relay write was performed. Changing a real active schedule was not part of
this check. Private evidence remains local; see [reference behavior and limits](SCHEDULE_BASELINES.md).

References establish neither resource ownership nor an editable backup. The write/allocation/user
association pipeline is still pending; mandatory acceptance remains 28/38 and both Phase 6 schedule
extensions remain partial.


Code `c7f776aba377f1fe506f5330c78238bf5d4aecea` passed all required branch checks:
[Python / actual HA / frontend](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34312562587),
[HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34312562584),
[Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34312562589).
Verified totals: **567 protocol/access + 172 actual HA + 82 browser = 821 tests**. Strict mypy
passed for 36 modules; ConfigFlow coverage remains 100%. Both Python versions passed. The exact
code was merged to main and submitted to the gated 0.16.0-alpha.1 release workflow; publication
is verified separately after its gates complete.


## 0.17 schedule workflows — local validation (2026-09-09)

Four sequential feature commits:

| Task | Commit | Targeted checks |
| --- | --- | --- |
| Explicit user dependency audit | `a4c0212` | 45 protocol/inventory cases; 6 assessment browser cases |
| Multi-station assessment queue | `1960979` | 14 queue/assessment/baseline browser cases |
| Atomic portable draft transfer | `1007914` | 63 draft/transfer protocol cases; 10 transfer/draft browser cases |
| Clone and copy windows | `0ea93bd` | 10 editing/draft browser cases; Hebrew mobile screenshot inspected |

Full local Python 3.12 suite: **593 passed**; full Chromium suite: **92 passed**.
TypeScript, Prettier and Ruff lint/format passed; versioned release metadata
validated as 0.17.0-alpha.1. Strict mypy and actual Home Assistant adapters run on Linux CI;
the local Windows mypy DLL remains blocked by host application control.

The production-client dependency audit at 2026-09-09T05:28:38Z returned three users, all classified
as unknown defaults (no explicit RightPlan references), with no malformed assignments. Holiday
inventory coverage remains partial. Zero station writes. Non-empty references are validated with
manufacturer-derived synthetic tests, not claimed as physically verified enforcement.

Initial browser checks found a test using the wrong reload label and a source-day select without
an explicit accessible label; both were corrected. Mobile inspection also corrected checkbox
alignment. No failed physical test was reclassified as a software pass.


### Exact release-code CI — `41f044fd60f67cc4b1c270157cf52b97c380a7ad`

- [Python/HA/frontend checks](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34315726261): all four jobs passed.
- Python 3.12 and 3.14: **593 protocol/access/tool tests passed** on each interpreter (counted once).
- Actual Home Assistant 2026.9.1 / Python 3.14: **178 passed**, ConfigFlow **100%** coverage.
- Chromium: **92 passed**; TypeScript, Prettier and reproducible frontend build passed.
- Ruff lint/format and strict mypy: passed, **37 modules** checked.
- [HACS](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34315726266) and
  [Hassfest](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34315726232): passed.
- Total unique suite cases: **863 = 593 + 178 + 92**. The four requested workflow tasks are complete;
  this count does not represent physical test coverage or completion of the full Master Spec.

Initial CI identified a class method named `list` shadowing an annotation and a reused loop variable
with incompatible types. Commit `41f044f` corrected both; all final gates above passed afterward.
Version metadata/changelog preparation is `ff24ccd`; the four feature commits are listed above.
The release workflow rechecks the frozen code SHA before producing the tag and notes.


## 0.18 deployment proposals — local validation, 2026-09-09

Compiler, comparator and proposal persistence tests cover capability bounds, every advertised
period slot, unknown fields, dependency references, private fingerprints, source/device/actor
binding, expiry, local reservations, atomic failed/cancelled saves and original-observation drift.
A combined selected-record/fingerprint regression catches accidental loss of captured records;
the corrected production-client path was verified against the commissioned device.

A fresh local save/reload/recheck completed at 2026-09-09T06:29:29Z: template and weekly records
were observed disabled and different from the proposed configuration. The weekly record was
referenced by an external template. Three users had implicit/unknown defaults; holiday coverage
remained partial. No observation drift occurred and zero station writes were sent. Raw device
records and private comparison-store contents are excluded from publication.

Full local Python 3.12 suite: **631 passed**. Actual HA adapters and strict mypy are validated in
Linux CI; the local mypy native module remains blocked by host application control. Browser tests
cover local save/export/remove, source changes during reads, unknown save responses, independent
release controls and Hebrew mobile layout. Final CI results are recorded after their completion.

Full local Chromium suite: **96 passed**. TypeScript, Prettier and frontend build passed after
version preparation. Ruff lint/format passed. Total local cases: **727 = 631 + 96**.

### Verified GitHub checks on release code `2ec180c`

- Python 3.12 and 3.14: **631 passed** each, counted once; Ruff lint/format passed.
- Strict mypy: **41 source files**, no issues.
- Home Assistant 2026.9.1 / Python 3.14: **188 passed**, ConfigFlow **100%** line coverage.
- Chromium: **96 passed**; TypeScript, Prettier and reproducible frontend build passed.
- [Python/HA/frontend run34319854908](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34319854908), [HACS34319854797](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34319854797), and [Hassfest34319854750](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34319854750) all succeeded.
- Total unique suite cases: **915 = 631 + 188 + 96**.

The exact passed code was merged to main and submitted once to gated release run
[34320132238](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34320132238).
The release workflow reruns all gates before creating the tag. Physical gates remain unverified.


## 0.19 schedule recovery infrastructure — 2026-09-09

55 targeted cases pass for journal validation, atomic failed/cancelled saves, persisted intent,
unknown acknowledgements, readback, context/resource conflicts, nine independent synthetic stations,
transport gate revocation, bounded retention and CLI simulation/restart. The standalone simulator
completed all nine scenarios with zero network requests and zero recovery writes. No station was
contacted and no physical acceptance result changed. The production adapter remains unregistered.

The simulator report was saved privately as `.tools/schedule-recovery-simulation.json`; reproduce
it with `python -m tools.simulate_schedule_recovery`. Its output is explicitly synthetic.
Full-suite and GitHub validation results are recorded after completion below.

Full local Python 3.12 suite: **686 passed**. Ruff lint/format, TypeScript, Prettier,
frontend build and version metadata validation passed. Strict mypy and actual HA/frontend tests
run in Linux CI. The blocked local mypy native module was not bypassed.

### Verified GitHub checks on `a48bada`

- Python 3.12 and 3.14: **686 passed** each (counted once); Ruff lint/format passed.
- Strict mypy: **44 source files**, no issues. The initial missing simulator annotation was fixed.
- Actual Home Assistant 2026.9.1 / Python 3.14: **188 passed**, ConfigFlow **100%** coverage.
- Chromium: **96 passed**; TypeScript, Prettier and reproducible frontend build passed.
- [Run34324017582](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34324017582),
  [HACS34324017540](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34324017540),
  [Hassfest34324017557](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34324017557) all succeeded.
- **970 total unique suite cases = 686 + 188 + 96.** All 21 batch paths passed private-value scanning.

The exact passed commit was merged to main and submitted once to gated release run
[34324306989](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34324306989).
The release reruns every gate before publishing. No production schedule transport is enabled.


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


### Verified final checks on `947a2d0`

- Python 3.12 and 3.14: **709 passed** each (counted once), Ruff lint/format passed.
- Strict mypy: **46 source files**, no issues.
- Actual Home Assistant 2026.9.1 / Python 3.14: **203 passed**, ConfigFlow **100%** coverage.
- Chromium: **100 passed**; TypeScript, Prettier and reproducible bundle checks passed.
- **1,012 unique test cases = 709 + 203 + 100.** The final three regressions cover cancelled
  enqueue, shutdown during queue persistence and cancellation before a worker's first turn.
- [Python/HA/browser34335293122](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34335293122),
  [HACS34335293131](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34335293131),
  [Hassfest34335293115](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34335293115)
  all passed. All 32 batch paths passed private-value scanning.

The passed commit was fast-forwarded to main and submitted once to gated
[release34335552283](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34335552283).
The release workflow reruns every gate and publishes the frozen `947a2d0` commit. The user guide
records the production-write and physical-acceptance limits; no device request was made in this batch.


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


## Core/media batch — 0.21.0-alpha.1

Final code `e1b23627a1bba72882d7616b64ee886492eb2254`:754 protocol/access/tool tests,
215 real Home Assistant tests,112 browser tests;1081 total, counting Python versions once.
ConfigFlow100%, strict mypy51 modules, Ruff/TS/Prettier/build reproducibility, HACS and Hassfest passed.
Release workflow34345012158 completed before remote tag/manifest/bundle verification.
New regression cases cover event privacy/origin/ties, acceptance durability/revisions, read-only
health refresh isolation, call-command serialization, media capability fallback and WebRTC cleanup,
HLS fallback, delayed config responses and a received track that never produces decoded video.

Authorized read-only station checks verified Search readiness and call/audio capabilities.
Both stations passed18/18 status reads in90seconds (p95 187ms/141ms); this does not close the
nine-station soak/recovery gate. One station clock used manual UTC and was approximately8hours
ahead. No clock, user, PIN, card, schedule or audio setting was changed; no live call or door command
was sent. Identity issue correlation, two-way audio and physical call acceptance remain open.
See CORE_MEDIA_BATCH_HE.md for the full20-task ledger and HEALTH_AND_MEDIA.md for usage.
