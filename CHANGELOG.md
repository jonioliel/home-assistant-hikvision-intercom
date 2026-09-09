# Changelog

Semantic Versioning is used throughout the project.

## [Unreleased]

## [0.16.0-alpha.1] - 2026-09-09

### Added
- Persistent schedule references: explicitly save a station's observed configuration fingerprints,
  compare later assessments, replace the reference or clear it. References survive Home Assistant
  restarts in an independent private store; failed persistence preserves the previous reference.
- Detect changed record contents and advertised capabilities even when counts match. Show bounded
  resource-ID lists for observed changes, and distinguish unseen records from proven presence changes
  in completed searches. Partial searches never establish deletion or previously absent records.
- Administrator-only, station/actor/identity-bound observation tokens expire after five minutes and
  become invalid after another assessment, save or clear. Identity/firmware changes require a new
  reference; uncertain save responses require inspection without an automatic retry.
- Per-installation keyed fingerprints exclude raw configuration contents from storage and reports.
  Downloaded reports omit observation tokens. Independent Repairs report reference-storage failures
  without disabling inventory assessment, schedule drafts or existing access management.

### Scope and limits
- References record observations, not resource ownership or editable configuration backups. Searches
  remain non-atomic and holiday coverage remains partial on the commissioned firmware. Applying
  schedules, allocating device resources and assigning users are still unavailable.
- Comparisons run on requested assessments, not as background monitoring. No station schedule,
  credential, clock or relay writes are introduced. Mandatory acceptance remains 28/38 (73.7%);
  weekly schedules and holidays remain partially implemented Phase 6 extensions.

## [0.15.0-alpha.1] - 2026-09-09

### Added
- Draft compatibility assessment in Access schedules: select a station, check the current
  draft against its advertised period counts, time precision, weekdays and resource ranges,
  and download the result. Unknown constraints remain explicit. Edits, station changes,
  reloads and navigation invalidate old or late assessment results.
- Read-only schedule inventory through firmware-observed Search endpoints. Searches read
  validated pages for templates, weeks, holiday groups and holidays using advertised bounds.
  Reports distinguish completed, partial, unsupported and failed queries and show validated
  counts and references without station configuration names or raw records.
- A separate I/O lane preserves ordinary call/release access while checking schedules.
  Identity checks, a 60-second read deadline, bounded pagination, shared per-station/fleet
  admission and administrator-only access govern every check. No automatic write or retry.

### Fixed
- Diagnostics can now read schedule records even when direct per-ID GET requests return
  device status 3. A failed GET remains a failure; it is not reinterpreted as an empty slot.
- Activity-report documentation now describes the station-local grouping introduced in 0.14.

### Evidence and limits
- Live production-client reads returned 255 templates, 255 weekly plans and 64 holiday groups,
  including one enabled holiday group. 300 of 1024 holiday plans were read before reaching the
  advertised search-position bound; the result is explicitly partial. These are records read,
  not available allocation slots. The Search query enable=false can return enabled records.
- Ownership and user references are not scanned. Disabled records and identifier ranges are
  never treated as free capacity. Holiday group member limits are not inferred from ID ranges.
- Applying schedules, allocating device resources and assigning them to users remain unavailable.
  No schedule configuration, access credential, clock or relay writes occurred in this work.
- This improves the two partial Phase 6 schedule features; mandatory acceptance remains 28/38
  (73.7%). Physical PIN/validity/card/ring/video/fleet commissioning remains open.

## [0.14.0-alpha.1] - 2026-09-09

### Fixed
- Station timestamps now follow the station's configured time zone and daylight-saving rules
  by default, independently of the browser's zone. UTC and offset-aware source timestamps
  are converted once; stored events and synchronization instants remain UTC.
- Validity editing and event date filters use an explicitly labelled zone. Nonexistent and
  ambiguous newly entered DST times are rejected. Unchanged validity retains its exact instant
  and seconds; changing the display zone preserves the instant.
- Daily activity summaries use each record's station-local calendar day. Event CSV retains
  its original timestamp and adds display_timestamp and display_timezone columns.

### Added
- Per-station Home Assistant Options: follow the device (default) or select a manual IANA
  display zone such as Asia/Jerusalem. The integration reads /ISAPI/System/time on load and
  every 15 minutes; the Intercoms screen shows the clock source, sample, offset, read time,
  approximate skew and an independent Read station clock action.
- Verified cached rules survive a later read failure with a stale warning. Before any valid
  device read, display falls back explicitly to UTC; a manual zone works without that read.
- English/Hebrew documentation: [time zones, DST and input behavior](docs/TIME_ZONES.md).

### Validation and limits
- Live identity-checked GET using the production clock client confirmed UTC+03:00, NTP mode,
  base UTC+02:00 plus a one-hour seasonal increment and the configured April/October rules.
  Measured rounded skew was zero seconds. No device clock, NTP, credential or relay write occurred.
- Automated coverage includes DST transitions, offsets already present in API responses,
  manual IANA override, a browser in a different zone, report day boundaries, actual HA options,
  authorization, refresh/unload lifecycle and Hebrew mobile display.
- Current device rules describe the present configuration, not its historical changes. Other
  formats fail explicitly. Physical DST-transition acceptance and timed-credential enforcement
  remain deferred; validity_timezone_mismatch protection is unchanged.

## [0.13.0-alpha.1] - 2026-09-08

### Added
- Central schedule planning: named weekly drafts, up to eight windows per day, holiday date
  exceptions and a local-date/time preview with explicit holiday precedence. Empty holiday
  windows close the draft day; overlapping periods/dates and ambiguous overnight windows
  are rejected. End-of-day 24:00 is supported. Drafts are not applied to stations or users.
- Independent, private, atomic Home Assistant schedule storage with revision checks, bounded
  library size, cancellation-safe persistence, corruption preservation and Repairs. Existing
  user storage and synchronization remain independent of draft availability.
- English/Hebrew mobile schedule editor with add/edit/delete, unsaved-change checks, stale
  revision handling and explicit reload after an uncertain save. Preview never claims actual
  credential acceptance, timezone conversion or door access.
- Read-only station readiness checks for permission templates, weekly plans, holiday groups
  and holiday plans. Fresh identity and advertised bounds govern the sampled ID. Results
  contain sanitized counts/errors and can be exported; device configuration names and raw
  payloads are omitted. At most one check per station and three in the fleet, with deadlines.

### Validation and limitations
- Live GET-only checks against DS-KV6124-E1 V3.9.0 build260115 confirmed advertised ranges
  1–255 for templates/weeks, 1–64 for groups and 1–1024 for holidays. Every sample-1 GET
  returned device status 3. A failed GET is never treated as an empty or available slot.
- Schedule allocation, device writes, RightPlan assignment and physical enforcement remain
  unavailable pending protocol/ownership/readback validation. Even successful readiness
  reads do not enable assignment. No schedule, credential or relay write occurred in this work.
- Automated tests cover calendar/window boundaries, holiday overrides, concurrency, failed
  and interrupted saves, actual HA authorization/storage/privacy and browser workflows.
- Mandatory acceptance remains 28 of 38 applicable items (73.7%), ten open (26.3%).
  Weekly/holiday Phase 6 work has progressed to planning, not completed device enforcement.

## [0.12.0-alpha.1] - 2026-09-08

### Added
- Reader-based card enrollment for an existing central user: choose a station/advertised reader,
  explicitly start collection, inspect a masked result, then confirm before adding a normal card
  and reconciling existing assignments. Fresh device identity/capability checks gate every start.
- Manufacturer-documented CaptureCardInfo workflow. The commissioned firmware advertises support
  and card length 1–32; its detailed capabilities do not advertise reader selection, so the
  documented default-reader request omits readerID. Collection technology is never confused with
  the access-control cardType enum. Unsupported or malformed capabilities/results fail closed.
- Administrator-owned, ephemeral collection sessions: one per station, three across the fleet,
  30-second collection request and two-minute session lifetime. Full card numbers remain in backend
  memory until explicit storage; only masked previews reach the browser. Cancel, expiry and unload
  discard the private result. Existing ownership, uniqueness, capacity and revision guards apply.
- A separate collection I/O lane avoids holding the normal poll/snapshot/release lock while waiting
  for a card. Requests are bounded and never automatically retried. Cancelling HA's request does
  not claim to reset the firmware's reader mode or change its local access rules.
- English/Hebrew mobile workflow with persistent footer actions, cancellation on close, stale-user
  approval protection and discarded late responses. An uncertain save response directs the admin
  to inspect Users/Sync, without claiming that nothing was saved or automatically retrying.

### Validation and commissioning
- Automated coverage includes actual HA WebSocket authorization/privacy, unsupported capabilities,
  exact default/selected-reader requests, isolated normal I/O, lifecycle/expiry, duplicate approval,
  concurrent edits, failed storage and Hebrew mobile behavior.
- A live read-only check verified identity and both capability endpoints; no CaptureCardInfo
  collection request, credential mutation or relay command was issued during development.
  Physical collection and subsequent card acceptance/removal remain to be commissioned.
- No storage migration or expansion to other device models. PIN modification, timed validity,
  ringing/video and nine-station acceptance remain open. Optional Phase 6 now includes CSV,
  basic reporting and a capability-gated enrollment implementation; mandatory acceptance remains
  28 of 38 applicable items closed (73.7%), ten open (26.3%).

## [0.11.0-alpha.1] - 2026-09-08

### Added
- CSV bulk import/export in Users: a UTF-8 template, create-only or explicit update mode,
  secret-free row previews, changed-field and revocation indicators, and administrator confirmation.
  Up to 500 rows / 256 KiB are validated together, including employee/PIN/card collisions,
  station eligibility, observed capability limits and pending credential-removal reservations.
- Atomic central batch storage: no partially imported rows on validation or storage failure.
  A review token binds the file, mode, central revisions/ownership and captured station rules.
  Stale reviews require a fresh preview. Saved work uses existing independent station queues,
  fresh device validation, conflict protection and durable offline revocation; fleet writes are
  not an atomic transaction. Exports omit PINs and full card numbers.
- Activity reports and filtered CSV export across all matching retained records, rather than
  only the visible page. Totals, station/day breakdowns, authentication methods and recovery
  counts distinguish authentication from unlocking records. Daily groups use UTC; retention,
  missing-history and storage status remain visible. These are event counts, not unique visits.
- English/Hebrew responsive controls and spreadsheet formula neutralization. Late report
  responses cannot download a file after filters, permissions or panel lifecycle change.
- A deferred validation ledger links manufacturer contracts, observed firmware behavior and
  exact future commissioning steps without marking physical acceptance as passed.

### Performance and validation
- Bulk planning/preparation and CSV/report encoding run in workers. Large batches coalesce
  synchronization requests once per affected station. Cancelling preparation cannot publish
  partial state or overwrite a later edit; in-progress durable saves retain existing protection.
- Coverage includes 500 users across nine simulated stations, failed storage, concurrent edits,
  cancelled preparation, private previews/logs, real HA administrator enforcement, complete
  filtered reports, download lifecycle and Hebrew mobile layouts.
- No new ISAPI endpoint, storage migration or live physical/credential operation in development.
  PIN change/removal, card lifecycle, timed validity, ringing/video and nine-station acceptance
  remain deferred. CSV and basic reporting advance optional Phase 6; the mandatory tally remains
  28 of 38 applicable Definition of Done items closed (73.7%), ten open (26.3%).

## [0.10.0-alpha.1] - 2026-09-08

### Added
- Detailed read-only sync review compares ten fields of effective central and observed station
  state: presence, name, user type, validity, door rights, PIN, cards, schedules, administrative
  rights and biometric credentials. PINs remain write-only and card numbers remain masked.
  Credential differences are computed before masking, including cards with identical suffixes.
- Preview the logical user/PIN/card changes required by central state, including revocation for
  disabled/unassigned/deleted users, together with reconciliation targets and offline status.
  Importing device fields explicitly explains its fleet-wide impact and preserves active state
  and assignments. The preview does not reserve capacity or prove physical access.
- Supported-action checks explain why a resolution is unavailable, including unmanaged ownership,
  unsupported schedules/credentials/door permissions and missing device records. Unknown PIN
  readback is displayed as unverified. Writes still require fresh validation and readback.
- English and Hebrew responsive field comparisons, read time, captured revision, applied revision,
  last reconciliation, changed-field highlights and an explicit Read comparison again action.

### Fixed
- Resolution uses the central revision captured with the review, rather than a newer background
  overview revision the administrator has not reviewed. Concurrent central edits disable approval;
  the backend rejects stale revisions before device reads and atomically before persistence.
- A stale-device or revision-conflict response invalidates the open review until it is read again.
  No automatic retry or silent overwrite is performed.

### Validation and scope
- Regression coverage exercises secret masking, identical card suffixes, disabled-card exclusion,
  timed-validity display, offline targets, unsupported fields, deletion, missing ownership,
  concurrent edits, real HA WebSocket privacy/revision handling and Hebrew mobile behavior.
- No new ISAPI endpoint, storage migration or live device mutation. Physical PIN/card lifecycle,
  validity enforcement, ringing/camera acceptance and nine-station soak remain open.
- A requirement-by-requirement completion ledger replaces previous rough estimates: 28 of 38
  applicable Definition of Done items are closed (73.7%); ten remain open (26.3%). The owner's
  two excluded Relay 2 selection items and optional Phase 6 do not enter this denominator.

## [0.9.1-alpha.1] - 2026-09-08

### Fixed
- Opening one door no longer disables the other stations' release buttons. Pending state is
  tracked per station across Overview, Intercoms and the camera dialog. The same station rejects
  repeated clicks while its request is in flight; other online configured doors remain usable.
- A slow overview refresh no longer prolongs a completed release request's busy state. Existing
  HA `unlocking` state is respected for its own station, including commands from other clients.
- Release progress, acknowledgement and safe errors appear beside the targeted station with
  the last request time. Missing acknowledgement is explicitly unconfirmed, never automatically
  retried or represented as proof of physical door state. Unknown exception details stay private.
- Panel reattachment reconnects immediately. Late release/overview responses from an earlier
  panel lifecycle cannot restore stale state or suppress a newer queued overview refresh.

### Validation and compatibility
- Regression tests hold responses pending, complete two station requests out of order, reject
  same-door duplicates, isolate failure feedback and verify reconnect and Hebrew mobile behavior.
- Real HA transport regressions cover concurrent independent station runtimes and known/unknown
  release errors. The existing per-station backend guards and fleet admission limits remain.
- No new ISAPI behavior, credential writes, storage migration or physical relay test in this change.
  Hardware PIN/card, ringing, timed validity and nine-station acceptance gates remain open.

## [0.9.0-alpha.1] - 2026-09-08

### Added
- Separate **Save** and **Save & sync** in the user editor. Both durably store changes first;
  Save leaves scheduling to automatic/already-running reconciliation, while Save & sync also
  requests immediate background work. Save does not pause synchronization or create a private draft.
- Optional active-lock names during setup/reconfiguration, displayed on the HA lock entity,
  Overview, camera dialog, Intercom details and user assignments. Retaining a confirmed mapping
  allows renaming without a release test, and the existing HA entity ID is preserved.
- Configured validity summaries in desktop/mobile user lists: no expiry, not started, within
  period, expired or unverified. Dates use the browser's local timezone, and summaries refresh
  as time passes even if a later overview request fails. Sync status remains separate.

### Compatibility and validation
- Legacy API clients retain immediate scheduling by default. The new `sync_now` field accepts
  only a boolean on user create/update commands; administrative authorization and redaction remain.
- Existing unnamed lock configurations remain valid. Emptying the name during reconfiguration
  restores the default label. No access storage/config schema migration or new ISAPI endpoint.
- Regression coverage includes durable deferred scheduling/restart, storage failure, legacy API
  behavior, lock renaming without release/entity recreation, timezones and Hebrew mobile layouts.
- Physical PIN/card lifecycle, timed enforcement, ringing and nine-station soak remain open.

## [0.8.0-alpha.1] - 2026-09-08

### Fixed
- **Rescan access capabilities** and the `rescan_station` action now read access capabilities
  and inventory without requesting synchronization or changing desired permissions. Previously,
  rescan shared the sync action and could initiate pending user/credential writes.
- Concurrent station scans share one bounded read. Cancelling one caller does not interrupt
  another; unloading the station cancels the shared scan. A final inventory read after writes
  cannot reuse a scan that started before those writes.
- Failed inspection preserves the last successful inventory and reconciliation timestamps,
  exposes a safe error category and keeps private exceptions out of HA background-task logs.

### Added
- Intercom cards show observed call/snapshot/video, user/card and event-query capabilities,
  configured physical/API lock mapping, live event connection and history recovery status.
  Capabilities that were not observed are labelled unverified, not presumed unsupported.
- Dedicated inspection progress/error feedback, configured-lock release and Home Assistant
  configuration controls in each Intercom card. Camera-only stations expose no release button.
- Deliberate **Select all eligible stations** and **Clear selection** in the user editor,
  with selected-station count and existing sync status. Offline configured stations can be
  selected; camera-only stations are excluded. Changes take effect only after Save & sync.
- English/Hebrew labels and desktop/mobile browser coverage for these workflows.

### Compatibility and validation
- No storage or configuration schema change. Rescan uses already implemented read endpoints;
  core camera/call observations retain their setup-time meaning. Existing scheduled sync still
  operates independently; use Sync now to explicitly request pending reconciliation.
- Regression coverage includes read-only rescans with pending writes, shared-reader cancellation,
  unload cleanup, post-write freshness, failure privacy, admin entry points and fleet assignments.
- Physical credential lifecycle, timed validity and nine-station commissioning remain open.

## [0.7.0-alpha.1] - 2026-09-08

### Added
- Overview station cards show the last retained access event with person, authentication,
  event time and historical/receipt-time context. Door movement is not interpreted as a
  successful credential use; unknown unlocking outcomes remain unknown.
- Offline cards show the last successful status contact and the number of users awaiting
  reconciliation. Intercom details include the last successful status-request duration,
  observed managed-user count and last fully successful reconciliation.
- Previous PIN removals awaiting confirmation are visible in the Sync screen, alongside
  card removals, assignment revocations and deleted users. No PIN value is exposed.
- Search central users by the four visible trailing card digits, name or employee ID.

### Fixed
- Count pending work once per user/station, including removals and saved write intents,
  instead of counting one person repeatedly or omitting credential removals.
- Sort event history by actual time across timezone offsets. Replayed older events,
  unrelated door events and future clock outliers cannot replace a newer access summary.

### Compatibility and validation
- No storage/config schema change, new device requests or new ISAPI write behavior.
- Last-contact/request/reconciliation observations are retained through disconnects in the
  current runtime; they are unknown after a fresh load until actually observed. Event history
  and pending removals retain their existing persistence and retention behavior.
- Regression coverage includes offline recovery, restart, overlapping removals, event replay,
  privacy, admin-only HA responses and English/Hebrew desktop/mobile screens.
- Physical PIN/card lifecycle, time-limited validity and sustained nine-station acceptance
  remain open. Historical access summaries do not trigger live automations.

## [0.6.1-alpha.1] - 2026-09-08

### Fixed
- Fix station-side rejection of new permanent users: this firmware rejects the generic
  1970/2037 validity endpoints even with validity disabled. Use the interior 2000/2030
  interval accepted by the station; `enable=false` continues to mean permanent access.
- Keep the actual user-sync failure visible in station summaries and show translated
  explanations directly in the Sync matrix, including while the station is offline.
- Report contradictory timezone readback for time-limited users explicitly, without
  guessing which timezone the firmware enforces or marking those records synchronized.

### Added
- Administrator-only **Download sync diagnostics** in the Sync screen. The bounded report
  includes request stage, pseudonymous station/user references, error category and recognized
  ISAPI status/field identifiers. It excludes names, employee IDs, addresses, credentials and
  request/response bodies. The last 200 stages are held in memory until restart.
- Debug logs for sync stages and throttled warnings for failures; cancelled work and unexpected
  worker failures are observable without logging exception text or payloads.
- Regression tests for rejected-date recovery with a saved write intent, firmware readback,
  cancellation, report privacy/bounds and administrator/browser access.

### Validation and acceptance
- Production manager created and updated a credential-free test user on the real station.
  Targeted deletion was verified, and all pre-existing users/cards were unchanged.
- HACS installation of the previous release was confirmed by the owner. This update still
  requires installation and a retry of the owner's pending user synchronization.
- Timed validity semantics, PIN/card physical lifecycle and remaining fleet commissioning
  are still acceptance gates. No PIN/card was created or lock activated by this fix test.
- No storage schema change; pending ownership intents and user assignments are preserved.

## [0.6.0-alpha.1] - 2026-09-08

### Combined release — Phases 2–5

This prerelease includes all changes below for versions 0.3–0.5 as well as Phase 5.
It upgrades the public 0.2 core integration with central user/PIN/card management,
the Hebrew/English administrator panel, camera/live-video views, synchronization,
import/conflict review, native events and bounded audit history.

Select `0.6.0-alpha.1` in HACS (enable beta versions if needed) and restart Home Assistant.
Requires Home Assistant 2026.9.1+. Back up HA before upgrading; configuration and private
access data migrate while preserving existing credentials and confirmed relay permissions.
Downgrading requires the matching backup. See [upgrade guidance](https://github.com/jonioliel/home-assistant-hikvision-intercom/blob/main/docs/HARDENING.md).

Validation: 328 protocol tests, 104 real Home Assistant tests and 14 browser tests;
Ruff, mypy, TypeScript, reproducible frontend bundle, HACS and Hassfest.
The release workflow reruns required checks on the exact publication commit.

### Phase 5 hardening

- Add private-free diagnostics for request timing, capability limits and synchronization queues.
- Add translated Repairs for storage failure, changed identity/mapping, capability regression,
  authentication, capacity and persistent conflicts; transient offline states stay out of Repairs.
- Validate and migrate config entries to 1.2 and private access data to schema 2 without changing permissions.
- Reserve replaced PINs until all former stations confirm removal; preserve ownership across restart/deletion.
- Bound administrator concurrency/rate, stored-file reads and event retention writes.
- Add repeated nine-station simulated recovery tests and a successful concurrent read-only station check.
- Physical PIN/card lifecycle, nine-station soak and real HACS install/upgrade remain acceptance gates.


## [0.5.0-alpha.1] — Phase 4 (included in 0.6.0-alpha.1)

- Add bounded alert-stream framing for the station's nested JSON MIME messages.
- Normalize documented access events without inferring physical door movement or call answer.
- Add native doorbell/access event entities, call-status edge fallback and reconnect cleanup.
- Persist up to 5,000 masked audit records with 30-day retention, filters and history recovery.
- Provide the Hebrew/English administrator Events view; no PINs or complete cards in event state.
- Validate the production client with 241 queried records and a bounded live stream capture.


## [0.4.0-alpha.1] — Phase 3 (included in 0.6.0-alpha.1)

### Added — Phase 3
- Bundled Lit/TypeScript administrator sidebar: overview, users/editor, devices and sync matrix.
- English/Hebrew RTL, mobile person cards, dark/light HA themes and keyboard-accessible dialogs.
- HA camera previews and enlarged HA HLS video; no direct device connection from the browser.
- Administrator-only WebSocket CRUD, import/adoption, conflict review, sync and release controls.
- Write-only PIN editing, masked existing cards, deletion confirmations and revision-aware saves.
- Coalesced data-free subscriptions and immediate ring/offline updates from normal HA entities.
- WebSocket payload filtering and private schema errors, including debug logging regression tests.
- Reproducible frontend bundle checks and Chromium UI tests in GitHub Actions.

### Validation and scope
- The panel uses the Phase 2 backend. Events/audit capture follows in Phase 4.
- Published together with Phases 2, 4 and 5 in the 0.6.0-alpha.1 prerelease.
- Physical acceptance and installation/upgrade on the owner's HA host remain pending.

## [0.3.0-alpha.1] — Phase 2 (included in 0.6.0-alpha.1)

### Added — Phase 2
- Capability-driven user/card access client with bounded complete pagination and explicit write transactions.
- Private central records, masked administrator views, revision/identity guards and durable ownership journals.
- User-deletion tombstones and retired-card reservations survive offline stations and restarts.
- Re-check the configured device identity before relay commands and credential transactions.
- Reconciliation with saved intent before every mutation, exact readback, lost-response recovery,
  revision protection and deletion/card-removal confirmation per station.
- Explicit import/adoption, central/device conflict review, ignored unmanaged people and targeted deletion.
- Private atomic HA Store, independent background station queues, admin sync actions and offline retries.
- Reject switching a station to camera-only while managed access still needs removal.
- Modify only changed supported fields; unchanged PINs are never resubmitted for a name edit.

### Validation and scope
- Backend software includes simulator coverage for nine stations, three concurrent writers,
  offline recovery, concurrent edits/deletion and persistence failure. Physical nine-station soak is pending.
- Existing device users are scanned without automatic adoption or modification.
- The administrator panel and public CRUD WebSocket interface arrive in Phase 3.
- Configuration readback is not proof of keypad/card acceptance. Physical PIN modification/removal,
  card CRUD, call transitions and HACS installation acceptance remain open.

## [0.2.0-alpha.1] - 2026-09-08

### Added
- Phase 1 core integration: setup, reauth/reconfigure, confirmed single-relay mapping,
  shared polling, camera, online/ringing/call status, momentary lock and an admin release action.
- English/Hebrew setup and entity translations, connection-safe diagnostics and lifecycle tests.
- Dedicated Home Assistant 2026.9.1 / Python 3.14 CI tests in addition to protocol tests.
- Settings validation, explicit physical mapping confirmation, offline backoff, snapshot caching,
  stable station identity, credential-safe RTSP source and optimistic lock-state display.
- Admin-only release action, translated errors and English/Hebrew setup/options.
- HA unload/reload/shutdown cleanup and guards against stale targets or changed station identity.

### Validation and scope
- Requires Home Assistant 2026.9.1+. All publication checks run against the exact release commit.
- Production-client read-only check passed on the target firmware without sending a release.
- One active physical relay per station; camera-only mode is supported.
- Central user/card/PIN management and the dedicated administrator panel follow in Phases 2–3.
- Physical PIN change/removal, card CRUD, call sequence and nine-station commissioning remain open.

## [0.1.0-alpha.1] - 2026-09-08

### Added
- Review of seven supplied manufacturer references with exact API/page and dictionary provenance.
- Verified call-status, permission-template and event-search capability responses.
- Sanitized supervised evidence for one active relay, populated user/card reads, card access,
  initial local PIN acceptance and failed PIN change despite successful API readback.
- Owner scope: relay 2 excluded throughout the project; answered-call tests deferred.
- Sanitized real-device fixtures and capability matrix for V3.9.0 build 260115.
- Extended read-only capability and PIN-mode reconnaissance using observed firmware routes.
- Separate evidence for decoded RTSP video, snapshot, idle calls and stream recovery.
- Async read-only ISAPI probe with Digest authentication and typed capability reports.
- Fixed endpoint allowlist, bounded pagination, alert stream and call timeline capture.
- XML/JSON parsing and normalized errors, including ResponseStatus errors inside HTTP 200.
- Sanitized report/fixture archives and synthetic protocol/security tests.
- HACS layout, Python CI, HACS, Hassfest and gated GitHub Release workflow.
- Real-device commissioning runbook and phase tracking.

### Fixed
- Recognize documented card/person capacity errors, person/PIN conflicts and device-busy status.
- Parse the real CallStatus.status and responseStatusStrg search response fields.
- Read length-delimited JSON alert-stream events and reject incomplete MIME parts.
- Obtain a fresh Digest challenge for each read after observed cached-auth rejection.
- Preserve firmware build, counts, capability bounds and PIN-mode metadata in sanitized exports.
- Reject malformed/empty capability wrappers as support evidence.
- Bound nested payload traversal before redaction.
- Retain device errors inside a successful event-stream HTTP response.
- Preserve the original Master Spec verbatim by excluding its code fences from formatting.

### Security
- No relay, configuration, user or card mutations in the probe.
- TLS verification by default; redirects, environment proxies and transport retries disabled.
- Size/deadline limits include Digest challenge buffering.
- Credentials, personal identifiers, raw images and unknown values excluded from exports.

### Release status
- Prepared development version: 0.1.0-alpha.1.
- Phase 0 protocol-tooling prerelease; HA setup/entities arrive in Phase 1.
- Witnessed active-relay/card/initial-PIN evidence is available;
  PIN change diagnosis, test-user cleanup and remaining acceptance gates are open.
