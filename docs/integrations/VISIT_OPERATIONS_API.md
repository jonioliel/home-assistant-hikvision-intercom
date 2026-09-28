# Visit templates and temporary cancellation

These commands extend API contract 1. Use the installed `overview.api.commands` as the authority and check the connected operator's `users` area grant. They use the existing `hikvision_intercom` WebSocket prefix. The VMS adapter must keep its infrastructure access token on the server.

## Templates

`guest_templates/get` requires `users:view` and returns `{revision, items}`. Each item has `id`, `label`, `access_category` (`visitor` or `contractor`), `responsible_person`, `access_purpose`, `duration_minutes`, `doors`, `weekly_timing`, `updated_at`, and `updated_by`. `doors` maps opaque station IDs to explicitly configured physical lock indexes (1 or 2). `weekly_timing` is null or the existing weekly schedule object: `{mode:"weekly", timezone, days, dates:[], periods:[{start,end}]}`.

`guest_templates/upsert` requires `users:manage`, `api_contract:1`, `revision`, `template_id` (empty for creation), and `values`. Values must contain exactly the seven editable fields listed above; no ID, PIN, card, photo, user name, or phone is accepted. Duration is an integer from 15 through 43200 minutes. A maximum of 100 templates is retained. Every door must still be configured when saved; station connectivity is not required to store a preset.

`guest_templates/delete` requires `users:manage`, `revision`, `template_id`, and explicit operator confirmation in the client. It removes only the preset. Existing users and permissions remain untouched. Both writes return the updated library. Concurrent edits fail with `revision_conflict`; refresh rather than replaying the old write.

Applying a preset is a client action, not a grant. Copy its visit access inputs into a new guest form while preserving identity and credential fields. Compute the finite end from the selected start plus duration in UTC; render both in the selected display timezone. Validate every station and physical lock again before application, and refuse a stale preset rather than silently dropping a door. A weekly schedule requires `user_timing_enforcement` and explicit infrastructure enforcement in the user's existing timing policy. The finite visit dates still bound that schedule. Show the complete review before calling the existing `users/create` route.

The private preset store is `.storage/hikvision_intercom.guest_templates`, schema 1. Include it in normal configuration backups. It contains access configuration and operator identifiers, but no credential secret. Corrupt storage is preserved and makes these commands unavailable until repaired.

## Cancel a visitor or contractor

`users/temporary_cancel` requires `users:manage`, `api_contract:1`, `user_id`, the current user `revision`, and `reason_code`. Allowed reasons are `visit_cancelled`, `visit_completed`, and `access_no_longer_needed`. The backend validates the category and active state, atomically changes only `active` to false, records the authenticated actor and reason, and queues the existing per-station synchronization. The response is the ordinary safe user projection.

Cancellation preserves the PIN, cards, doors, timing rules, identity and purpose for later review; it does not delete a person. A disconnected station may still accept a previously written credential until its new desired revision is actually synchronized. A successful WebSocket response proves saved intent, not physical revocation. Display station names and use only synchronization results for the cancellation revision; earlier `synced` results must never be presented as cancellation completion. `users/lifecycle.temporary_access.users[].assignment_states` now includes `sync_state`, `last_error`, `desired_revision`, and `applied_revision` for this purpose. Refresh is read-only and must not submit cancellation again.

The administrative audit record adds optional `reason_code` for this action; it is also appended to the CSV export. No arbitrary reason text or credential enters that record. Old audit rows remain valid. A rollback to software that cannot read these new records requires restoration of the matching pre-upgrade backup; copying old code over a newer private store is not a supported rollback.

## Client failure handling

Use bounded waits and discard results after logout, permission revocation, detach or connection change. A lost connection does not prove that a write failed. Show an unconfirmed result and refresh before any next action; never automatically retry. An unavailable template library must not be treated as an empty library that is safe to overwrite.
