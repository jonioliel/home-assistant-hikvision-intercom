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

## Actual station validation

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
Physical bell transitions, relay mapping, PIN/card acceptance and rights enforcement require
an on-site witness; they cannot be inferred from CI or capability advertisements.
