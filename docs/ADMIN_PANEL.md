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
Live camera playback and HACS install/upgrade acceptance on the owner's actual HA remain open.
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
