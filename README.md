# Hikvision Intercom Manager

Local-first Home Assistant integration for DS-KV6124-E1 stations, distributed through HACS.
Source of truth: [CODEX_MASTER_SPEC.md](CODEX_MASTER_SPEC.md).

**Phase 0: protocol reconnaissance.** The read-only probe and tests are implemented.
Remote read APIs, PIN mode and short camera decoding are verified on the target firmware.
Physical call/relay/credential acceptance is pending. HA setup, entities, access manager and panel
arrive in later phases.
No production release is available.

[Current Phase 0 test source](https://github.com/jonioliel/home-assistant-hikvision-intercom/tree/phase/0-protocol-probe) · [Download test source ZIP](https://github.com/jonioliel/home-assistant-hikvision-intercom/archive/refs/heads/phase/0-protocol-probe.zip)

HACS, Hassfest and Python CI passed on the uploaded tooling. The physical Phase 0 gate remains
open, so development stays on its phase branch until the remaining physical evidence is reviewed.

## Run Phase 0

Use Python 3.12 or newer on a computer that can reach one test station:

~~~powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe tools\probe_ds_kv6124.py --output probe-output\station-01
~~~

On the current development computer the environment is prepared; run only the last command from
C:\hik intercom. Host, username and password are prompted; the password is hidden.
Do not put passwords on the command line or send them to the project.
For HTTPS add --scheme https --http-port 443. TLS verification is enabled by default.
Only if certificate validation is unavailable, explicitly add --insecure.
RTSP port defaults to 554; --rtsp-port records a different port for later manual verification.

Capture the bell sequence:

~~~powershell
.\.venv\Scripts\python.exe tools\probe_ds_kv6124.py --call-seconds 90 --call-interval 1 --output probe-output\station-01-bell
~~~

Wait for "Bell capture started", leave idle for about 10 seconds, press the bell, answer normally,
and end the call. Note the approximate time of each action. Unknown raw states remain unchanged.

Return share_with_codex.zip from each output folder, plus the relative bell-action timing.
The archives contain capability_report.json and sanitized fixtures. Review them locally first.
Never return images, PINs, card numbers, passwords, raw exports or authentication headers.
See [the runbook](docs/PHASE_0.md) for bounds and the physical-test gate.

## HACS installation and updates

Target repository: https://github.com/jonioliel/home-assistant-hikvision-intercom

When the first usable core integration release is available:

1. In HACS Custom repositories, add the repository URL with category Integration.
2. Download Hikvision Intercom Manager and restart Home Assistant.
3. Add Hikvision Intercom in Settings → Devices & services.
4. Repeat for each station, explicitly selecting Relay 1, Relay 2, or both.
5. Install later releases through HACS updates.

Phase 0 has the HACS package layout; HA setup becomes available in Phase 1.
Manual copying is a development fallback only. All runtime files stay inside the integration.
The final product must provide cameras in ordinary HA dashboards and in the admin panel.
Unselected relays must have no entity, control, action target or access-permission option.

## Development

~~~powershell
.\.venv\Scripts\python.exe -m pytest --cov=custom_components.hikvision_intercom --cov=tools --cov-report=term-missing
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m mypy
~~~

If Windows blocks compiled mypy, install its pure Python build:
python -m pip install --force-reinstall --no-binary mypy mypy==1.20.2

Synthetic parser fixtures and sanitized real-firmware observations are kept separately.
See [the capability matrix](docs/CAPABILITY_MATRIX.md) for what was actually verified.
Use focused phase branches.
Merge to main only after phase checks pass. Device-dependent phases remain open pending evidence.
Manifest, metadata, Git tag and changelog must use the same Semantic Version.
GitHub Releases require successful Python CI, HACS and Hassfest on the release commit.
Pre-1.0 releases are marked as prereleases. See [progress](docs/PROGRESS.md).

Independent community project, not an official Hikvision product.

Remote checks on the target firmware are documented in [the capability matrix](docs/CAPABILITY_MATRIX.md).
They confirm read APIs and short camera decoding; physical relay/PIN/card/call acceptance remains open.
