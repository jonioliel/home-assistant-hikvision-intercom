# Access investigation timeline

`hikvision_intercom/investigations/query` is an additive, administrator-only, read-only command. The server authenticates the actual infrastructure account; delegated area management grants do not grant this endpoint. This prevents a combined report from bypassing the independent visibility of people, access events and administrative records. Existing event, audit and operation commands remain available under their existing policies.

```json
{"type":"hikvision_intercom/investigations/query","filters":{"source":"all","user_id":"","station_id":"","query":""},"offset":0,"limit":50,"snapshot":""}
```

Optional filters: `source` (`all`, `access`, `change`, `sync`), `user_id`, `station_id`, `query`, `start`, `end`. Dates must contain an explicit timezone; the server normalizes them to UTC and requires start before end. String filters are limited to 128 characters, page size to 1–200 and offset to 0–1000000. Unexpected fields and malformed values are rejected. Searching examines only safe projected identity/action/status fields, never credentials.

The result has `records`, `total`, `offset`, `limit`, `next_offset`, `previous_offset`, `snapshot`, `stale`, `summary`, `generated_at`, `retention`, `correlation`, `actors` and `sources`. Send the previous snapshot on page changes. A changed result is marked `stale`; the client replaces the page and asks the operator to restart rather than combining incompatible pages. The snapshot hashes projected evidence, including content changes, not just row counts.

Each record contains an ID prefixed by its source, UTC `time`, `received_at` for access events, `time_source`, nullable managed `user_id`, `person_name`, `employee_no`, `station_ids`, `action`, `status`, nullable `actor`, `evidence` and allowlisted `details`:

| Source | Evidence | Meaning |
| --- | --- | --- |
| `access` | `device_event` | The station reported an event. Its claimed event time and reception time are separate. |
| `change` | `desired_state_saved` | A desired permission change was saved. This alone does not prove delivery or access. |
| `sync` / verified | `device_readback` | Desired station state was confirmed by readback. This does not prove a person entered. |
| Other `sync` | `sync_journal` | Latest retained operation status. Settled is distinct from verified. |

An access event is linked to a managed person only when exactly one current observed station owner matches the employee identifier and the ownership observation predates the event's device timestamp. Events using reception-time fallback, pending ownership, ambiguous identifiers, former identifiers and deleted owners remain unlinked. Device-reported names can still appear, but the UI explicitly distinguishes them from proven central identity. No fuzzy name matching or time-proximity causal inference occurs.

Events are retained according to reception time for 30 days, and changes according to system time for 30 days. The synchronization journal retains the latest operation per user/station rather than a complete sequence of all intermediate transitions; its existing capacity policy remains unchanged. `sources.access_available` and `sources.access_storage_failed` expose incomplete evidence rather than treating it as an empty authoritative history. Missing evidence cannot establish that no action occurred.

The projection omits PINs, complete or masked card values, photographs, fingerprints, private intent signatures, phone numbers and raw device payloads. Current page download exports only the same projected data and applied filters. No new database or device writes occur. Detached records are processed outside the event loop.

## Personal saved filters

The panel saves up to twenty filter sets per authenticated operator in local browser storage (`wiskey:investigation-views:v1:<account-id>`). This is scoped to the browser origin and account. It saves filter criteria only, not result records or credentials. Relative periods are recomputed when applied. Existing saved data is preserved on corruption, storage errors or concurrent edits from another tab; the operator must reload before attempting another write. Account/connection changes and view detachment cancel browser waits and discard late responses. These local filters are not part of the server database backup.
