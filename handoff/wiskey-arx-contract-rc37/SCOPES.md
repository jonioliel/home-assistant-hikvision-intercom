# Operator scope and event invalidation — existing rc.37 behavior

`schemas/commands.static.json` lists the base alternative area grants, scoped surfaces, field prerequisites, read-command classification and request byte limit for **all 238 registered generic commands**. It is generated from `websocket.py:COMMANDS`, `panel_permissions.py` and `api_contract.py`. The table is a *base classifier*: deeper per-person, per-station, revision and workflow rules run inside command handlers and are not proven by a row marked allowed. `subscribe`, audio and TTS have separate handlers and are described below.

## `authorization/session` and `overview.access`

Result contains `allowed:boolean`, `is_admin:boolean`, `areas:{overview,users,events,stations,management}` with `none|view|manage`, `station_ids:null|string[]`, `fields:{phone,photo,credentials,profile,access}` with the same three levels, optional `profile_fields:{<profile-field-id>:level}`, `revision:integer`, `personal_renewal:boolean` and, if PanelSecurity exists, `security:{locked:boolean,idle_minutes:integer,reauth_sensitive:boolean,elevated:boolean}`. `station_ids:null` means all current/future stations; `[]` means none. `revision` is the **global panel permission record revision**, not person/media/workflow revision. An admin receives all five areas at `manage`, unrestricted stations, all fields at `manage`. A denied user gets all areas and fields at `none`, `station_ids:[]`. `overview.access` is built from the same policy plus revision and security state at response time, but it is a separate read and can be newer than a previous session response; never compare them as immutable snapshots.

Stored policy schema is 3. `station_groups` are admin-defined `{id,label,station_ids[]}` (up to 64 groups). A user's `station_group_ids` combine with explicit `station_ids` into the effective list; they do not automatically include new stations unless an admin edits the group. Removing a referenced group from the stored settings is rejected as invalid storage/update. A per-profile-field permission can reduce a named custom field beneath the parent `profile` category; absent field-specific entry defaults to manage **within the parent category**, not an independent grant. At most 12 overrides per user. Both station and field restrictions narrow the command surface, including some global libraries and bulk operations; examine the generated matrix.

## Enforcement order and concurrency

For generic WebSocket commands: validate active user and base `command_allowed` **before** revealing schema; then top-level Voluptuous schema, `api_contract` on non-READ commands, strict int/bool types, serialized byte bound, `AdminLimiter`, connection-bound PanelSecurity guard, `_dispatch` workflow gate and operator target/field guard, handler-specific validation/revision/action. Errors include `unauthorized`, `invalid_fields`, `api_incompatible`, `request_too_large`, `rate_limited`, `screen_locked`, `reauth_required`, `field_access_denied`, `person_scope_shared`, `revision_conflict` and command-specific codes. The exact ordering among *nested* validation, target and revision varies by handler; no global “area → scope → field → target → revision” guarantee exists.

`permissions_changed` can be raised **after** `_dispatch_inner` completes if the permission revision changes during a restricted operator's call. Thus the operation may already have committed. Do not auto-retry. Refetch the person/station/operation by stable ID and compare revision or receipt; for door unlock there is no authoritative physical confirmation, so show unknown outcome and require human verification.

## Projection placeholders

For a restricted operator, stations outside `station_ids` are omitted. People with no assignment in scope are omitted. A person shared with an out-of-scope station is visible in scope but `operator_editable=false`; pending bindings outside scope also block writes. `operator_editable` and `redacted_fields` are added to restricted person projections. `redacted_fields` lists disallowed **category** names, while individual `profile_fields` can still be omitted without appearing in that category list. UI must use both the category map and the profile-field map.

| Hidden category | Returned value |
| --- | --- |
| phone | `phone:""` |
| photo | `photo_configured:false`; photo fetch requires separate grant |
| credentials | `cards:[]`, `pin_configured:false` |
| profile | `profile:{}`; if parent visible, inaccessible individual fields are omitted |
| access | `assignments:{}`, `permission_overrides:{}`, `timing_readbacks:{}`, `group_ids:[]`, `valid_from:null`, `valid_until:null`, timing draft/policy `null`, responsible person/purpose `""`, category `"staff"`, user type `"normal"` |
| event portrait/card | `portrait:null`, `card:null` |

`overview` also empties global tombstone/revocation/card-removal/PIN-removal arrays and `sync_operations` for restricted users. If the user has no `users` area, `overview.users=[]` and `user_count=0`. If both users and events areas are none, `profile_settings=null`. Without `stations` area the following station technical fields are **omitted**: `host`, `model`, `firmware`, `capabilities`, `observations`, `clock`, `event_status`, `last_poll_ms`. Treat redacted placeholders as *unknown*, not as genuine absence of a credential, grant or expiry.

## `subscribe` and connection change

`hikvision_intercom/subscribe` requires only `{id,type}` and overview permission. Result is an empty success envelope; the same ID receives `event` envelopes with `kind:"refresh"|"access_revoked"|"screen_locked"` and **no data payload**. Change bursts coalesce for 0.25 seconds, and permission/security is checked again before sending. `access_revoked` and `screen_locked` cancel the subscription. `refresh` is a broad invalidation, not a typed diff. Source-confirmed direct triggers include the access repository change callback, event manager and clock runtime; other subsystems may call the repository callback. Reconnect requires new auth, session, overview and subscription; there is no durable event replay or gap cursor. `topics` and `station_ids` do not exist today; adding them requires a new tested release. Arx should debounce `refresh`, reload the current screen's minimal projection, and refetch authorization when permission state may have changed. A ringing card is read from `overview.stations[].call_state` after refresh; no bounded end-to-end ring latency is guaranteed by this protocol.

## Dual approval and security

Defaults in the stored workflow settings are `idle_minutes=0`, `reauth_sensitive=false`, `dual_approval=false`; inspect the owner's live settings rather than assume defaults. When dual approval is on, `requires_approval()` gates: `users/create`, `cards/add/remove/capture_confirm`, `workflows/inventory_issue`, `users/adopt/delete_unmanaged/temporary_cancel/archive/unarchive/delete/set_active/bulk_apply/csv_apply`, `conflicts/resolve/resolve_deletion`, `profiles/settings_update/settings_apply`, `backups/apply`, selected `users/update` access/credential changes, `workflows/inventory_save` when status becomes lost/blocked, and `workflows/inventory_return` unless deleting. Exact review flows differ; the gate raises `approval_required`, not an automatic queued action. Distinct approver identity is enforced by the workflow implementation. `visit_second_operator_required` is the separate visit flow. Do not collapse these codes or assume every command has the same reviewer rule.
