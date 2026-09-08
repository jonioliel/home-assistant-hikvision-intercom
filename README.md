# Hikvision Intercom Manager

Home Assistant integration for Hikvision DS-KV6124-E1 stations, distributed through HACS.
The [Master Spec](CODEX_MASTER_SPEC.md) defines the full project. Observed firmware:
V3.9.0 build 260115. Other Hikvision models are not enabled by this release.

**Version `0.3.0-alpha.1` provides the core integration and central access backend.**
Install tagged versions from [GitHub Releases](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases);
publication requires passing CI. The earlier `0.1.0-alpha.1` contains protocol tools only.
The central Users/Cards/PIN administration panel follows in Phases 2–3.
See [progress](docs/PROGRESS.md) and [validation](docs/VALIDATION.md).

## Core features

- UI setup in English or Hebrew, reauthentication and reconfiguration.
- A device per station with online, ringing and call-status entities.
- A standard HA camera with snapshots and HA-proxied RTSP video.
- One active physical lock per station, or camera-only mode. The installation owner has
  excluded the disabled second relay throughout this project.
- A supervised mapping wizard: explicitly send a test release, then confirm that the intended
  lock released and returned. No lock is enabled by capability discovery alone.
- Momentary release through the lock entity and the administrator-only
  `hikvision_intercom.unlock_door` action. Unselected locks are rejected before network I/O.
- Shared polling with active/idle intervals, offline backoff and connection cleanup.
- Diagnostics that exclude host addresses, credentials, serials and raw device responses.

The displayed lock return is **optimistic**, based on a configurable display timer.
The intercom controls the actual relay duration; no physical door contact is inferred.
`onCall` means the device reports busy/in-call, and does not prove that somebody answered.
Unknown call states remain unknown. Two-way audio and answer/reject actions are outside
this core release.

## Central access backend

- Private HA storage for users, PINs, multiple cards, station assignments and validity periods.
- Explicit adoption of existing users; matching employee numbers alone never authorize overwrite.
- Durable revision-aware sync, per-station offline recovery, conflict review and deletion tombstones.
- Card numbers remain reserved until every affected station confirms removal.
- Administrator actions: `sync_user`, `sync_station`, `sync_all` and `rescan_station`.
- State-changing requests are journaled before sending and verified by readback. Unchanged periodic
  reconciliation does not rewrite the database or credentials.

The UI/API for normal user administration follows in Phase 3. Do not edit `.storage` manually.
The backend scans existing users on startup without importing them automatically.
See [backend behavior and limits](docs/ACCESS_BACKEND.md).

## HACS installation and updates

Requires Home Assistant 2026.9.1 or newer and an existing HACS installation.
Use a published core release (`0.2.0-alpha.1` or newer):

1. In HACS, add `https://github.com/jonioliel/home-assistant-hikvision-intercom` as a
   **Custom repository**, category **Integration**.
2. Open **Hikvision Intercom Manager**, select the intended prerelease in the download
   dialog (enable beta versions if needed), download it and restart Home Assistant.
3. In **Settings → Devices & services → Add integration**, choose **Hikvision Intercom**.
4. Enter the station address, account and ports, then confirm the detected device.
5. Choose camera-only mode or stand beside the active lock and complete the mapping test.
6. Repeat for each station. Receive subsequent releases through HACS and restart after updates.

[HACS custom repository instructions](https://hacs.xyz/docs/faq/custom_repositories/).
This is a custom repository, not a listing in the HACS default catalogue.
The local development computer reaching a station over VPN does not establish that the
Home Assistant host can reach it; HA must have its own network route.

Credentials stay in HA configuration and backend transport; the browser receives HA camera
proxy/stream endpoints. Keep HA configuration and backups access-controlled.
Reconfigure permits retaining a previously confirmed mapping and leaving the password empty
to preserve it. Options adjust poll intervals and the displayed release duration.

## Evidence and remaining commissioning

The active relay, existing card and initial six-digit local PIN were physically accepted.
PIN modification returned success and exact readback, but the first supervised attempts failed;
later events included the documented password-attempt limit. The follow-up permission test,
PIN cleanup, card CRUD, successful call/answer sequence and nine-station soak remain open.
No unverified behavior is counted as passing.

[Manufacturer reference review](docs/MANUFACTURER_PROTOCOL.md) ·
[Capability matrix](docs/CAPABILITY_MATRIX.md) · [Physical runbook](docs/PHASE_0.md).
Manufacturer PDFs and spreadsheets are private working references and are not redistributed.

## Protocol probe and development

The standalone probe runs with Python 3.12+ on a computer that can reach a station:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -e ".[dev]"
.\.venv\Scripts\python.exe tools\probe_ds_kv6124.py --output probe-output\station-01
```

Connection details are prompted. Passwords must not be placed on the command line.
For HTTPS use `--scheme https --http-port 443`; certificate checking is on by default.
The probe is read-only and exports sanitized protocol metadata rather than camera images or
credential records. See the runbook before supervised captures.

```powershell
.\.venv\Scripts\python.exe -m pytest
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m ruff format --check .
.\.venv\Scripts\python.exe -m mypy
```

Protocol typing and tests run locally on Python 3.12 and in CI on 3.12/3.14.
The dedicated Linux/Python 3.14 job installs `requirements-ha-test.txt` and runs real HA 2026.9.1
flow, entity, service and lifecycle tests. Only station I/O is mocked; HA is not replaced by stubs.
Do not install the project as an editable namespace package in that HA test environment,
because HA enumerates real `custom_components` filesystem paths.

Use ordered phase branches and merge only after the phase checks pass. Every release requires
Python tests, real HA tests, HACS and Hassfest on the exact release commit. Manifest, project
version, Git tag and CHANGELOG use matching semantic versions. Pre-1.0 releases are prereleases.

Independent community project, not an official Hikvision product.
