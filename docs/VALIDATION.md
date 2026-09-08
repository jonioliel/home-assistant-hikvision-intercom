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
