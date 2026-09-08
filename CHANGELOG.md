# Changelog

Semantic Versioning is used throughout the project.

## [Unreleased]

## [0.4.0-alpha.1] - 2026-09-08

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
- Publication to the default branch/release is awaiting explicit owner approval after an automated approval rejection.
- Physical acceptance and installation/upgrade on the owner's HA host remain pending.

### In development — Phase 2
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
