# Operator station and person-field authorization

Implemented for release 2.0.0-rc.16. Namespace `hikvision_intercom` and API contract version 1 remain unchanged. This extends the existing panel protocol, not an independent REST API.

## Identity and boundary

Use the authenticated active infrastructure user's identity. Active administrators retain full access regardless of delegated grants; inactive users are denied. Non-admin VMS accounts need an enabled grant. A Supervisor/system token must not be treated as the browser operator's identity: the VMS must enforce its own operator boundary or use the appropriate dedicated non-admin account.

WisKey restrictions cover WisKey WebSocket commands and MSE/RTC/audio/TTS routes. Native infrastructure camera/stream/entity APIs, lock services and other applications have separate authorization. These grants do not alter global infrastructure permissions or isolate native camera entities. A hidden WisKey station is not necessarily inaccessible through every infrastructure API.

## Grant shape

An administrator obtains `authorization/settings_get`: `revision`, eligible `directory`, known `stations`, `areas`, `levels`, `fields` and current `users`. Preserve opaque IDs.

```json
{
  "enabled": true,
  "areas": {
    "overview": "manage", "users": "manage", "events": "view",
    "stations": "view", "management": "none"
  },
  "station_ids": ["opaque-station-id"],
  "fields": {
    "phone": "view", "photo": "view", "credentials": "none",
    "profile": "manage", "access": "manage"
  }
}
```

`station_ids: null` means all current and future stations. An explicit list allows only those entry IDs, including later reconnects. An empty list means no stations or people/door actions. Removed IDs remain selectable for removal and never expand to all stations. Lists allow at most 1,000 unique nonempty IDs; invalid policies fail closed.

Field categories: `phone`, `photo`, `credentials` (PIN/cards), `profile` (all custom person fields), and `access` (rights/groups/validity/timing/category/host/purpose). Levels are `none`, `view`, `manage`. Field grants intersect screen grants; they never grant a screen by themselves. Names, employee IDs and active/inactive identity status remain basic identity data. Custom fields are controlled as a category, not individually by custom-field ID.

Legacy grants with only `enabled` and `areas` preserve all stations and editable fields, intersected with existing area grants. Strict schema 1 is accepted and converted in memory to schema 2; the next changed grant/recovery save persists schema 2. Invalid/future schemas fail closed. User, credential and event storage is unchanged.

## Discovery and saving

Call `authorization/session`, then `overview`. Both return the scope and permission revision. New capability flags: `operator_station_scope`, `operator_person_fields`. `overview.api.commands` is the authoritative command list for this account; role names/capability flags alone do not authorize commands.

`authorization/preview` accepts an unsaved policy and returns effective actions, station IDs, fields and restriction state. Preview grants nothing. `authorization/settings_update` remains administrator-only, replacing the complete policy map with the current revision. Refetch and preserve other users; stale saves return `revision_conflict`.

Persistence completes before publishing live rules. Cancellation cannot release the permission lock during saving; a failed save preserves old live grants. This ensures coherent durable/live authorization, not rollback of already-admitted device actions.

## Data projections

Overview, sync status, station lists/details and person lists/details/queries are scoped. Under station restriction a person needs an assignment in a permitted station to appear. Disabled assignments remain visible for inspecting inactive rights.

Restricted person records include `operator_editable` and `redacted_fields`. Hidden fields return empty placeholders: do not label these as absent credentials or unlimited validity. Outside assignments, overrides and timing bindings are omitted; shared identity membership is not displayed. Global removal queues and opaque fleet counters are omitted.

Projection happens before search, filtering, counting and paging. Hidden phones/cards cannot match search. Directory snapshot tokens for non-admin operators change after a permission revision; discard stale cached pages.

Events are filtered before paging/aggregation; reports, CSV and print use the same rows. Hidden card/portrait data is removed before export. Current group/custom-field audience filters require field visibility. Source details and trace workflows that could reveal hidden fields are unavailable to field-restricted accounts.

`fleet/alerts` also filters station observations before deriving counts, pages and maintenance/snooze lists. An empty `station_id` means all permitted stations, never the entire fleet for a scoped operator. `fleet/alerts_action` may change presentation policies only for a permitted station and still requires station-management permission and the current global alert-policy revision. Policies on outside stations are preserved. Neither operation changes device state.

`clock/settings_get` exposes only the saved NTP server/port/interval and revision. An operator with management-area access may use that revision for `clock/station_sync` on a permitted station. Global NTP preference changes and host configuration/status remain unavailable to scoped grants. The station's compact clock controls consult command discovery and lose their action controls immediately after a permission change. Applying NTP verifies configuration separately from measured clock alignment.

## Writes and shared identities

Explicit station IDs are checked before lookup or device I/O. A person also assigned to an outside station is read-only; an outstanding outside device binding also blocks mutation after its assignment was removed. This protects global PIN/cards/name/active state at unrelated stations.

Omit every patch field that is not `manage`. Even an unchanged read-only value returns `field_access_denied`; never send redaction placeholders back. `users/create` requires access-field management and, with station restriction, at least one enabled permitted assignment. Outside assignments, including inherited group rights, are rejected. Unassigned creation returns `operator_scope_required`. Existing revision checks remain. PIN uniqueness remains global; availability never identifies the conflicting person.

Global imports, person CSV export, bulk policy/approval jobs, global libraries, WhatsApp history/sending, audit/investigation and opaque review workflows are unavailable to restricted grants. Unrestricted grants and administrators keep these capabilities. Always consult `overview.api.commands`.

Station-reader enrollment remains available with user management and credential management grants. `cards/capture_start` requires a local editable person and permitted station; status/cancel/confirm resolve their opaque session ID back to the same operator, station and person. Another operator cannot take the session. Collection is private and temporary until explicit confirmation. The server rechecks current grants and assignments during collection and while waiting, dropping the session and card after revocation; no UI polling is needed. A changed person revision still requires a fresh capture. Confirmation admitted before revocation may finish its durable save; inspect saved state rather than replaying it.

## Sessions, caches and failures

MSE/RTC/audio/TTS startup checks station access. Active media rechecks ownership and closes after station removal; audio tokens cannot continue after revocation. Transport tests do not prove physical audibility.

The panel closes person/edit/camera views and clears private caches after effective grant changes; a delayed detail reply cannot restore old data. VMS clients must do the same after a data-free `refresh`: refetch session/overview, compare grants, close obsolete views, cancel pending reads, clear pages/photos/conversations. On `access_revoked`, erase private state and stop.

Errors: `unauthorized` (outside target/unsupported command), `field_access_denied`, `person_scope_shared`, `operator_scope_required`, `permissions_changed`. The latter means a revision changed while a request ran: refetch and review; never automatically replay a write. An admitted write may have completed, so reconcile saved/device status first.

## Acceptance

With a dedicated non-admin account verify: selected station only; forged outside ID denied; hidden phone not searchable; read-only phone survives a name edit; outside group denied; shared identity protected; scoped creation works; permission changes stale directory snapshots; reports filter consistently; station revocation closes live media. Confirm administrator and legacy workflows still work. Separate physical tests from software acknowledgements.
