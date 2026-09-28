# SMPLWISE VMS ← WisKey: add-on integration and screen-parity handoff

**Target:** SMPLWISE VMS running as a Home Assistant add-on/app on the same HA installation.

**Target WisKey source:** v2.0.0-rc.15, 28 September 2026. New operations are documented in the focused references below; the earlier screen map remains applicable.

**Status:** implementation guide derived from this repository; it does not assert that VMS integration or physical station tests have already been completed.

**Audience:** the developer or Claude agent implementing the VMS connector and its UI.

## תקציר לבעל המערכת

ה־VMS יכול לרוץ כתוסף ב־Home Assistant ולהתחבר ל־WisKey דרך ה־WebSocket הפנימי של HA. אין צורך להסיר או להעביר את WisKey מהאינטגרציה הקיימת. המסמך ממפה את חמשת מסכי הניווט, כלי הניהול והפקודות שמפעילות אותם, יחד עם דוגמאות חיבור ובדיקות קבלה. הנתונים וההרשאות ממשיכים להישמר ולהיאכף ב־WisKey. וידאו, שיחה ושמע דורשים מתאם מדיה ובדיקות נפרדות כדי להגיע לשוויון מלא בממשק החדש.

הקובץ נכתב באנגלית טכנית כדי שאפשר יהיה להעביר אותו ישירות ל־Claude כמפרט מימוש. רשימת הפקודות המעודכנת נמצאת בקובץ JSON הנלווה.

## Additions in 2.0.0-rc.14

Use the advertised installed commands and existing operator grants. Preserve the distinction between saved intent, synchronization evidence and physical access:

- [Visit operations](VISIT_OPERATIONS_API.md): templates without credentials, temporary cancellation, atomic inactive guest creation, approval by a selected second operator and server-filtered queues. Decisions must run under the actual chosen operator identity; an add-on service account cannot impersonate the host by adding an actor field.
- [Fleet alerts](FLEET_ALERTS_API.md): cached observations, durable snoozes/maintenance and restoration. These policies suppress alert presentation, not underlying faults or synchronization.
- [Investigation timeline](INVESTIGATION_TIMELINE_API.md): administrator-only safe evidence query, conservative person matching, stable paging, browser-local saved filters and consistent complete JSON report. Ordinary management grants do not grant the combined endpoint.
- [Local listening output](BROWSER_AUDIO_OUTPUT.md): a VMS media viewer must route its own media elements/audio contexts; this is not a backend preference or device command.

Include the schema-11 user repository and the new guest-template and fleet-alert policy stores in normal configuration backups. Restore the matching pre-upgrade backup for software rollback. The namespace, API contract and existing screens/appearances are unchanged.

## 1. The intended ownership boundary

Keep smplwise access control / WisKey installed as the HA integration under its **technical domain hikvision_intercom**. The visible brand is not the command namespace. WisKey remains the only writer of managed people, PIN/card credentials, group access, station synchronization, door programs, public codes and ISAPI station state. VMS consumes WisKey through HA and may present those operations in its own UI.

~~~text
VMS add-on backend ── authenticated HA WebSocket ── WisKey integration ── intercoms
VMS ingress browser ── VMS backend / its own operator policy
Video in VMS ── HA camera/stream service or an explicitly designed media adapter
~~~

Do not read or edit HA private .storage/hikvision_intercom.* files, call the intercom ISAPI directly for WisKey-managed data, copy PIN/card secrets into VMS, or use the HA Recorder database as an API. Those paths bypass WisKey's revisions, permissions, synchronization, and audit context.

The already installed HA panel is at /hikvision-intercom on the **HA frontend origin** ([panel.py](../../custom_components/hikvision_intercom/panel.py)). A VMS link to that route is the quickest way to show the exact original screens under the browser's HA login, but it opens the WisKey panel rather than reproducing it inside the VMS. Embedding it as an ingress iframe is not a verified integration route; origin, cookies and frame policy must be tested separately. The native VMS screen map below is the route for actual in-VMS parity.

**The exact WisKey 04 appearance is a frontend implementation, not a backend response.** Recreate the screens against the APIs below, or deliberately share the current frontend component source after supplying its expected HA hass object and testing every lifecycle. Copying only CSS or loading the compiled panel.js into an ingress page will not supply its HA context or make it a supported VMS component.

**Additive lifecycle response in 2.0.0-rc.13:** `users/lifecycle` (send `warning_days`, e.g. `30`) now optionally includes `temporary_access: {summary, users}`. The summary counts all visitors/contractors; the list contains at most 200, sorted by expiry, and `truncated.temporary_access` signals clipping. Each row includes `revision`, `state` (`active`, `upcoming`, `expired`, `inactive`), `expiring_soon`, category, responsible person, purpose, outer validity and `timing_policy_configured`. These states describe configured validity, not physical access or completed station sync. Never interpret `active` as permission to bypass the additional time policy.

To reproduce **Renew validity**, show the existing/new periods and explicitly confirm before calling `users/update` with the row's current `revision`, `data: {valid_from, valid_until}` (timezone-aware UTC instants), `sync_now: true` and `api_contract: 1`. Send only the dates; preserve active state, credentials, assignments and timing rules. Require Users management permission on the server. Refetch after success, show sync separately, and close/reload on a revision conflict. No separate renewal endpoint or storage migration was added. Older responses without `temporary_access` retain the earlier lifecycle view.

## 2. Running inside an HA add-on

The official HA add-on communication path is:

- Enable homeassistant_api: true in the VMS add-on config.yaml.
- Inside the add-on backend, connect to ws://supervisor/core/websocket.
- Read SUPERVISOR_TOKEN from the process environment and send it in the standard WebSocket auth message.
- Keep this token in the backend. Never serialize it into ingress HTML, browser JavaScript, a log, URL, screenshot or VMS API reply.
- Use http://supervisor/core/api/ for HA REST requests when needed; the same environment token is a bearer token there.
- If VMS uses HA Ingress, ingress authenticates access to the VMS web app. **It does not by itself make a backend WisKey WebSocket call run as the individual browser operator.**

Minimal relevant add-on settings (merge into the VMS add-on's existing config.yaml; do not replace its other options):

~~~yaml
homeassistant_api: true
ingress: true
ingress_port: 8099  # use the port the VMS server actually listens on
~~~

Only ingress apps need the ingress lines. HA's default ingress port is 8099; set ingress_port to the actual VMS listening port when different. This exposes VMS to HA's ingress browser, not the WisKey API directly.

HA's [app communication documentation](https://developers.home-assistant.io/docs/apps/communication/) specifies both proxy URLs and the token. The [WebSocket protocol documentation](https://developers.home-assistant.io/docs/api/websocket/) specifies auth/result/event envelopes. HA's [ingress documentation](https://developers.home-assistant.io/docs/apps/presentation/) describes browser access. These are deployment facts; the command shapes below come from WisKey source.

There are two sensible authentication modes:

| Mode | HA WebSocket credential | WisKey actor and permission consequence |
| --- | --- | --- |
| Site-local service connector | SUPERVISOR_TOKEN via the Supervisor proxy | Check the resulting authorization/session and overview.access at startup. Do not assume its privilege level or equate it with an ingress operator. Enforce VMS roles on the VMS backend. WisKey audit attribution is to the HA identity resolved for this connection. |
| Dedicated HA account | Dedicated active HA user token over a configured HA /api/websocket URL | Give only necessary WisKey view/manage grants under Management → HA user permissions. All actions are attributed to that service account unless each operator authenticates separately. |

For per-operator WisKey permissions and audit identity, a single service token is insufficient. Use a supported HA authentication flow for each operator or add an explicit server-side delegated identity mechanism. A VMS permission toggle alone cannot restrict a higher-privilege service token.

Example protocol, with values replaced by placeholders:

~~~json
{"type":"auth_required","ha_version":"..."}
{"type":"auth","access_token":"<BACKEND_ONLY_TOKEN>"}
{"type":"auth_ok","ha_version":"..."}
{"id":1,"type":"hikvision_intercom/authorization/session"}
{"id":2,"type":"hikvision_intercom/overview"}
{"id":3,"type":"hikvision_intercom/subscribe"}
~~~

The first three lines are the auth exchange; subsequent commands use a new integer id per connection. A normal reply is {"id":2,"type":"result","success":true,"result":{...}}. A failure has success:false and error.code. A subscription sends {"id":3,"type":"event","event":{"kind":"refresh"}} or kind access_revoked. After reconnect: authenticate, re-read session and overview, resubscribe, and discard stale in-flight responses.

If the VMS backend itself is not the only place where operator authorization is enforced, do not enable mutations yet.

A runnable **read-only backend smoke test** is [examples/wiskey-addon-readonly.mjs](examples/wiskey-addon-readonly.mjs). It requires Node.js 22+ and SUPERVISOR_TOKEN (or WISKEY_HA_TOKEN with WISKEY_HA_WS_URL). Run it inside the add-on backend, not in an ingress page. It prints only WisKey version, counts and permitted areas; it does not implement production reconnection, user-level VMS authorization or mutations.

## 3. API compatibility and discovery

The current API is the **WisKey panel contract v1**, not a frozen VMS v1 API. Its command namespace remains hikvision_intercom/ even though the visible product name changed. WisKey 2.0.0-rc.4 advertises its version and per-user command set in overview.result.api:

~~~json
{
  "version": 1,
  "min_client": 0,
  "capabilities": ["panel_permissions", "user_directory_query", "intercom_tts"],
  "commands": ["overview", "users/query"]
}
~~~

The arrays above are shortened examples. Call authorization/session and overview at login, check access.allowed and access.areas, then enable a control only if the matching command appears in api.commands. Most write requests carry api_contract:1. The complete, source-derived inventory of **management commands with required top-level field types** is [WISKEY_VMS_PANEL_COMMANDS.json](WISKEY_VMS_PANEL_COMMANDS.json). Separate handlers implement subscribe, audio/* and tts/*; their schemas and stateful behavior are not fully described by that JSON.

Use the response from the installed instance as the runtime authority. A command in this guide or catalog is not necessarily available to a low-privilege account or supported by every station.

Recommended backend adapter boundaries:

1. HA socket client: auth, integer request IDs, bounded timeouts, subscription and reconnect.
2. WisKey typed client: version/capability detection, required fields, error codes, revisions.
3. VMS authorization and audit: map each VMS operator action to an allowed service operation; never trust disabled buttons as a security boundary.
4. VMS UI projection: only safe fields; keep a short-lived cache, invalidate on refresh, clear on access_revoked.
5. Separate media adapter: camera/video, listen, microphone, call and TTS have different lifecycles.

Do not return the HA token or arbitrary HA WebSocket proxy access to the browser. If VMS creates its own internal HTTP endpoints, they are VMS endpoints and must carry its own authorization; they are **not** new WisKey endpoints.

## 4. Data model and authoritative storage

The canonical read is hikvision_intercom/overview. Its typed frontend model is [frontend/src/types.ts](../../frontend/src/types.ts). Relevant fields:

| Object | Fields VMS should use | Display rule |
| --- | --- | --- |
| overview | version, api, access, stations, users, user_count, media_settings, profile_settings, appearance_settings, default_zone, sync_operations, tombstones, revocations | This is an authorized projection. A user without people access may receive users:[]; a user without stations access receives fewer technical station fields. |
| station | id, name, online, call_state, sync_state, last_seen, last_access, entities, integrated_locks, capabilities, event_status, clock, model, firmware | id is the opaque HA config-entry ID; use integrated_locks[].physical_index for release, never array index or display name. Station sync_reference is diagnostic, not a label. |
| person | id, employee_no, display_name, phone, active, revision, assignments, profile, group_ids, permission_overrides, valid_from, valid_until, access_timing_policy, access_timing_draft, pin_configured, cards, photo_configured | No existing plaintext PIN or full card number is returned. cards contain masked_number. Photos require users/photo_get if enabled and authorized. |
| assignment | enabled, allowed_locks, sync_state, desired_revision, applied_revision, last_sync_at, last_error | Distinguish saved intent from verified station application. An offline station does not mean the person is inactive. |
| event | event ID, timestamp/time_source, station_id, identity/authentication/result, door, portrait when available | Source is events/list and events/detail. Historical event portrait is not necessarily the current user photo. |

WisKey uses HA private Store JSON envelopes, not its own SQL database. Managed people, groups, photos and synchronization metadata are in .storage/hikvision_intercom.users; collected events in .storage/hikvision_intercom.events; other settings and schedules in separate .storage/hikvision_intercom.* files. The event cache retains at most **5,000 events or 30 days**, whichever limit is reached first. HA Recorder is separate and is not the WisKey people/event source of truth. Export forward to a VMS database if VMS needs longer retention; it cannot recover events already pruned by WisKey.

## 5. Screen-by-screen VMS parity map

Use WisKey 04 as the visual reference: [frontend/src/wiskey-v4-styles.ts](../../frontend/src/wiskey-v4-styles.ts), [frontend/src/wiskey-v4-overview.ts](../../frontend/src/wiskey-v4-overview.ts), [frontend/src/panel.ts](../../frontend/src/panel.ts), and [frontend/src/i18n.ts](../../frontend/src/i18n.ts). Current navigation in that appearance is **מרכז הכניסה / אנשים / דלתות / פעילות / ניהול**. Light and dark are distinct appearance IDs wiskey-light and wiskey-dark. Older themes remain selectable in WisKey; VMS need not impersonate a personal WisKey preference unless it implements that UX explicitly.

| VMS screen / module | Read and live source | Writes / interactions to preserve | Faithful UI and state |
| --- | --- | --- | --- |
| Entry center / overview | overview; subscribe invalidation; station.entities and last_access | stations/test_unlock for selected physical relay; launch camera and person/event views | Responsive 1–X station grid; online/offline, ringing/call state, named locks, recent access, live clock, search/filter/page. Camera images use contain so they never stretch. Release busy state belongs to the chosen station and relay. |
| People directory | users/query plus overview.profile_settings and stations; users/get on selection | sync/user; create/edit/delete and bulk flows below | Server paging 25/50/100/200, query/filters, saved views if reimplemented, stable selection, custom fields, groups, full phone on one LTR line (05X-xxx-xxxx), masked credentials and truthful per-station sync. |
| Person detail | users/get, users/photo_get, profiles/settings_get, permissions/directory, whatsapp/history | Open editor; sync/user; WhatsApp preview | Large photo, name/phone/employee no, custom fields, effective door rights with group/override source, timing, validity, cards, sync; no cramped nested sideways scrolling. Viewing a person and editing are distinct states; navigating to Events must not open the editor. |
| Person editor | users/get and profiles/settings_get; users/pin_check and users/pin_generate when authorized | users/create/update/set_active/delete; cards/add/remove; cards/capture_*; sync/user | One draft/revision across details, custom fields, group membership, personal allow/deny, door/relay rights, date validity, weekly/date timing, PIN, cards and photo. Validate before save; show save vs station sync separately. |
| Doors / stations | stations/list/get or overview; health/get, stations/technical_get, stations/technical_program_list, stations/technical_codes_get | stations/test_unlock, stations/rescan, sync/station, station-specific advanced writes | List/grid then station tabs: overview, opening programs, public codes, settings. Show real model/firmware/clock/managed relay; expose Relay 2 only when configured and connected. |
| Station opening programs | stations/technical_program_list and relevant schedules/* reads | stations/technical_program_save/action, technical_hold_save/delete; schedule plan/operation flows when supported | Distinguish HA-managed continuous open from device-local schedules and a person's access times. Show active/paused/removing/error, origin and verification; edit/pause/remove visible. Never label an unsupported native schedule as active. |
| Public station codes | stations/technical_codes_get | stations/technical_codes_write | Slots and door mapping, configured/unconfigured/unverified, edit/add/delete with old-code challenge and explicit confirmation. Never display recovered plaintext public PIN; read capabilities instead of assuming every station supports a write. |
| Activity / events | events/list, events/detail; events/report/export/print | Filters/export, optional events/history_inspect and trace workflows for diagnostics | Timeline/table with person portrait when actually supplied, station/door/result/authentication/time source, paging cursor, filter by dates/person/station. Read-only history is not an automatic durable VMS feed. |
| Camera / intercom dialog | station.entities.camera; media/call; media/settings_get; tts/engines; audio/diagnostics | media/signal answer/reject/hangUp; stations/test_unlock; tts/start; audio/start/send/receive/mute/stop | Video primary, controls below it, small refresh, listen off by default until gesture, microphone toggle/PTT according to shared setting, TTS composer and quick phrases vertically, fullscreen; clean up audio/video on close or background. |
| Synchronization | overview/sync/status, sync/diagnostics, conflicts/list, operations/query | sync/user, sync/station, sync/all; conflicts/review then resolve | Matrix labels use station.name rather than raw ID. One failed user must not block others. Pending/error/conflict/offline/verified are distinct. Refetch after operations; show exact unknown outcomes. |
| Health / readiness | health/get, stations/inventory, stations/permission_audit, fleet/inventory_export, upgrade/readiness, acceptance/get | health/refresh, acceptance/update | Show observed HA/device evidence separately from human physical acceptance. Download support/bundle only to authorized operators. |
| Management: profiles, groups, custom fields | profiles/settings_get, permissions/directory | profiles/settings_update; preview/apply for group policy impact | Group station grants are inherited by members, with personal allow/deny overrides. Custom labels/types and photo enablement are global. Preview impact before changing existing policies. |
| Management: schedules | schedules/list/export/readiness/dependencies/plan_list/operations_list | schedules/create/update/delete, plan_preview/save/recheck/delete, operations claim/create/check/cancel/archive, baseline_* | Schedule library, deployment plan, HA/native execution and physical readback are different states. Use the preview/token/revision workflow; never collapse all into one “saved” badge. |
| Management: shared media/TTS | media/settings_get, media/provider_check, tts/engines | media/settings_update/provider_discover | Global HLS vs WebRTC/RTC/MSE, HLS fallback, go2rtc URL, talk mode PTT/toggle, TTS engine/language, up to ten saved quick phrases. Settings belong here, not in the camera composer. |
| Management: NTP/time | clock/settings_get, clock/host_status, stations/get | clock/settings_update, clock/host_apply, clock/station_sync, stations/clock_refresh | Shared NTP setting, per-station clock and drift, host setting only when supported. Distinguish changing HA host config from syncing a station. |
| Management: WhatsApp templates | whatsapp/templates_get, whatsapp/status | whatsapp/templates_update | Editable shared message templates; sending stays an explicit person-level preview/edit/confirm flow. |
| Management: HA operator rights | authorization/session, authorization/settings_get | authorization/settings_update | Five areas overview/users/events/stations/management, levels none/view/manage. Settings editing is HA-administrator-only. Do not confuse operator screen rights with physical door grants. |
| Management: audit, operations and inventory | audit/list/export, operations/query, users/lifecycle, upgrade/readiness | Only documented review/repair commands after explicit operator action | Actor, outcome, timestamps and receipt; identity lifecycle, duplicate hints, expired access, sync backlog. No automatic merge or permission grant. |
| Global appearance | appearance/settings_get, overview.appearance_settings | appearance/settings_update where allowed | Global default light/dark/legacy WisKey layout. A VMS-local theme preference should not silently rewrite WisKey's global setting. |

The table is a screen-to-contract map, not permission to auto-enable all writes. Full button behavior, responsive states and Hebrew labels live in the frontend source above. Reproduce the camera dialog and each person/station workflow from the live component implementation, not from a static mockup.

## 6. Read, subscribe and pagination recipes

**Startup:**

1. Authenticate the backend HA socket.
2. authorization/session; stop and clear data if allowed:false.
3. overview; verify api.version/min_client, capability flags, access areas and allowed commands.
4. subscribe; maintain its id until disconnect.
5. Load only currently visible secondary screen data. Refresh those stores after a coalesced refresh event.

**People:**

~~~json
{"id":10,"type":"hikvision_intercom/users/query","query":"","filters":{},"offset":0,"limit":25,"snapshot":""}
~~~

Response has records, total, total_all, offset, limit, next_offset, previous_offset, snapshot and stale. Continue using next_offset and the returned snapshot. If stale:true, restart at offset 0; do not concatenate pages from different snapshots. User IDs are opaque. A single overview users array is not a replacement for directory paging.

**Events:**

~~~json
{"id":11,"type":"hikvision_intercom/events/list","filters":{"limit":100}}
~~~

Supported filter concepts are station_id, person, result, authentication, door, start, end, limit and before. Use the returned next cursor to page. Deduplicate by event ID when polling after reconnect. Subscribe is an invalidation signal, **not** a push feed of full event records. For durable VMS history, ingest promptly and separately track retention gaps.

**Person detail:** call users/get with user_id and users/photo_get only when photo_enabled and photo_configured, authorized. Never use a photo URL or card number from private storage.

## 7. Write-workflow recipes and truthfulness

All mutations must be initiated by a visible VMS operator action, be checked by the VMS backend role policy, and carry the correct current revision or review token. Refetch after success. For an uncertain transport result, refetch/read back; do **not** blindly retry a door release, credential write, WhatsApp send, or other non-idempotent operation.

**Person change:** read users/get → edit allowed data keys → optional duplicate_check/pin_check → show exact change → users/update with user_id, revision, data, api_contract:1 → refetch users/get and sync/status. An update response does not mean every station accepted the new person. sync/user queues reconciliation; per-assignment desired_revision/applied_revision/sync_state establishes that distinction. Use users/pin_generate for a new unique PIN; never try to read an existing PIN.

~~~json
{"id":20,"type":"hikvision_intercom/users/update","api_contract":1,"user_id":"<id>","revision":4,"data":{"phone":"050-123-4567"}}
~~~

**Group policy:** profiles/settings_get → edit fields/groups/templates and station_ids → profiles/settings_preview with current revision and values → inspect affected people/offline stations → profiles/settings_apply with returned operation_id when required. Person group_ids and permission_overrides are separate from operator panel rights. Refer to [profile-settings.ts](../../frontend/src/profile-settings.ts) and [profile_settings.py](../../custom_components/hikvision_intercom/profile_settings.py) for nested data shapes.

**Door release:** read station.integrated_locks and online state → select physical_index → explicit action → stations/test_unlock with station_id and lock. Do not auto-retry if WebSocket closes. “Accepted” means the API attempt completed; it does not prove physical door movement.

~~~json
{"id":21,"type":"hikvision_intercom/stations/test_unlock","api_contract":1,"station_id":"<station-id>","lock":1}
~~~

**WhatsApp:** status → user detail → preview(user_id, account, language) → render recipient and editable message to operator → send(user_id, account, token, edited message, confirmed:true) → history. Never send automatically when saving a person or generating a PIN. A provider acknowledgement is not delivery/read confirmation. WisKey converts stored Israeli phone numbers to the recipient format.

**Station programs and public codes:** use list/get/capability reads first. Apply the exact revision, confirmation, compatibility and readback workflow in [door-programs.ts](../../frontend/src/door-programs.ts), [public-codes.ts](../../frontend/src/public-codes.ts), [technical_api.py](../../custom_components/hikvision_intercom/technical_api.py), and the command catalog. A code read reports configuration/status, not the secret. Device-local support depends on the station, even if another station has the same model.

**Bulk/CSV:** inspect/preview → show per-row errors and capacity → apply with review_token/operation_id → fetch receipt → show partial outcomes. Never apply from an import file directly without preview. Selection is bounded and cannot silently expand to all users.

**Schedule:** a person's access_timing_policy (mode ha/native) differs from a station hold-open program. Check schedule readiness/dependencies, preview plans and only then save/operate with returned token and revision. Display HA-managed behavior truthfully if device-local ISAPI support is absent.

## 8. Media, calling and speech are separate protocols

**Camera:** overview.stations[].entities.camera provides the HA camera entity ID. Use HA's authorized camera/stream path as the first VMS integration route. The current WisKey MSE and RTC bridges are /api/hikvision_intercom/mse/{station_id} and /api/hikvision_intercom/rtc/{station_id}; they are authenticated, require WisKey view access, depend on the global media policy and use panel-specific WebSocket signalling. They are **not** generic RTSP URLs and are not a frozen external media API. HLS has HA camera entity authorization separately. Never expose RTSP credentials or the HA token in browser JavaScript.

An ingress-hosted browser and the HA panel are not automatically the same origin or auth context. Do not point an ingress iframe at the private bridge and assume cookies/auth work. To reproduce WisKey's current MSE/RTC viewer exactly, either design and test an authenticated VMS backend media proxy with explicit per-operator checks, or extract and adapt the existing [camera.ts](../../frontend/src/camera.ts), [camera-mse.ts](../../frontend/src/camera-mse.ts), [camera-rtc.ts](../../frontend/src/camera-rtc.ts) and their backend bridge protocols. Prototype this independently before declaring camera parity.

**Call signalling:** media/call reads current context; media/signal accepts answer, reject or hangUp. These are not proof that audio works. A rejected/hung-up call closes relevant audio/TTS sessions.

**Listening and microphone:** audio/start, audio/send, audio/receive, audio/mute, audio/stop and audio/diagnostics are session-bound, per-WebSocket workflows. The current implementation uses 8 kHz G.711 µ-law packets and connection-bound tokens; do not pass those tokens through long-lived browser URLs. Build a dedicated VMS media adapter or intentionally reuse/test the existing audio frontend protocol. Respect browser microphone permission, explicit user gesture, stop-on-close/background, PTT/toggle settings, busy errors and packet diagnostics. Video transport selection does not determine the talkback path.

**TTS:** tts/engines discovers configured HA engines; tts/start creates a connection-owned subscription with station_id, engine_id, language and message (1–500 characters). The states include generating, speaking, completed and closed. Use media_settings.tts_engine_id, tts_language and tts_phrases for the camera composer and vertically stacked quick buttons. A completed software state still does not prove audible sound at the station. TTS and microphone may contend for the same station.

## 9. Authorization, errors, cache and operations

WisKey's HA-user panel policy uses five areas: overview, users, events, stations, management. Each level is none, view or manage. HA admins bypass those grants; authorization/settings_update itself is admin-only. The backend must check commands and not infer authorization from the VMS UI. There is no per-station/per-door HA-user panel grant yet. If VMS needs one, implement it server-side before promising door-scoped restrictions.

Handle these error classes distinctly: unauthorized (clear/hide private view), invalid_fields (correct request), api_incompatible (disable write and update connector), revision_conflict/review_stale (refetch and show new diff), station_offline/station_unloaded/device_unavailable (keep pending and retry only safe reads), device_busy/rate_limited/audio_busy (back off), release_unconfirmed/panel_operation_unconfirmed (show unknown, inspect state; never blind retry). Log command name, opaque IDs, actor, correlation ID, outcome and timing, never PIN/card/full phone/HA token/RTSP URL/photo.

On refresh: debounce, refetch overview and currently visible records, preserve the user's unsaved editor draft separately. On access_revoked, logout or auth change: close media, cancel subscriptions and pending writes, wipe person/photo caches, then reconnect only after a new permitted session. A disabled station should remain visible as offline where authorized; do not relabel every person as disconnected.

## 10. Visual parity rules

- Hebrew RTL by default; isolate phone numbers, IDs, timestamps and other LTR strings. Phone is one line.
- Use responsive top navigation and a compact mobile layout. Keep keyboard focus visible and controls at touch size.
- Camera preview preserves the image aspect ratio (contain); person portrait crops inside a fixed box (cover) with no scrollbar.
- A person detail view shows identity and effective doors without a nested horizontal scroll. For many doors use an explicit expansion or paging, not hidden clipping.
- In the camera, place listen/microphone/unlock/fullscreen below video and a small refresh nearby. TTS phrases are full-width vertical buttons; typed composer stays usable. Keep the video/media element mounted during status updates.
- Display “pending”, “synced”, “conflict”, “offline”, “confirmed” according to actual source fields, never inferred from a successful save.
- Preserve all existing WisKey functions when reproducing a screen; do not replace working controls with static visual placeholders.

For pixel-level matching, use current frontend components and CSS as the source of truth, then capture browser snapshots at 390×844, 768×1024, 1440×900 and 1920×1080 in light and dark. Compare overview, people list/detail/editor, station tabs, events, management, camera and error/empty states. The VMS add-on's ingress container may impose a different viewport and safe-area padding; test there as well.

## 11. Proposed implementation order for Claude

1. Create a backend-only HA WebSocket adapter and a read-only VMS health probe: authorization/session → overview → subscribe. Verify the actual SUPERVISOR_TOKEN identity and permissions rather than guessing.
2. Implement typed projections for stations, people, events, profile/group definitions, sync states and named physical relays. Add pagination, cache invalidation and reconnect tests.
3. Reproduce the five navigation screens read-only, with the current WisKey 04 light/dark visual system and responsive snapshots.
4. Implement the VMS operator permission layer. Expose writes one workflow at a time: door release; person edit/sync; groups; schedules; public codes; WhatsApp. Add explicit review and revision handling for each.
5. Build media separately: HA camera playback first, then call signalling, listen/microphone and TTS. Test actual ingress auth/origin and physical audio/video, not only mocks.
6. Run parity tests against current WisKey screens for 1, 4, 8 and 12 stations, plus larger fleets through paging. Verify role denial, stale revisions, disconnect, busy states and partial sync.
7. Only after parity, decide whether to extract shared WisKey UI components or formalize a new versioned VMS API. Until then this guide describes the existing panel surface.

**Completion criteria:** a VMS operator can see the same authorized information and perform each explicitly enabled operation with the same resulting WisKey state, error handling and audit trail. UI similarity alone is insufficient; a successful API result alone is not proof of physical action.

## 12. Source index and companion documents

- [Existing English VMS/API handoff](WISKEY_VMS_HANDOFF.md): architecture, storage and key command recipes.
- [Full source-derived management command catalog](WISKEY_VMS_PANEL_COMMANDS.json): all registered command names and required top-level fields.
- [WebSocket registry, dispatch and projections](../../custom_components/hikvision_intercom/websocket.py), [contract](../../custom_components/hikvision_intercom/api_contract.py), [permissions](../../custom_components/hikvision_intercom/panel_permissions.py).
- [Frontend shell and screen router](../../frontend/src/panel.ts), [frontend data types](../../frontend/src/types.ts), [WisKey 04 style](../../frontend/src/wiskey-v4-styles.ts), [Hebrew strings](../../frontend/src/i18n.ts).
- [MSE bridge](../../custom_components/hikvision_intercom/mse_api.py), [RTC bridge](../../custom_components/hikvision_intercom/rtc_api.py), [audio RPC](../../custom_components/hikvision_intercom/audio_api.py), [TTS RPC](../../custom_components/hikvision_intercom/audio_tts.py).
- [Event retention and query](../../custom_components/hikvision_intercom/events.py), [safe user projection](../../custom_components/hikvision_intercom/access/models.py), [shared media settings](../../custom_components/hikvision_intercom/media_settings.py).

## Visit operations extension

See [Visit operations API](VISIT_OPERATIONS_API.md) for reusable visit presets, temporary cancellation with reason, revision-aware station status, authorization, storage and failure handling. Regenerate the source-derived catalog with `python -m tools.generate_panel_catalog` after adding a command or changing the version. Its consistency is checked by the test suite.
