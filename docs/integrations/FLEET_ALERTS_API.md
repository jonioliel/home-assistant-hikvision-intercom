# Fleet triage alerts

These additive panel commands read cached observations. They do not poll devices, unlock doors, alter access, pause synchronization, or send messages. The technical domain remains `hikvision_intercom`.

## Read

`hikvision_intercom/fleet/alerts` requires station view permission:

```json
{"type":"hikvision_intercom/fleet/alerts","offset":0,"limit":100,"station_id":"","kind":"","include_suppressed":false}
```

The result contains `revision`, `generated_at`, `items`, `total`, `offset`, `next_offset`, `active_count`, `suppressed_count`, `suppressions`, `thresholds_seconds`, and `evidence_scope`. Active/suppressed counts cover the whole configured fleet; `total` covers the filtered selection. Each item has a stable station/kind identity, station name, severity, observation evidence and any active suppression. Use the returned revision for the next edit. Refresh after concurrent edits; never retry a mutation automatically.

Kinds: `offline`, `sync_stalled`, `sync_conflict`, `sync_error`, `event_gap`, `clock_drift`. Offline and event-gap thresholds are ten minutes; pending synchronization is fifteen minutes. Offline stations show the offline alert rather than duplicate sync/stream alerts. Without historical evidence an offline observation has unknown duration. Clock alerts require the existing repeated-drift evidence and a measurement from the last hour. Observation timestamps describe what the system observed, not a proven physical failure onset. Alerts disappear when their evidence resolves.

## Presentation policy

`hikvision_intercom/fleet/alerts_action` requires station management permission:

```json
{"type":"hikvision_intercom/fleet/alerts_action","revision":0,"station_id":"station-id","kind":"sync_conflict","action":"suppress","duration_minutes":60,"reason":"investigating"}
```

`kind` can also be `maintenance`, which suppresses presentation for every alert on that station. Allowed durations are 15, 60, 240, 1440 and 10080 minutes. Reasons are `planned_maintenance`, `network_work`, and `investigating`. To resume immediately send `action: "restore"` with the same station/kind identity and current revision. The policy can be restored even if the underlying alert has resolved. Expiry resumes presentation automatically; reads need not rewrite the store.

Policies survive restart in the private `.storage/hikvision_intercom.fleet_alerts` schema-1 store. They record the authenticated operator, reason and expiry. Writes are serialized and become visible only after durable save. A failed save leaves the previous state intact. An invalid store is preserved and the API reports `fleet_alerts_unavailable` rather than silently replacing it. Device operations continue normally throughout maintenance or snooze.

The panel requires explicit review and confirmation, exposes remaining policies, supports station/kind filters and paging, and discards late responses after a connection, account or permission change. It refreshes cached observations every thirty seconds only while visible and idle. This is not a notification-delivery system and does not claim acknowledgement of a physical fault.
