# Phase 0 tooling validation — 2026-09-07

Branch: phase/0-protocol-probe. Hardware Phase 0 remains open.

## Local validation

- Python 3.12.14 on Windows.
- pytest with coverage: **86 passed** in 7.62 seconds; total measured coverage **89%**.
- Protocol parser: 99%; probe: 93%; redaction: 95%; transport: 100%.
- Ruff lint and formatting: passed.
- Strict mypy: passed for 13 source files.
- CLI --help: passed using the prepared virtual environment.
- git diff --check: passed.
- Master Spec matches the owner-supplied file byte-for-byte. It is excluded from
  formatting so fenced Python examples cannot be changed by the formatter.

Tests include HTTPX Digest challenge/response verification; XML namespaces and unsafe XML;
HTTP-200 ResponseStatus failures; timeout/cancellation cleanup; body limits including Digest;
bounded read-only search pagination; redaction; evidence inference; archive round-trip;
release gates; and the complete async CLI engine against a local HTTP simulator.
All protocol fixtures are synthetic. No physical intercom was contacted.

## Distribution status

Public repository created:
https://github.com/jonioliel/home-assistant-hikvision-intercom

The source push was rejected by automatic approval review because explicit approval for publishing
the project and full Master Spec to this public destination was required.
No source was pushed. HACS, Hassfest and Linux CI are prepared but have not run remotely.
No GitHub Release or tag exists. main remains at the specification baseline; Phase 0 is unmerged.

Pending: owner approval for the exact public push, actual station reports and the physical gate
in PHASE_0.md. Device tests and HACS install/upgrade acceptance cannot be inferred from synthetic tests.
