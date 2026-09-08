# Phase 0 validation — 2026-09-08

Branch: `phase/0-protocol-probe`. Remote reconnaissance is recorded; hardware Phase 0 remains open.

## Local validation

- Python 3.12.14 on Windows.
- pytest with coverage: **118 passed**, **90%** total measured coverage.
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

Development metadata remains `0.1.0-alpha.1` with an Unreleased changelog. No tag or GitHub
Release exists yet. `main` remains the baseline while the physical Phase 0 gate is open.
HA setup/entities and HACS install/upgrade acceptance are still pending Phase 1 onward.
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
