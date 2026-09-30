# Answers to Arx section 10 — rc.37 and proposed work

Status vocabulary: **CURRENT** = confirmed in the inspected rc.37 source; **PROPOSED** = possible future additive implementation, not callable yet; **UNVERIFIED** = needs HA/site/runtime evidence. `DECISIONS_WISKEY_ARX.md` is the short answer to 1.1.

## A. Identity and delegation

**1.1** WisKey supports (b) **CURRENT** through ordinary HA user-authenticated WebSocket. We prefer (a+) **PROPOSED with changes** for Arx Ingress long term: WisKey-owned, approved in-process bridge capability that reloads the real HA user and shares the command pipeline. No `act-as` API currently exists. Until it is implemented and accepted, use (b) for operator read-only work and the existing panel for privileged workflows.

**1.2** Prefer in-process HA Core registration by the installed `smplwise_bridge` integration over an admin-token WebSocket `act-as` command. An admin WS act-as endpoint creates a new impersonation surface reachable by any holder of that credential; a Python capability can be bound to a specific trusted integration lifecycle. Both require administrative approval, typed allowlist and audit. HMAC between Arx add-on and its own bridge authenticates Arx-to-bridge requests, but does not by itself authorize WisKey actions.

**1.3** **No, not in rc.37.** PanelSecurity, subscriptions and audio/TTS are connection-owned; capture also has actor/session rules. A proposed delegated session would need explicit equivalents and tests, not a fake `ActiveConnection` passed into private handlers. The first version should exclude audio/TTS/capture until proven.

**1.4** **PROPOSED first-release denylist:** `security/reauth_*`, `authorization/settings_*`, `backups/*`, `platform/*`, `jobs/*`, import/CSV/bulk, unrestricted exports/support, audio/TTS/capture/media. This is a design gate, not an rc.37 command denylist. Re-evaluate each command individually when building the new API.

**1.5** **PROPOSED:** `actor` real HA user; `via`, `via_actor`, `via_session`, `via_request` bounded correlation fields in successful and persisted denial records, list and CSV. **CURRENT:** those `via` fields do not exist; `audit_actor` and denial journal need additive schema/export work. Denials are currently sampled with a global disk budget, so a promise to persist *every* denial would also change behavior.

**1.6** **PROPOSED:** delegated sessions should obey the same configured idle setting, and Arx should report only genuine operator activity. The current `security/touch` does not unlock a locked connection; no read-only exemption exists. A delegated equivalent must be designed and tested before claiming parity.

**1.7** **No current dedicated reauth page.** Existing `security/reauth_start/step` uses HA local-provider credential flow, potentially MFA, bound to the panel connection. It requires fresh proof; token possession is insufficient. A WisKey-owned proof page bound to an opaque delegated session is possible future work; avoid passwords through Arx. Until then use the original WisKey panel for sensitive operations when `reauth_sensitive` or idle locking blocks native actions.

**1.8** **PROPOSED:** a per-HA-user limiter bucket shared between that user's panel and delegated actions prevents bypass by changing channel; also cap total delegate sessions and concurrent work. Current `AdminLimiter` uses user ID for generic WS commands, but no delegated cap is implemented. Do not promise Arx's suggested numeric caps as final without load tests.

**1.9** **PROPOSED:** administrator-managed approved delegate list and emergency disable; disable closes sessions and media and emits revocation. No setting, screen or notification exists in rc.37.

**1.10** **PROPOSED:** reject opening for absent, inactive or system user; recheck every call and subscription/media tick; close on disable/delete. Admin promotion/demotion must cause fresh policy evaluation and cache clearing. Current ordinary WebSocket checks `user.is_active` and grants at command time; any precise push timing for HA account mutation needs a test.

**1.11** Need Arx's exact HA bridge config-entry identity, HMAC request validation boundary, map from authenticated Arx session to HA user, logout/role-change signals, opaque session/request correlation IDs, command allowlist and concurrency caps. The browser may not nominate HA user ID. Two approvers must be distinct HA identities; one service account cannot supply two meaningful approvals.

**1.12** No existing WisKey operator-mapping, per-operator API key, supported `act-as`, or `hass` adapter for Arx Ingress was found in rc.37. The current HA custom panel receives `hass` only when mounted inside HA frontend.

## B. Scopes and grants

**2.1** Yes: `schemas/commands.static.json` contains a generated base matrix for all 238 generic commands, with generator included. It includes source-derived area alternatives, admin-only base classification, station/field-restricted surfaces and READ-command classification. Runtime nested/target guards remain outside this static table, so the table is not an authorization oracle.

**2.2** The source is ahead of the older scope document. Stored panel policy schema 3 supports up to 12 per-profile-field level overrides and up to 64 named station groups. Full rules in `SCOPES.md`. This package corrects the old category-only description; no rc.37 behavior changed.

**2.3** Exact key placeholders are tabulated in `SCOPES.md`. They deliberately resemble empty values, so use `redacted_fields` plus `authorization/session.fields/profile_fields` to distinguish hidden from genuinely empty. `redacted_fields` does not enumerate each omitted custom field.

**2.4** Read `operator_editable` on restricted person projections. `false` may mean shared/out-of-scope or other non-editable state. Server still rechecks on mutation and may return `person_scope_shared`.

**2.5** Source-derived dual-approval trigger list is in `SCOPES.md`. The reviewer permission, expiry and state machine vary by workflow; there is no single universal reviewer rule. For meaningful Arx approval each side must be a distinct real HA user.

**2.6** `permissions_changed` can occur after a write inside `_dispatch_inner`; the response may be an error even if state changed. Refetch the object/revision or durable receipt. Unlock has no physical receipt; never auto-retry after unknown outcome.

## C. Commands

**3.1** A full nested request-and-response JSON Schema for every command is **not yet available**. `commands.static.json` is an executable static extraction of the 238 top-level registrations, with permission metadata and explicit incompleteness markers. Claiming that it is complete would contradict nested validators and the separate media handlers. A complete schema build is a separate, test-backed WisKey development task and should be prioritized P1 before Arx migrates sensitive writes.

**3.2** `schemas/errors.static.json` lists 301 literal exception codes and source locations. It cannot safely map every code to each command or promise retry behavior; dynamic codes and transport errors also exist. Conservative rule: retry only a fresh read, never replay a mutation after missing response without an authoritative receipt/state check.

**3.3** Reads and current-state projections can be reissued after reconnect; a stable `snapshot` supports paged `users/query`, not generic mutation idempotency. Some jobs/bulk flows have their own durable operation IDs/receipts, but there is no global idempotency key across all commands. Treat unlock, person/card writes, capture, WhatsApp and media signals as unsafe to auto-retry.

**3.4** `DATA_MODEL.md` gives the allowed `USER_FIELDS`, default `sync_now=true`, core person/card/assignment types, UTC validity and profile/group constraints. A complete nested `access_timing_policy`/assignment JSON Schema remains a P1 gap, explicitly unverified in this handoff.

**3.5** `stations/test_unlock` resolves with `null` after `runtime.async_unlock` returns. It is not physical readback and no command-specific success event proves relay movement. Offline and selected release error codes are listed in `DATA_MODEL.md`.

**3.6** Assignment `sync_state` is `synced|pending|syncing|offline|conflict|error|delete_pending`. Compare `desired_revision` and `applied_revision`, then read the per-station evidence; none alone proves that a door physically opened. Site acceptance is separate.

**3.7** Use `overview/summary` for frequently refreshed station dashboard; it avoids serializing the users array, returns `users_complete=false`, and retains a scoped count. Use `users/query` for people. No 12-station/2000-person byte or latency benchmark was run; Arx must measure.

**3.8** `overview.api.commands` is built from the generic 238-command registry; `subscribe`, `audio/*` and `tts/*` are separate handlers and are absent from that array. `subscribe` requires overview access. Audio/TTS require overview or stations **manage** plus station scope and open security state; use `tts/engines` and a controlled prototype to detect availability, not a generic command-list assumption. A future capability list for separate handlers would help Arx, but is not rc.37.

**3.9** `events/list` filters, sort, `before` cursor, 1..200 limit and `{records,next,retention_days,capacity}` response are documented in `DATA_MODEL.md`. A missing/pruned `before` cursor fails; there is no durable cross-retention gap detector. Refetch retained rows after reconnect and show completeness as unknown when the gap may exceed retention.

**3.10** Current capture is a request/status workflow; `capture_status` is polled, not a dedicated `subscribe` capture event. A future delegated session must preserve the HA actor binding and session cleanup before capture is enabled.

## D. Events

**4.1** `subscribe` sends only data-free `refresh`, `access_revoked`, `screen_locked`. Audio subscription sends `ready` and `closed`; TTS sends `generating`, `speaking`, `completed` or `closed`. Exact payloads are in `SCOPES.md`/`AUDIO.md`. Direct `SIGNAL_ACCESS_CHANGED` sends occur in access runtime, event manager and clock runtime; repository callbacks also propagate many writes. There is no per-topic source list in the payload today.

**4.2** `topics`/`station_ids` are not implemented. They could be additive, but before committing to them WisKey needs an exhaustive source-to-topic inventory and permission-filtered tests. For rc.37 debounce and refetch only the active screen projection.

**4.3** A ringing state appears in `overview.stations[].call_state` after the event/poll path raises refresh. No bounded notification latency SLA is declared. Arx should time actual doorbell-to-UI latency at the site.

## E. Video

**5.1** Backend `IntercomCamera.stream_source()` currently returns channel-101 credential-bearing RTSP when streaming is enabled. It is an HA camera method, not a frozen WisKey external API. A supported Arx backend-only stream lease/descriptor would require a new additive contract; never send source credentials to the browser.

**5.2** Channel 102 is not exposed by current `stream_source()`; no delivery date is committed. Its prior 401/access and codec behavior require site testing before an API is designed.

**5.3** No per-model Hikvision RTSP concurrency number is verified. Measure station firmware, concurrent pulls, failures and recovery at the facility.

**5.4** WisKey has an explicit `go2rtc_url` media setting and can contact a configured Arx go2rtc if HA can reach it. This does not prove one upstream RTSP pull or shared stream naming. Benchmark and inspect upstream sessions before adopting a shared provider.

**5.5** rc.37 MSE and RTC bridges each cap active sockets at 12 per HA instance. Arx's own relay does not consume these bridge slots. Keep Arx's budget and operator lease policy separate; station and go2rtc limits still apply.

**5.6** The client caches successful snapshot bytes for 2 seconds per station client. No published station-safe polling-rate guarantee exists; Arx should use its own controlled budget and measure device load.

## F. Audio and calls

**6.1** `AUDIO.md` describes current subscription events, 180-second maximum, 12-second idle, global/station/connection caps and TTS states. The requested `audio/stop` command is **not registered** in rc.37; unsubscribe/cancel the start subscription.

**6.2** G.711 µ-law at 8 kHz: internal 160-byte/20 ms frames, exposed 800-byte/100 ms packets, 1068-character base64 on send. PTT/toggle is UI control, not a different codec. Do not promise full duplex on every device from software inspection.

**6.3** Two-operator simultaneous answer behavior depends on call/station state and timing; no universal winner guarantee is documented. Run a physical concurrency test. Audio+TTS contention is separately enforced as described.

**6.4** Human at the station confirms both listen and talkback with timestamp, model/firmware, browser/device and software counters; packet writes, HTTP 200 and `physical_result:"unverified"` are insufficient alone.

## G. UI components

**7.1** No versioned web-component package or release date is approved. Current frontend source and compiled panel are available; `panel.js` needs HA `hass` and is not an Arx component bundle. `ADAPTER.md` gives a read-only integration code sample and extraction gates.

**7.2** Overview cards, person detail, events and station cards are the first candidates if data calls and navigation are abstracted. Door confirmation and capture need authorization/session workflow hooks. Live camera and audio/TTS controls need media/HA auth hooks; they are not ready without `auth/sign_path`, camera/stream or an equivalent provider.

**7.3** `mediaProvider` and `wiskey-navigate` are reasonable proposals, not current APIs. Their event/element contracts must be versioned and tested before Arx imports a component.

**7.4** No stable public list of CSS override tokens is published in rc.37. Use Arx-native styling or pin an extracted component bundle to a release; don't depend on private selector names.

## H. Acceptance and delivery

**8.1** For a future delegated API, test inactive/system user rejection, approval toggle, read/write grant and field/station projections, idle/reauth, limiter, revision race, `permissions_changed` after commit, cancellation/restart, actor/via audit and export, second approver identity, subscription/audio/capture isolation. None of these delegation tests ran because the feature does not exist. Physical release, 10 video streams and acoustic audio require owner site equipment.

**8.2** Yes, prefer a dedicated non-admin HA account for background discovery, granting only the minimum WisKey overview/station **view** areas needed and no users/events/manage areas; verify `authorization/session` and actual returned projection. `subscribe` needs overview access. It should never mediate operator writes or private person data.

**8.3** This **documentation** package is `rc37-contract.1`, dated 2026-09-30. It includes source-derived static catalogs, detailed known contract notes, decisions, gaps and read-only adapter code. It is not a WisKey runtime release. Delegation, full 238 nested response schemas, topical refresh and component package are deferred; no release date is responsibly committed before joint design and tests.

**8.4** Arx also needs to know: the origin/auth model for Companion, whether its existing bridge ever handles HA operator credentials, exact Ingress vs `/arx` routing, chosen media viewer lease/revocation design, and how it will keep Arx screens in step as WisKey adds commands and fields. The discovery and contract-diff rule in `README.md` is intended to keep future WisKey development easy to integrate.
