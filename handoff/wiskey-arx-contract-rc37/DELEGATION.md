# Proposed delegated identity API — NOT IMPLEMENTED in rc.37

This is a design response, **not** callable Python. WisKey's current WebSocket command dispatcher uses `connection.user`, `PanelSecurity.sessions[connection]`, `connection.subscriptions`, `send_result/send_error/send_event`, and the audio/TTS bridges' `connection is` ownership. Calling `_dispatch(hass, ..., actor=...)` directly is unsafe: it bypasses transport-level authorization, schema checks, limiter and security. Arx must not import private WisKey functions or call through `hass.data["websocket_api"]`.

## Proposed public lifecycle for a future WisKey release

1. WisKey registers a named in-process capability for the installed `smplwise_bridge` integration/config entry. A WisKey administrator explicitly approves it. Registration survives restart by a **versioned WisKey-owned configuration record**; the live capability object does not.
2. Arx's HA Core bridge opens a session with its server-verified HA `user_id`, opaque Arx session reference and bounded `via_actor` label. WisKey reloads `hass.auth`'s user, checks active and non-system status, and snapshots no permanent grant. Every call re-checks live user status and WisKey policy.
3. WisKey executes through a refactored shared command pipeline: command allowlist → identity/grants → schema → API version → byte bound → limiter → security guard → dispatch → safe result/error → audit. The new transport must implement request/event subscription and cleanup semantics rather than impersonating an internal HA WebSocket object.
4. Closing Arx's session, HA restart, bridge unload, integration removal, WisKey upgrade, administrator disable, user disable/deletion or permission revoke cancels subscription/media/capture work and invalidates all outstanding request handles. Pending writes have **unknown outcome** until checked against authoritative WisKey state; no automatic replay.
5. Session caps, TTLs, exact exception names, approval UI, grant storage and command allowlist require implementation review and tests. Arx's proposed `async_register/async_open/async_call` signatures and error names are not yet a contract.

## Reauth and idle — design gate

Current defaults are `idle_minutes=0`, `reauth_sensitive=false`, `dual_approval=false`. When configured, the real panel creates a **connection-bound** security state and initially locks if idle locking is enabled. `security/touch` updates activity only while unlocked. Fresh elevation requires the HA local `homeassistant` provider credential flow, may include MFA, and lasts 300 seconds; a cached HA token is explicitly insufficient. A delegated connection cannot simply send `security/touch` or pretend a successful HA login. The proposed `?reauth=<handle>` page does not exist. Until a WisKey-owned proof flow binds a fresh credential check to the delegated session, commands gated by `screen_locked` or `reauth_required` must remain unavailable through delegation; Arx may route the operator to the existing WisKey panel for those workflows. If the facility enables these settings, this is a release-blocking dependency for full native parity.

## Audit and dual approval — design gate

Minimum proposed attribution: `actor` = real HA user ID; `via` = registered integration identifier (`smplwise_bridge`); `via_actor`, `via_session`, `via_request` = bounded non-secret correlation strings. Validate lengths and strip secrets; retain these fields in the same audit, export and retention mechanisms as native actions, including denials where persistence is permitted. This **requires an additive audit schema/export change**. Do not claim the current audit already records them. Dual approval must keep distinct HA identities for requester and approver; a shared `via` is acceptable only if actor IDs differ and all existing policy checks still run. A service account cannot sign both sides on behalf of operators.

## Preliminary denylist for the first delegated release

Until reviewed individually, deny `security/reauth_*`, `authorization/settings_*`, `backups/*`, `platform/*`, `jobs/*`, CSV/import/bulk operations, audit export, unrestricted support bundles, and media/audio/capture flows. This is a **proposal**, not a statement about current WebSocket availability. Start with read-only `authorization/session`, `overview/summary`, `stations/list`, `users/query` and `events/list` as allowed by the real user. Admit writes and connection-bound workflows only after dedicated tests and a published contract. Existing per-user WebSocket route (b) retains current command availability and policy.
