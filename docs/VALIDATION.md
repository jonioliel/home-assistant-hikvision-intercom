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
