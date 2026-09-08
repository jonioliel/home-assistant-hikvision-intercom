# Hardening, upgrades and recovery

This integration is still a prerelease. The main components of phases 0–5 are implemented;
physical commissioning, firmware-dependent fixes and full fleet acceptance remain open.
The owner has confirmed HACS installation and updates. Phase 6 is optional future work.
Version 0.9.0-alpha.1 completes the save controls, lock naming and validity-list gaps from the audit.
Publication is gated by all required checks on the exact main commit.

## Backups and migrations

Back up Home Assistant before installing a new version. The integration uses private atomic
HA storage. User storage contains the full credentials needed to synchronize offline stations;
protect HA backups and administrative access. No additional key stored on the same host would
protect against full host compromise. PINs never enter normal read APIs or event state.

Config entries remain major version 1 and migrate to minor 2. Existing addresses, credentials,
relay confirmations and options are preserved. A missing capability baseline is populated by
read-only observation at setup; migration never enables a relay. Unknown future layouts or
invalid saved permissions are rejected with a Repair issue instead of being downgraded.

The access data schema migrates from 1 to 2 by adding private retired-PIN reservations. Existing
users, IDs, cards, ownership bindings, pending writes and tombstones are preserved. A migration
must save successfully before the new in-memory state is used. Downgrading to older access
code requires restoring its matching backup; it cannot interpret the newer private data schema.
The HA Store envelope remains version 1; the independently validated access payload is schema 2.

Corrupt/oversized/duplicate-key storage is rejected and preserved. Restore a compatible backup;
do not delete `.storage/hikvision_intercom.users` to reset it, because it owns synchronization
and pending removals. A storage failure prevents subsequent credential writes. Repair the disk
space/permissions or restore the correct backup, then reload the integration.

## Deferred credential removal

A replaced or removed PIN stays reserved to its original owner until every formerly assigned
station confirms it is absent or replaced by the intended value. An offline station can keep
that reservation pending across restarts, reassignment and central deletion. Card removal uses
the same principle. A configuration readback is evidence of saved state; physical keypad/card
acceptance must still be tested on the installed firmware.

## Diagnostics and Repairs

Download diagnostics from Settings > Devices & services > Hikvision Intercom. They include
model/validated firmware, advertised camera/call/access capabilities, counts, queue depth,
normalized error categories and the last 100 request durations (milliseconds, including queue).
They exclude connection details, people, PINs, complete cards, raw payloads and device URLs.
Timing counters reset when an entry reloads.

Repairs link to corrective steps for these conditions:

- Authentication: use the integration's reauthentication/reconfiguration flow.
- Changed station identity: verify the address; add the replacement as a separate station.
- Missing relay mapping: reconfigure and physically confirm the active output.
- Missing previously observed capability: check connectivity/firmware and reload.
- Persistent sync conflict (five minutes): review the central and station versions in Sync.
- Capacity: compare station limits with pending user/card assignments.
- Storage/migration: restore the correct backup or correct permissions/free space, then reload.

A transient offline station uses retry/backoff and does not create a Repair issue.
A Repair never automatically opens a door, changes a PIN, adopts a user or overwrites a conflict.

## Load and lifecycle limits

Each station has an independent coordinator and serialized writer. Fleet credential work allows
at most three station writers. Call polling, a separate event stream and readback have bounded
connections/timeouts. A momentary release is never automatically retried after a lost response.
Administrator WebSocket commands allow eight in-flight handlers per administrator and a burst
of 30 requests, replenished at two per second. Background synchronization remains coalesced.

The audit cache retains at most 5,000 masked records / 30 days from receipt. Queries, hourly
pruning and shutdown persist deletions as well as insertions. Event tasks, timers, subscriptions,
HTTP sessions and optimistic release timers stop on unload or HA shutdown.

## Acceptance still needed

- Retry the previously repaired temporary PIN while the owner is at the station; capture the
  result before further changes. Validate old-PIN rejection, removal and targeted test-user cleanup.
- Complete test-card add/remove and readback/physical acceptance without modifying the owner's card.
- Obtain a reproducible actual bell status sequence. Busy-tone/idle observations do not prove ringing.
- Finish installed camera/live video and administrator acceptance; HACS install/upgrade are owner-confirmed.
- Run the multi-station hardware soak and reconnect/reboot acceptance with the owner. Only one active
  physical relay per station is in scope; disabled relay 2 is excluded by the owner's instruction.
- Answered-call checks remain deferred because an answering screen is not installed. Busy state is
  not mapped to answered. Two-way audio and call controls belong to optional Phase 6.

The automated fleet test uses nine simulated stations, six PIN rotation/restart cycles, one
unavailable station each cycle, no-op verification and deletion recovery. A real one-minute
single-station concurrent check had no errors; neither test is a nine-device hardware soak.

HA references: [Repairs](https://developers.home-assistant.io/docs/core/platform/repairs/),
[config entries](https://developers.home-assistant.io/docs/config_entries_index/).

## Optional clock reads

StationClock reads identity/time on a separate I/O lane, coalesces concurrent refreshes and
bounds each refresh to 20 seconds. Its 15-minute timer and pending request are cancelled on
unload. A failed read retains explicitly stale verified rules or falls back to UTC; it cannot
change device time/NTP or suppress other-station releases. See [TIME_ZONES.md](TIME_ZONES.md).
