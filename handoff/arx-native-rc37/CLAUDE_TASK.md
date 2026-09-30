# Claude implementation brief — native WisKey experience in Arx

You are implementing Arx, installed both as a Home Assistant add-on and as an HA integration. It already has a working HA communication bridge. Replace its WisKey iframe with a first-class Arx experience. **Inspect and reuse the existing Arx bridge and integration; do not create a duplicate connector by default.** WisKey remains installed as the separate Home Assistant integration and is the sole authority for managed access data and station commands. The current reference is WisKey `2.0.0-rc.37` and its additive panel WebSocket API contract v1. Read `START_HERE_HE.md`, `ACCEPTANCE_HE.md`, `docs/integrations/SMPLWISE_VMS_ADDON_IMPLEMENTATION_GUIDE.md`, and the source-derived command catalog before editing Arx.

## 0. Inspect Arx before selecting a transport

Report: frontend framework/router; backend language; add-on and integration responsibilities; existing bridge transport and credential; whether Ingress is enabled; current HA and Arx public/internal origins; existing user/session model; camera pipeline; mobile/Companion entry point; current iframe route. Trace one existing Arx request from the authenticated browser, through the add-on or integration, into HA, and determine the actual HA actor seen by WisKey. Record the actual DNS name, reachable HA endpoint, TLS trust, and origin behavior from inside the Arx container. Avoid fixed container IPs, Docker socket access and `host.docker.internal` assumptions.

Do not modify WisKey contract v1 or data storage for this migration without a separate reviewed proposal. Keep the current iframe as a rollback path while new screens are built, then remove it from the default user flow only after parity is proven.

## 1. Architecture and identity gate

Target boundaries:

```text
Arx browser UI ── Arx authenticated API / operator session ── HA WebSocket adapter ── WisKey integration ── intercoms
Arx media viewer ── authorized HA media path or Arx media adapter ── HA/WisKey media service
```

Arx already has an HA bridge: extend its existing authenticated request path where suitable. A backend HA add-on can use `homeassistant_api: true`, `ws://supervisor/core/websocket`, and `SUPERVISOR_TOKEN` as described in official HA docs; verify what Arx actually does. The token must stay in the backend. Ingress request headers may identify the HA user visiting Arx, but they do **not** make a backend WebSocket call run as that user. A single service connection causes WisKey permissions and audit to apply to that service identity. Therefore implement read-only discovery first and **do not expose sensitive writes, person data beyond the authorized operator scope, door release, or media to operators merely because Arx knows their name**. A service connector can be used only for explicitly scoped site services with an Arx server policy and documented service-account attribution; it is not per-operator parity.

First inspect whether Arx's existing HA integration registers a custom panel or mounts frontend elements in the HA frontend. If so, prototype a WisKey component inside that host using the real HA-provided `hass`; verify that `hass.user`, `callWS`, subscriptions and media carry the actual operator's identity and grants. A panel registered by the Arx integration does not imply that its separate Ingress page has `hass`.

If Arx serves its UI only through Ingress, assess an HA authorization-code flow per operator, with each operator's HA access token held in a secure backend session and used for that operator's HA WebSocket connection. Validate redirect/client identity, state, refresh, revocation, logout and HA user binding. Never put refresh tokens in JavaScript, localStorage, URLs or logs. Verify the connection's `authorization/session` and `overview.access` for the same actual HA account. If neither route is feasible, propose an explicit server-side delegated-identity design for WisKey before implementing writes; never forge `actor` fields or trust browser-supplied user IDs.

Use a backend-for-frontend with explicit Arx endpoints and an allowlist of operations, unless native HA panel hosting makes direct operator-authenticated `hass.callWS` practical. The browser must never receive `SUPERVISOR_TOKEN`, a service token, a generic HA WebSocket proxy, raw RTSP credentials or WisKey session tokens. Validate each Arx request against the current Arx session and the corresponding WisKey grant. On revoke/logout/identity change: close WebSocket and media sessions, cancel pending work and erase private caches.

## 2. WisKey API handshake

Authenticate to HA's `/api/websocket` using the selected credential. Send monotonically increasing integer request IDs:

```json
{"id":1,"type":"hikvision_intercom/authorization/session"}
{"id":2,"type":"hikvision_intercom/overview"}
{"id":3,"type":"hikvision_intercom/subscribe"}
```

Require `session.allowed`, the appropriate `session.areas`, `overview.access`, and an API version compatible with `overview.api.version` / `min_client`. Check `overview.api.commands` and capabilities before enabling a feature. `subscribe` events can include `refresh` and `access_revoked`. On reconnect, repeat auth/session/overview/subscription, reject stale in-flight responses and refetch only active projections. Do not interpret a transport reconnect as permission continuity. Most writes send `api_contract:1`, current revision and an explicit reviewed payload; use the source command schema for each operation.

Do not mirror every command through an unrestricted `/api/wiskey/call` endpoint. Build typed, narrowly scoped Arx operations and tests. Keep person directory paging server-side (`users/query`; snapshot/next_offset/stale semantics) and fetch detail only when needed. Existing plain PIN and full card numbers are intentionally absent from ordinary projections. Respect field and station scopes. WisKey owns the difference between saved intent, pending station sync, verified readback and physical operation.

## 3. Screen and workflow parity

Use `frontend/src/panel.ts`, `frontend/src/types.ts`, `frontend/src/wiskey-v4-styles.ts`, and `frontend/src/i18n.ts` as the current visual/behavior reference. The user should navigate WisKey capabilities inside Arx's own shell without an iframe, duplicate toolbar, nested page scrollbar or lost back/forward state. Implement in bounded slices:

1. Connection/status, overview, station cards, current user grants, live invalidation. Read-only UI first.
2. Camera wall and one-camera dialog using an authorized media route. Preserve aspect ratio, explicit stream budget, cleanup on navigation/background and responsive 390-pixel layout.
3. People directory, person detail, events/investigation, station/door views, management navigation. Use server paging and permission-filtered data.
4. Writes one workflow at a time: explicit door/relay selection and confirmation; person create/edit/revision conflict/sync; cards/PIN; groups/door schedules; public codes; guest/contractor approval; settings. Each workflow must match WisKey server authorization, validation, revision, review, audit and failure semantics. Do not replace a working workflow with a static mock.
5. Call signalling, receive audio, microphone, TTS and mobile lifecycle as separate media work. A camera image or successful HTTP response is not proof that talkback works.

The full screen and command mapping is in `SMPLWISE_VMS_ADDON_IMPLEMENTATION_GUIDE.md` sections 5–9. It uses the older product label “VMS”; treat that as Arx. The technical namespace remains `hikvision_intercom`.

For a faster path, assess extraction of WisKey frontend components as a versioned web-component package. This is viable only if Arx supplies an authenticated `hass`-compatible host adapter or runs inside the HA frontend, and proves mount/unmount, updates, routing, CSS isolation, permissions and media lifecycle. Importing compiled `panel.js` into an ordinary ingress page is not a supported adapter. Provide a short measured recommendation on reuse vs native rendering after the first prototype.

## 4. Media plan

Prototype a single authorized live camera in the *actual* Arx runtime before cloning the wall. `overview.stations[].entities.camera` identifies the HA camera entity; HA camera/HLS and WisKey's authenticated MSE/RTC bridges have different authorization and session behavior. MSE and RTC URLs and signalling are panel-specific, not public RTSP feeds. A Docker-local network path does not grant browser access to HA or preserve the user's identity. If needed, design a narrow Arx media proxy with per-operator checks, origin policy, stream/session limits and shutdown; never expose backend credentials or reusable unscoped URLs. Current rc.37 MSE and RTC ceilings are separately 12; 10 actual streams require site tests, and a 429 above the limit needs an explicit still/upgrade UI rather than an unhandled error.

Audio workflows are connection-bound and distinct from video: `audio/start`, `send`, `receive`, `mute`, `stop`, diagnostics; call signalling and TTS have their own sessions. Reuse the reference source only after reading its lifecycle. Require a user gesture for microphone, obey browser permission, stop on close/background/revocation, and test audible output at a physical station. Test Companion on an actual phone; desktop emulation is insufficient.

## 5. Delivery order and gates

**Gate A — discovery:** show deployment classification, reachable HA endpoint and actual operator identity. If identity is unresolved, stop at read-only prototype and submit the design gap. Do not silently degrade to privileged service actions.

**Gate B — connected slice:** one station overview and one camera in Arx, no iframe; auth/session/overview/subscribe; reconnect and revoke behavior; both desktop and phone screenshots. Include error and empty states.

**Gate C — scalable UI:** responsive overview and 10–12-camera wall; person/events/stations read-only parity; no duplicate navigation or double scrolling. Benchmark with 1, 4, 8, 12 and synthetic larger fleets.

**Gate D — mutations:** implement each workflow only after user attribution and authorization are proven. Verify denied role, stale revision, lost response, offline station and partial sync. Never auto-retry a door release after uncertain transport outcome.

**Gate E — media and field proof:** 10 simultaneous *live* site streams, physical unlock, listen/talkback and mobile Companion tests, documented by device/firmware/browser and timestamps. Mock/browser tests remain separate evidence.

For every gate return: changed-file list, exact Arx commit, WisKey version, setup/config changes, tests that actually ran, screenshots, known gaps and rollback steps. Keep Arx UI deployable independently of WisKey update when command discovery says the installed version is compatible.

## 6. Official platform references

- HA app/backend communication and Supervisor proxy: https://developers.home-assistant.io/docs/apps/communication/
- HA Ingress and app presentation: https://developers.home-assistant.io/docs/apps/presentation/
- HA Ingress user headers: https://developers.home-assistant.io/docs/apps/security/
- HA user authorization flow and token handling: https://developers.home-assistant.io/docs/auth_api/
- HA WebSocket envelopes: https://developers.home-assistant.io/docs/api/websocket/
- HA custom panel `hass` property: https://developers.home-assistant.io/docs/frontend/custom-ui/creating-custom-panels/

Do not assume that any external deployment fact in this brief has been proven for the user's Arx container. Inspect and verify it there.
