# Changelog

Semantic Versioning is used throughout the project.

## [Unreleased]

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
