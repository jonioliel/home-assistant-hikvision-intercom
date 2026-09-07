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

The owner explicitly approved public publication. All source, tests, documentation, Git history
and the complete Master Spec have been pushed to the dedicated Phase 0 branch.

GitHub validation on ba2f7e48e0c5612d1f27906d243c9ef9a4382fc9:
- [HACS: passed](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34155356525)
- [Hassfest: passed](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34155356524)
- [Python 3.12 and 3.14, pytest/Ruff/mypy: passed](https://github.com/jonioliel/home-assistant-hikvision-intercom/actions/runs/34155356680)

The tested source is available from:
https://github.com/jonioliel/home-assistant-hikvision-intercom/tree/phase/0-protocol-probe

No GitHub Release or tag exists. main remains the baseline while the physical Phase 0 gate is open.
The next input required is the actual station report and physical observations in PHASE_0.md.
Device tests and HACS install/upgrade acceptance cannot be inferred from the CI results.
