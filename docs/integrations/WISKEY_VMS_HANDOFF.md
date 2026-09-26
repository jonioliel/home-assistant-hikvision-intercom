# smplwise access control (WisKey) ↔ VMS integration handoff

**Code reviewed:** smplwise access control 2.0.0-rc.1 (26 September 2026). This document describes the API that exists in this repository today. It is not a claim that a separate, stable VMS API has already been released or that the external VMS has been tested.

## Instructions for Claude implementing the VMS client

Build a **server-side HA WebSocket adapter** for this existing integration. Do not reimplement ISAPI in the VMS, copy its private `.storage` JSON, or expose the HA bearer token to browsers. Treat every `station_id`, `user_id`, `event_id`, `revision`, cursor and workflow token as opaque. Start with the read-only flows; gate all writes behind a visible operator confirmation. The companion [command catalog](WISKEY_VMS_PANEL_COMMANDS.json) is generated from the integration's `COMMANDS` registry and lists all 134 panel commands and their required top-level field types. It is not an independent, stable `vms/v1` API contract.

1. Create a dedicated, active **non-admin** Home Assistant account for the VMS, configure only the necessary WisKey area grants, and keep its token in the VMS backend secret store.
2. Connect to `wss://<HA-host>/api/websocket`; answer `auth_required` with the token; correlate each command by its integer `id`. On reconnect, authenticate again and resubscribe.
3. Call `authorization/session`, then `overview`. If access is denied, stop. Read `overview.result.api.version`, `capabilities`, and `commands`; enable VMS controls only for commands this account is allowed to call.
4. Implement bounded pagination for `users/query` and `events/list`. Subscribe to data-free invalidations, refresh caches on `refresh`, and erase private caches on `access_revoked`.
5. For each mutation, fetch the current object and `revision`, show the exact target and consequence to the operator, send `api_contract: 1`, then refetch. Treat `success: true` as a software acknowledgement; show device sync or physical confirmation separately.
6. Keep camera viewing and talkback as separate integrations. HA camera entities are the first video route; the panel's MSE/RTC and audio bridges are stateful implementation endpoints, not general RTSP URLs.
7. Test with a non-admin account: allowed read, denied write, one controlled action on a test station, stale revision, disconnect/reconnect, token revocation, and a real event. Never use production PIN/card data in test fixtures.

**Namespace migration:** version 2.0.0-rc.1 uses `smplwise_access_control/` and `/api/smplwise_access_control/...`. Existing VMS calls to `hikvision_intercom/` must be updated after the HA domain migration. During migration, do not run old and new writers against the same stations. The [operator migration guide](../DOMAIN_RENAME_MIGRATION_HE.md) covers HA config entries and rollback; this document covers the VMS client.

## Architecture decision

Keep WisKey installed as a **Home Assistant integration**. It owns the Hikvision/ISAPI sessions, access policy, credential synchronization, schedules, event collection, camera entities, and audit trail. The VMS should connect to Home Assistant as a client:

```text
VMS backend ──TLS + HA user token──▶ HA WebSocket API ──▶ WisKey integration ──▶ intercoms
VMS browser ──▶ VMS backend (no HA token in browser)
Video viewer ──▶ authenticated HA camera/stream route or a later dedicated media adapter
```

Converting WisKey to a Home Assistant *app* (formerly add-on) would create a second runtime/container and a migration problem, but would not make device control or user data easier to access. An optional app/sidecar can be added later for transcoding, recording, or a VMS-local service if such a runtime is actually required. The integration remains the single writer of access credentials and policies.

**Do not read or write WisKey's `.storage` files, or connect the VMS directly to the stations for operations WisKey manages.** Either path bypasses revision checks, per-user grants, sync reconciliation, and audit attribution.

## Authentication and deployment

Home Assistant exposes `wss://<HA-host>/api/websocket`. A VMS **server** connects with an HA access token belonging to a dedicated, active HA account; the token is kept server-side in a secret store. Prefer OAuth/refresh tokens for a distributed product, or a long-lived access token for one trusted site deployment. Configure WisKey's **Management tools → HA user permissions** for this account. Give `view` or `manage` only for the needed areas: `overview`, `users`, `events`, `stations`, `management`. An HA administrator bypasses these WisKey grants, so do not use an administrator token for routine VMS operation.

The current permission system is **area-level**, not per-station or per-door. If a VMS operator must be restricted to particular doors, this requires a new server-side authorization layer in WisKey before exposing that capability to the VMS. Hiding a button in the VMS is not sufficient. HA camera entity permissions also apply to HLS independently of WisKey panel permissions.

Connection flow (the token is a placeholder, never commit it):

```jsonc
// server → auth_required
{"type":"auth_required","ha_version":"..."}
// client → server
{"type":"auth","access_token":"<HA_ACCESS_TOKEN>"}
// server → auth_ok
{"type":"auth_ok","ha_version":"..."}
// then client → server, using a fresh integer id for each command
{"id":1,"type":"smplwise_access_control/authorization/session"}
{"id":2,"type":"smplwise_access_control/overview"}
```

HA command replies have the standard envelope `{"id":2,"type":"result","success":true,"result":{...}}`. Failed commands use `success:false` and an `error.code`; never treat a WebSocket acknowledgement as proof that a physical action happened. `overview.result.api` contains the current `version`, `min_client`, `capabilities`, and **the commands authorized for the connected HA user**. The panel contract is currently version `1`; include `"api_contract":1` on write commands. The [source-derived catalog of all 134 panel commands and their required top-level fields](WISKEY_VMS_PANEL_COMMANDS.json) accompanies this document. Nested object schemas, allowed enum values, workflow tokens, and responses still require the WisKey source (`websocket.py`, `audio_api.py`, `audio_tts.py`); the catalog is not a standalone OpenAPI specification.

## Existing operations the VMS can call now

All messages below use the same authenticated HA WebSocket. The `smplwise_access_control/` prefix is shown in full once; append the paths in the table. An omitted field is different from an empty field: the current panel schemas require the fields listed in `COMMANDS` even when a value is empty.

| VMS function | Current command paths | Notes |
| --- | --- | --- |
| Overview, station health, call state, mapped lock/camera entities | `overview`, `stations/list`, `stations/get`, `health/get` | `station_id` is the HA config-entry ID returned in `stations[].id`; use it as an opaque identifier. |
| People, groups, photo, access rights, sync state | `users/query`, `users/get`, `users/photo_get`, `profiles/settings_get`, `permissions/directory`, `sync/status` | User projections redact PIN and full card numbers. Photo is a separate privileged read. |
| Access and bell events | `events/list`, `events/detail` | WisKey's own bounded event store; filters/paging below. |
| Live change notification | `subscribe` | Sends data-free `refresh` or `access_revoked` events; refetch after `refresh`. This is **not** a stream of event records. |
| Door release | `stations/test_unlock` with `station_id` and physical `lock` integer | Requires WisKey `manage` in overview or stations; only configured managed relays are accepted. Confirm in the VMS before sending. |
| Person/credential administration | `users/create`, `users/update`, `users/delete`, `users/set_active`, `cards/add`, `cards/remove`, `sync/user` | Requires `users:manage`; mutations use revision checks. Do not attempt to retrieve existing PIN/card secrets. |
| Groups and schedules | `profiles/settings_*`, `schedules/*`, `stations/technical_program_*` | These are specialized workflows with preview/revision/confirmation semantics. Integrate only after reading their actual command schema and testing against WisKey. |
| Station/public-code/admin controls | `stations/technical_*`, `clock/*`, `sync/station`, `sync/all` | Sensitive; requires the relevant `manage` grant or HA administrator. Capability varies by station firmware. |
| Calls and audio | `media/call`, `media/signal`, `audio/start`, `audio/send`, `audio/receive`, `audio/mute`, `audio/diagnostics` | Audio is a stateful, per-WebSocket binary-packet workflow, **not** a generic media URL. A separate VMS media adapter is recommended. |
| Text-to-speech | `tts/engines`, `tts/start` | Starts a per-connection session; require operator confirmation and show playback result separately. |
| WhatsApp | `whatsapp/preview`, `whatsapp/send`, `whatsapp/history` | Sending requires reviewed message and confirmation token. Never auto-send upon VMS import. |
| Reports, audit, conflict resolution | `events/report`, `events/export`, `audit/list`, `operations/query`, `conflicts/list`, `conflicts/review`, `conflicts/resolve` | Export payloads are bounded; conflict resolution needs review tokens and an explicit operator choice. |
| Fleet readiness and physical acceptance | `stations/inventory`, `stations/permission_audit`, `health/refresh`, `fleet/inventory_export`, `upgrade/readiness`, `acceptance/get`, `acceptance/update` | Diagnostics describe software observations; acceptance is a separate human-recorded result. |
| User import, bulk changes and card capture | `users/csv_inspect`, `users/csv_preview`, `users/csv_apply`, `users/bulk_preview`, `users/bulk_apply`, `cards/capture_*` | Use preview/review tokens and receipts; card capture depends on station capabilities and a live session. |
| Shared configuration | `appearance/settings_*`, `media/settings_*`, `clock/settings_*`, `authorization/settings_*`, `whatsapp/templates_*` | These are administrator configuration workflows. Never expose them to a normal VMS viewer. |

Examples of read-only requests:

```json
{"id":3,"type":"smplwise_access_control/users/query","query":"","filters":{},"offset":0,"limit":100,"snapshot":""}
{"id":4,"type":"smplwise_access_control/events/list","filters":{"limit":100}}
{"id":5,"type":"smplwise_access_control/subscribe"}
```

`users/query` returns `records`, `total`, `offset`, `limit`, `next_offset`, `snapshot`, and `stale`. Continue with `next_offset`, passing the previous `snapshot`; restart pagination if `stale` is true. Event filters support `station_id`, `person`, `result` (`granted|denied|unknown`), `authentication` (`card|pin|unknown`), `door` (`1|2`), ISO-8601 `start`/`end`, `limit` (1–200), and `before` (the `next` cursor from the previous page). `events/list` returns `records`, `next`, `retention_days`, `capacity`, `storage_failed`, and per-station collection status. Save the last seen event ID in the VMS and deduplicate on reconnect; the cursor may expire as the bounded WisKey store prunes old events.

For `subscribe`, retain its command ID. On `{"type":"event","id":5,"event":{"kind":"refresh"}}`, query only the views the VMS needs; debounce bursts. On `access_revoked`, drop cached private data and disconnect. Reconnect with backoff and re-authenticate after network interruption. If the VMS needs low-latency event payloads or durable replay beyond 30 days, implement a dedicated versioned event feed/export in WisKey first; do not reinterpret `subscribe` as such a feed.

## Concrete WebSocket workflows

After HA authentication, these requests show the command envelope. All IDs are examples; the VMS must allocate unique IDs per connection. The account's grants may still reject a command listed here.

```json
{"id":10,"type":"smplwise_access_control/authorization/session"}
{"id":11,"type":"smplwise_access_control/overview"}
{"id":12,"type":"smplwise_access_control/users/get","user_id":"<opaque-user-id>"}
{"id":13,"type":"smplwise_access_control/users/update","api_contract":1,"user_id":"<opaque-user-id>","revision":4,"data":{"phone":"050-123-4567"}}
{"id":14,"type":"smplwise_access_control/stations/test_unlock","api_contract":1,"station_id":"<overview.stations[].id>","lock":1}
```

The user revision in request 13 is illustrative; fetch the actual value from `users/get`. The `lock` value is the **physical index** from `station.integrated_locks[]`, not an array position. `stations/test_unlock` returns after the configured release attempt; its acknowledgement does not prove that the door moved. The VMS should show station online/sync state and retain WisKey audit attribution to the dedicated HA user.

A bell/call workflow can read `media/call` to inspect context, then send `media/signal` with `command` equal to `answer`, `reject`, or `hangUp`. These calls depend on station firmware and current state. Do not infer a live audio path from call signalling success.

WhatsApp is deliberately two-step: `whatsapp/status` discovers configured accounts; `whatsapp/preview` returns a recipient, editable message and short-lived token; show those to the operator; then call `whatsapp/send` with the same `user_id`, account, token, edited `message`, and `confirmed: true`. A successful response means the provider call was accepted, not that the recipient read or received it. `whatsapp/history` returns up to 200 messages; use one-time `whatsapp/media` tokens for attachments. Phone formatting to `+972...` is handled inside WisKey.

For TTS, call `tts/engines`, choose a returned `engine_id`, and start `tts/start` with exactly `station_id`, `engine_id`, `language` (string or null), and `message` (1–500 characters). The subscription emits `generating`, `speaking`, `completed`, or `closed`; a completed software playback still does not verify the physical loudspeaker. A TTS session conflicts with another microphone/TTS session on the same station.

For two-way speech, `audio/start` returns a subscription and later emits `ready` with a connection-bound token, 8 kHz audio parameters and 800-byte packets. `audio/send` needs sequential, base64-encoded 800-byte G.711 µ-law packets; `audio/receive` pulls speaker packets; `audio/mute` and `audio/diagnostics` act on the same token. The bridge has idle and maximum-duration limits and closes on lost authorization. Integrate the existing browser panel or build a separately tested media adapter before promising this flow in the VMS.

**Failure handling:** inspect `success:false` and `error.code`. `unauthorized`, `invalid_fields`, `revision_conflict`, `station_unloaded`/`station_offline`, `device_busy`, `rate_limited`, and `audio_busy` require different UI responses. Never retry an uncertain door, credential or WhatsApp write blindly. Refetch state after any uncertain outcome.

## Video integration boundary

WisKey registers HA `camera` entities and exposes their entity IDs in `overview.result.stations[].entities.camera`. The camera supports snapshots and, where the station provides it, HA's stream pipeline. Use the **HA camera API** and authenticated, proxied HLS for the first VMS viewer. Do not place intercom RTSP credentials in the VMS browser. WisKey's current `/api/smplwise_access_control/mse/{station_id}` and `/api/smplwise_access_control/rtc/{station_id}` WebSocket bridges are panel-specific, require authentication, and are tied to the global selected playback mode; they are not yet a stable third-party streaming contract. There is an independent microphone/talkback path through HA/ISAPI. A VMS that needs synchronized video, listen, talk, call-answer/hangup, and recording should get a dedicated media-session adapter with explicit lifecycle, codec negotiation, timeouts, and authorization.

## Storage: authoritative data and limits

WisKey does **not** use a separate SQL database for its user and event records. `AccessStore` extends HA's private `Store` and writes atomic JSON envelopes in HA's configuration `.storage` directory:

| Data | HA configuration path | Source |
| --- | --- | --- |
| Managed users, groups/profile definitions, phone numbers, photos, PIN/card secrets, assignments, sync metadata and admin audit | `.storage/smplwise_access_control.users` | `storage.py`, `access_runtime.py`, `access/repository.py` |
| WisKey collected access/ring event cache and collection cursors | `.storage/smplwise_access_control.events` | `event_manager.py`, `events.py` |
| Other settings, schedules, permissions and operations | separate `.storage/smplwise_access_control.*` files | `access_runtime.py` |

The event cache is **maximum 5,000 records or 30 days**, whichever is reached first. It is not an unlimited historical archive. User photos currently live inside the private user record, with a repository-wide photo-size cap. Stored PINs and full card numbers are private and are not returned by public user reads. The private Store uses restricted file permissions and atomic writes, not field-level encryption; protect HA backups and filesystem access accordingly.

HA **Recorder** is separate: it can record selected HA entity state changes/events in its configured SQL database (SQLite `home-assistant_v2.db` by default, or MariaDB/MySQL/PostgreSQL when configured). Recorder is **not** WisKey's source of truth for managed users or the bounded WisKey event cache. Do not use the Recorder database as the VMS integration API. If the VMS requires multi-year searchable access history, plan a forward event export with backfill/retention policy; the current cache cannot reconstruct already-pruned records.

## Work needed before treating this as a durable third-party product API

1. Freeze and publish a `vms/v1` contract separate from the panel contract, with documented fields, error codes, deprecation policy, and compatibility tests. The current `api_contract.version=1` declares **panel** compatibility only.
2. Add server-side VMS authorization at the required scope, especially per-station/per-door grants, plus audit attribution and rate limits independent of the VMS UI. The current HA-user grants are area-level.
3. Add event delivery with durable cursor/replay, so the VMS can recover after outages without relying on the 5,000/30-day UI cache; specify what happens when history is incomplete.
4. Expose a media-session API or adapter for VMS video/call/audio instead of embedding the panel's MSE/RTC/audio protocol verbatim.
5. Add an integration test client using a dedicated non-admin HA user: authorized reads, rejected writes, approved door command against a simulator/test station, pagination, revocation while subscribed, token rotation, reconnect, and event replay.

Until then, the current authenticated WebSocket commands are suitable for a controlled, site-local integration prototype. They should not be treated as a complete externally supported API without the above hardening.

## Source references

- WisKey command registry and dispatch: `custom_components/smplwise_access_control/websocket.py`
- WisKey panel contract: `custom_components/smplwise_access_control/api_contract.py`
- WisKey authorization: `custom_components/smplwise_access_control/panel_permissions.py`
- WisKey storage and retention: `custom_components/smplwise_access_control/storage.py`, `event_manager.py`, `events.py`
- WisKey cameras and media: `camera.py`, `mse_api.py`, `rtc_api.py`, `audio_api.py`, `audio_tts.py`
- [Home Assistant WebSocket API](https://developers.home-assistant.io/docs/api/websocket/)
- [Home Assistant integration architecture](https://developers.home-assistant.io/docs/architecture_components/)
- [Home Assistant apps/add-ons](https://developers.home-assistant.io/docs/apps/)
- [Home Assistant camera entity](https://developers.home-assistant.io/docs/core/entity/camera)
- [Home Assistant Recorder](https://www.home-assistant.io/integrations/recorder/)
