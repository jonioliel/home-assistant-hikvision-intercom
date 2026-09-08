# Central access backend

The Phase 2 backend is used by the Phase 3 administrator panel. Home Assistant is the desired-state
owner only for records an administrator creates or explicitly adopts. Initial discovery is read-only.

## Ownership and conflict handling

Employee numbers become immutable after the first write intent or adoption. Device records are
compared with a private keyed fingerprint of supported fields and credential bindings. Manual edits,
unknown write outcomes and another person's card cause conflicts rather than silent overwrite.
Review returns a masked snapshot and token. Adoption/resolution re-reads the record and rejects a
stale review. Importing a device change updates central desired state and all its assignments;
choosing central keeps desired state. Device deletion conflicts require separate explicit review.

Only normal users/cards and the selected physical lock are managed. Schedule templates, privileged
local UI access and biometric credentials cannot be adopted. Local-clock limited validity requires
an explicit timezone conversion before import; it is never guessed from the HA host timezone.
Unknown PIN modes disable PIN writes. Capability ranges override manufacturer example defaults.

## Durable reconciliation

Private versioned data lives in `.storage/hikvision_intercom.users` in HA's Store envelope, with
private file permissions and HA's atomic/fsync file helper. Secrets are recoverable for deployment;
this is not encryption. Restrict access to HA configuration and backups.
The adapter propagates write errors instead of relying on Store's log-only failure path.
Corrupt input fails closed without replacing the original file. Shutdown waits for an in-progress
journal save before releasing its repository lock.

Each mutation saves intent, sends one bounded operation and reads back its actual configuration.
An interrupted operation is resolved from its saved before/after fingerprints before any retry.
A newer desired revision or deletion prevents stale follow-up writes. Per-station transactions
serialize writes, with up to three stations writing concurrently. Bulk inventory reads do not
hold the relay write lock. A station recovery requests immediate access reconciliation.
Unchanged periodic reconciliation produces no credential writes or database rewrites.

Removal persists a tombstone until every targeted station confirms absence of both person and
cards. Removed card numbers remain reserved until their removal is confirmed on all former
stations. Removing an assignment and disabling a person also revoke their managed station record;
re-enabling uses the same canonical identity. Never remove a station configuration before access
revocations finish: its stored target ID is needed to resume pending cleanup.

## Actions and administrator interface

`hikvision_intercom.sync_user` takes a central `user_id`; `sync_station` and `rescan_station` take
`station_id` (a HA config-entry ID). `sync_all` takes no arguments. All four are administrator-only,
queue work and return without waiting for offline devices. Rescan may reconcile explicitly managed
records; it never adopts unmanaged records. The CRUD, inventory and review methods are exposed by the administrator-only Phase 3 WebSocket API.

## What readback establishes

A synced status means desired API configuration was observed. It does not prove a physical card or
PIN opened the lock. Initial local PIN acceptance was witnessed; PIN modification remains physically
unconfirmed after an earlier failed test. Temporary test-user cleanup is still pending. No new live
credential mutations were performed during this backend implementation.
