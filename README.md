# Hikvision Intercom Manager

Home Assistant integration for Hikvision DS-KV6124-E1 stations, distributed through HACS.
The [Master Spec](CODEX_MASTER_SPEC.md) defines the full project. Observed firmware:
V3.9.0 build 260115. Other Hikvision models are not enabled by this release.

**Current releases include the core, access management, admin panel, events and recovery work from phases 0–5.**
It includes user/card/PIN administration, cameras, one active lock per station, events,
audit history, recovery and Repairs. HACS installation is owner-confirmed; physical commissioning remains open.
Recent updates fix permanent-user synchronization, add private-safe sync reports, show fleet/access health,
and provide read-only station inspection, deliberate bulk assignments and detailed conflict comparison.
Install tagged versions from [GitHub Releases](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases);
publication requires passing CI. The earlier `0.1.0-alpha.1` contains protocol tools only.
See [progress](docs/PROGRESS.md), [validation](docs/VALIDATION.md) and
[upgrades, diagnostics and recovery](docs/HARDENING.md).
[דוח מסירה בעברית](docs/DELIVERY_HE.md) · [ספירת משימות ואחוזי השלמה](docs/COMPLETION_HE.md).

## Administrator workflows (0.25)

Users, Events, Sync and Change history now share the updated interface. Sync can be filtered
locally by person, station and pending/problem state, with person cards on mobile. Event filters
show when edits have not been applied, and history keeps before/after details available on demand.
See the [delivery and screenshots](docs/ADMIN_UI_025_HE.md). Physical acceptance gates remain open.

## Daily interface and event identity (0.24)

The daily sidebar groups Overview, Users and Events; management tools remain accessible.
Station cards prioritize the camera and independent door action. The user editor has grouped
fields and a fixed save/cancel footer, with responsive Hebrew/English and light/dark layouts.
Event identity now preserves string identifiers and scopes name lookup to observed station
ownership. The original unidentified event still needs exact correlation.
See the [delivery and visual previews](docs/CORE_UI_024_HE.md).

## Bulk access and administrator history (0.23)

Select up to 200 users, review their changes, then explicitly apply activation, assignment,
removal or synchronization actions. Durable receipts resolve uncertain replies without applying
an old change twice. Station completion remains visible in Sync. User filters and stable sorting
support station, assignment, validity and credential presence.

The **Change history** tab and per-user history show actor, action and masked before/after values,
with filters and CSV/JSON export. Read-only permission comparison highlights station differences
and opens the existing review workflow. See the [twenty-task delivery guide](docs/BULK_ACCESS_AUDIT_HE.md).
Back up HA before upgrading: the private access payload migrates to schema 3; returning to 0.22
or earlier requires restoring a matching backup.

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
Unknown call states remain unknown. Capability-gated call commands are available, while
two-way microphone audio remains unimplemented and physical call acceptance remains open.

## Schedule planning

The administrator **Access schedules** tab saves named weekly/holiday drafts locally, previews
window membership and checks the selected draft against advertised station limits. Version 0.15
adds a verified read-only Search inventory, with explicit partial results and unknown constraints.
Drafts are not assigned to users or enforced at doors; disabled records do not mean free slots.
Version 0.16 adds explicit, persistent [comparison references](docs/SCHEDULE_BASELINES.md) to detect
record-content and capability changes while preserving partial-search uncertainty.
Version 0.17 adds [dependency audits, multi-station assessment, portable draft transfer and
clone/copy editing](docs/SCHEDULE_WORKFLOWS.md). These remain local drafts and read-only checks.
Version 0.18 adds [candidate compilation, configuration comparison and saved local deployment
proposals](docs/SCHEDULE_DEPLOYMENT_PLANS.md), with explicit rechecks and per-station reservations.
Device schedule application and user assignment remain unavailable.
Version 0.19 adds the [write journal, recovery executor and offline fault simulator](docs/SCHEDULE_RECOVERY.md)
for future deployment. No production schedule writer or new Apply control is enabled.

See [draft editing](docs/ACCESS_SCHEDULES.md) and [compatibility assessment](docs/SCHEDULE_INVENTORY.md).

## Central access backend

- Private HA storage for users, PINs, multiple cards, station assignments and validity periods.
- Explicit adoption of existing users; matching employee numbers alone never authorize overwrite.
- Durable revision-aware sync, per-station offline recovery, conflict review and deletion tombstones.
- Removed cards and replaced PINs remain reserved until every affected station confirms removal.
- Administrator actions: `sync_user`, `sync_station`, `sync_all` and `rescan_station`.
- State-changing requests are journaled before sending and verified by readback. Unchanged periodic
  reconciliation does not rewrite the database or credentials.

Use the administrator panel to create or edit users, import existing station records and resolve conflicts.
Do not edit `.storage` manually.
The backend scans existing users on startup without importing them automatically.
See [backend behavior and limits](docs/ACCESS_BACKEND.md).

## Administrator panel

**Overview** shows camera previews, call status, last access, offline contact time, pending users
and only configured lock controls. Open a camera for HA-proxied live video. **Users** provides write-only PIN editing, masked cards, station
assignments (including explicit select-all/clear controls) and validity periods. Existing users also
support [reader-based card enrollment](docs/CARD_ENROLLMENT.md), gated by fresh station capabilities,
with a masked preview and explicit approval before saving. **Intercoms** displays
observed capabilities, configured lock mapping, inventory and live-event/history connection health.
Its access rescan reads capabilities and inventory; **Sync now** requests pending reconciliation.
**Sync** shows per-user/per-station revisions, conflicts and pending removals. Its read-only review
compares ten fields, previews logical changes and fleet impact, and protects against stale approvals. **Events** provides
bounded audit history with filters and distinguishes recovered records from live events.
**Users** also supports reviewed CSV batches (up to 500 rows), a blank template and secret-free
exports. **Events** generates activity reports and CSV across all matching retained records.
See [CSV rules and reporting limits](docs/CSV_AND_REPORTS.md) and the
[deferred commissioning ledger](docs/DEFERRED_VALIDATION.md).

A device-record review is required before adoption, overwrite or resuming a conflicted deletion.
An offline target remains pending; the panel does not wait for all stations before closing a saved
editor. Standard HA camera/lock entities remain available alongside the dedicated panel.

[Administrator guide](docs/ADMIN_PANEL.md) · [Synthetic UI preview](docs/screenshots/overview-en.png).

## HACS installation and updates

Requires Home Assistant 2026.9.1 or newer and an existing HACS installation.
Select the latest tagged prerelease from the release link above for the current administrator panel
and access/event features:

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

## Troubleshooting synchronization

Open **Sync** to see the translated reason below each failed assignment. After retrying with
**Sync all**, use **Download sync diagnostics** and share that JSON report for support.
Station/user references shown in the matrix match the pseudonyms in the report. The report
excludes names, addresses, employee IDs, PINs, card numbers and raw ISAPI payloads.
Home Assistant entry diagnostics include the same station-specific trace. Debug logging for
`custom_components.hikvision_intercom.access.diagnostics` adds individual stages; failed stages
also produce a warning, with repeated identical failures throttled for five minutes.

A permanent user uses `Valid.enable=false`; the auxiliary dates do not impose an expiry.
Time-limited users whose station readback contradicts the requested timezone remain in error
until the firmware's time interpretation is verified. This is distinct from a PIN/card's
physical acceptance.

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

Native `event` entities and the administrator Events view are included in `0.6.1-alpha.1`.
See [event behavior and recovery](docs/EVENTS.md).

Device time zones and DST are followed by default from `0.14.0-alpha.1`; manual display zones
are available in each station’s HA Options. See [time-zone setup and behavior](docs/TIME_ZONES.md).

Schedule proposals now have an administrator operations workspace for responsibility review,
background checks, restart recovery and archive. See [the operations guide](docs/SCHEDULE_OPERATIONS.md).
Schedule writes remain unavailable until their device contract is verified.


Version 0.21 adds [health diagnostics, WebRTC with HLS fallback, field-test records and call signaling](docs/HEALTH_AND_MEDIA.md).
See the [20-task development report](docs/CORE_MEDIA_BATCH_HE.md) for completed software and remaining physical checks.
Two-way microphone audio is not implemented; call signalling acknowledgement does not prove an answered call.


Version 0.22 adds [call workflows, verified local-time history recovery and event/playback diagnostics](docs/CALLS_AND_HISTORY_BATCH_HE.md).
Use **Health & field tests** for an explicit 90-second capture or a read-only history inspection;
use **Playback report** in the camera dialog to investigate WebRTC/HLS selection.
[Time interpretation and device-clock evidence](docs/TIME_ZONES.md) explains the history fix.
