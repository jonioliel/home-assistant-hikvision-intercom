# Changelog

Semantic Versioning is used throughout the project.

## [Unreleased]

### Added
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
- No release published. Remote Phase 0 evidence collected; physical call, relay, PIN and card gates remain open.
