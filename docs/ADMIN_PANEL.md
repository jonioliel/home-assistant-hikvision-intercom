# Administrator panel

Phase 3 adds the **Intercom Manager** sidebar at `/hikvision-intercom`. The entire panel API,
including user/inventory reads, requires an administrator. Its language follows the HA user's
English/Hebrew setting; colors follow the HA theme. Hebrew layouts use RTL and isolated identifiers.

## Working with people

Create a person, choose their stations and save. Their canonical employee ID is generated in the
editor and stays stable if the response must be reviewed after a connection failure. Once deployed,
it cannot be casually changed. Saved users are reconciled in the background; offline targets retain
pending work. Disabling a user revokes their station record while keeping the central identity.

A saved PIN is never sent back to the browser. Set/change requires matching new values; clearing is
an explicit action. Existing cards show only a masked number. New manual card numbers preserve
leading zeros and exact case. Limits and unsupported PIN modes are checked against station capabilities.
Deleting a person asks for confirmation and explains how many stations must confirm removal.

## Existing records and conflicts

**Import existing** first reads a station inventory. Review the record and choose import, adoption
into a matching central employee ID, ignore, or targeted removal. Adoption into a central person
uses that person's existing desired credentials. No discovery operation silently takes ownership.
A review token is rechecked against current device data before any ownership change.

The **Sync** matrix opens revision/status details and a masked current device record. Choose central
or device state explicitly. Importing device state affects all assigned stations. Pending deletion
conflicts have a separate confirmation. Removing a station configuration before its access cleanup
finishes can strand pending targets; remove assignments and wait for confirmation first.

## Cameras and locks

Overview reads normal HA entity states for immediate ringing/offline changes. Visible camera
previews use HA camera proxy URLs. Enlarged live video requests HA's `camera/stream` HLS endpoint
and plays it with bundled HLS support; no external CDN or station credentials are used.
Only configured locks appear, and offline controls are disabled. HA's backend repeats the mapping,
identity and session checks; browser controls cannot enable a second relay.

## Validation and limits

The UI harness contains synthetic people, RFC documentation addresses and an illustrative camera
frame marked DEMO. It cannot operate equipment. Desktop/Hebrew mobile screenshots in `screenshots/`
are software previews, not evidence of physical commissioning.

Protocol/configuration readback does not establish physical credential acceptance. The earlier PIN
change failed at the keypad, and a later permission experiment still awaits a supervised retry.
HACS installation and updates are owner-confirmed; full live camera playback acceptance remains open.
Events/audit capture is implemented in Phase 4; see [event behavior and filters](EVENTS.md).

Development: install the locked frontend packages with `pnpm --dir frontend install --frozen-lockfile
--ignore-scripts`, then run `check`, `format:check`, `build` and `test` from `frontend/package.json`.
The bundle and its license notices ship with HACS; users do not need Node.js. CI rejects a bundle
that differs from a fresh build. Local Chromium tests use a fresh headless Chrome context and a
loopback-only server with an explicit three-file allowlist.

## Sync support reports

The Sync matrix shows a translated failure reason beneath each failed assignment, including
for offline stations. Its station/person references match the anonymous references in the
**Download sync diagnostics** report. Retry the affected sync before exporting to capture fresh
stages. The report is administrator-only and bounded to the last 200 in-memory stages; it
contains no names, employee numbers, addresses, PINs, cards or raw station responses.

## Fleet health and last access — 0.7.0-alpha.1

Overview uses the existing bounded event cache; it makes no extra device requests. Last access
means the newest retained authentication or unlocking record by actual event time. Bell and door
motion records are excluded. Recovered records remain labelled; unknown unlocking results are
not displayed as successful authentication. Receipt time is labelled when the device time was
unusable, and timestamps more than five seconds in the future do not occupy the summary.
The empty message means no eligible record in retained history, not that nobody used the door.

Last successful contact is the last successful call-status poll in this runtime. Its request
length includes the HTTP/Digest exchange and parsing, not just network ping. Both observations
survive failed polls but reset on a fresh integration load. The last successful reconciliation
advances only after the entire cycle, including the final inventory read, succeeds. A manual
inventory read alone does not advance it. These fields refresh through the existing panel refresh.

Managed-user count is the overlap of explicit ownership and the last observed station inventory;
unknown inventory is displayed as unknown. Pending count is unique users awaiting reconciliation
per station, including offline/error verification, revision mismatch, saved intents, tombstones,
revocations and previous PIN/card removals. The same person counts once per affected station.
A successful scan with zero pending work shows zero, not the size of the periodic scan workload.
The Sync removal list now includes previous PINs by person/target only, never by PIN value.
User search matches exactly four visible trailing card digits, alongside name and employee ID.

## Station inspection and fleet selection — 0.8.0-alpha.1

**Rescan access capabilities** reads the verified UserInfo/CardInfo capabilities, local/global
PIN mode and full inventory, with identity verification. It does not request reconciliation.
The same behavior applies to the administrator `rescan_station` action. Ordinary background
sync continues on its schedule; **Sync now** explicitly queues reconciliation. Inspection
updates its successful scan time and inventory without marking pending user revisions applied
or advancing the last successful reconciliation. A failed inspection keeps previous observations
and displays a safe error category. Simultaneous callers share one read; station unload cancels
it, and post-write inventory refresh always begins after the writes it reports.

Intercom cards distinguish observed capabilities from unverified capabilities. Core call,
snapshot and enabled-video observations come from the loaded runtime; access capabilities come
from the latest successful access scan. Event query evidence comes from the bounded query
client's accepted capability response. Live stream/history connection state is shown separately.
These are observations, not a claim that an unverified feature is unsupported or that an enabled
video channel has passed a full video playback test. Configured lock mapping comes from validated
entry settings, including while unloaded. Only explicitly configured locks receive release controls.

The user editor offers explicit selection of all stations with a configured lock, including
offline stations. Camera-only stations remain disabled. Clearing selection changes the draft;
saving persists revocation on removed stations for reconciliation. Cancelling leaves central records and device queues
unchanged. Existing per-station sync status and the selected count remain visible during editing.


## Save, lock names and validity — 0.9.0-alpha.1

The editor has **Save** and **Save & sync**. Both validate and persist central desired state
before returning. Save does not request an additional worker; automatic reconciliation, an
already-running worker or reconnect/restart may still apply the saved changes. It is not a
pause or unpublished draft. Save & sync additionally requests work immediately; offline targets
remain pending. Keyboard submission defaults to Save. Existing API clients that omit `sync_now`
retain immediate scheduling. Delete, Disable and explicit synchronization keep their behavior.

To name an existing active lock, open the integration's **Reconfigure** flow, retain the detected
station, choose **Keep confirmed mapping** and enter **Lock name**. Keeping the mapping sends no
release command. Empty the field to restore the default name. New setup offers the same field,
but still requires deliberate mapping and witnessed release confirmation. The name appears on
the HA entity and all panel release/assignment surfaces; it never changes the selected API output
or entity unique ID. A separate user override in the HA entity registry remains owned by HA.

The Users list displays the configured access period and its start/end dates in the browser's
local timezone. Time summaries and Active/Inactive status are independent of station sync status.
They describe central intent, not observed keypad/card acceptance or proof of firmware enforcement.
At the configured end instant the summary becomes Expired. Invalid/incomplete dates are labelled
unverified, never inferred as permanent. The existing 30-second visible-panel refresh advances
these summaries even if fetching a newer overview fails.


## Independent door controls — 0.9.1-alpha.1

Opening a door disables only that station's release controls while its request is pending.
Overview, Intercoms and the camera dialog share the same per-station state. Another online
configured door can be opened independently; the integration sends one command only to the
selected station/output. A known HA `unlocking` state also blocks only that station. Normal
backend duplicate protection, admission limits and offline/unselected-lock rejection remain.

Each targeted station displays its last release request time and outcome. These are in-memory
panel observations, not physical door/contact state. A missing acknowledgement is unconfirmed;
check the actual door before an explicit retry. The panel never automatically resends a release.
Other stations do not inherit the pending/success/error display. An overview refresh runs after
completion without holding the release button busy until the entire refresh finishes.

Closing/reopening the camera dialog retains same-station protection. Leaving/rejoining the panel
clears local outcomes and reconnects its subscription; late responses from the old lifecycle are
ignored. Removed stations' local outcomes are pruned. Normal event history remains separate.

## Detailed sync review — 0.10.0-alpha.1

Select a user's Sync cell to read a fresh ten-field comparison. Highlighted fields differ before
masking, so two cards with identical visible suffixes can still be different. The central column
shows effective desired state for this target: a disabled/unassigned/deleted user should be absent,
and centrally disabled cards are omitted. Device schedules, privileged rights and biometric
credentials are summarized without exposing raw device structures. Unsupported resolution buttons
are disabled with a reason; this does not imply that the device itself lacks the feature.

The change summary describes logical user/PIN/card changes needed to reach central state. The
reconciliation target list includes offline stations and retained cleanup targets. Import device
state changes shared central identity fields/credentials and retries all affected targets; active
state and assignments are preserved. Use central state also retries this user's targets. Neither
choice bypasses the normal ownership/capacity/freshness checks or proves that a credential opens a door.

The review records its own revision and time. If another session edits the person, the old central
snapshot remains visible but approval is disabled. **Read comparison again** obtains a fresh snapshot.
A stale-device or revision-conflict response also requires a fresh read. API-only clients must submit
the returned revision; it is checked before station reads and atomically again before saving.


## CSV batches and activity reports — 0.11.0-alpha.1

Users adds **Import CSV**, a blank template and **Export users CSV**. Preview the complete file,
choose create-only or explicit update mode, inspect removals, and confirm before atomic central
storage. Offline station work remains pending; a saved batch is not proof of physical acceptance.
Exports exclude credentials. [Full schema and examples](CSV_AND_REPORTS.md).

In Events, apply filters before generating a report or exporting CSV. The report spans all
matching retained pages and separates authentication from other records. It shows generation
time, station/method/day counts (UTC days), retention and recovery/storage status. These are
event counts rather than visits. Downloads contain retained names/IDs and masked card suffixes.

[Hebrew CSV preview](screenshots/csv-he-mobile.png) ·
[Hebrew activity report](screenshots/report-he-mobile.png) ·
[Deferred physical checks](DEFERRED_VALIDATION.md).
