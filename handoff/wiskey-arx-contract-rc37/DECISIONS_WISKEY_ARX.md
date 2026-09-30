# Shared decision log — proposed entries, awaiting Arx agreement

## D-001 · 2026-09-30 · Operator identity

**Arx proposed:** (a+) a WisKey-owned delegated entry point through `smplwise_bridge`. **WisKey response:** technically supportable as an additive future feature, **with changes**. WisKey prefers a trusted, in-process HA Core integration API; `smplwise_bridge` must prove its caller registration and map the Arx session to a real active, non-system HA user. WisKey must reload that user and run its normal validation, authorization, station/field scopes, limiter, security guard, dispatch and audit path. Every read or write is attributed to the real HA user and marked as coming via Arx. No browser-supplied `user_id` or `actor_label` can grant access. This is the preferred long-term Ingress path.

**Available now:** (b), a separate user-authenticated HA WebSocket connection, is compatible with the existing WisKey API and correctly enforces that user's permissions. Arx's `/arx` route may already have an HA user token; verify how it is held and how reauth works. For Ingress it adds a second HA authorization flow and secure token lifecycle. A service-token connection remains suitable only for narrowly scoped read-only background functions after its actual WisKey permissions are checked; it is not a substitute for operator identity. Existing Supervisor-backed writes through Arx must not be treated as operator-attributed WisKey actions.

**Why (a+) is not a half-day patch:** `PanelSecurity.sessions` and audio/TTS ownership are keyed by an HA `ActiveConnection`-like object; captures have their own actor/session checks; subscribe registers cleanup in `connection.subscriptions`. Refactoring a shared command executor, binding sessions, handling reauth, cancel/revoke and exporting `via` in audit all require design, tests and a new WisKey release. Current `audit_actor` stores a four-field context without `via`, and denial audit has a separate bounded journal. Adding durable `via` fields changes audit serialization/export; the draft assumption “no storage change” is false.

**Decision state:** proposed, not agreed or implemented. Until implementation and site tests, use real per-user HA WebSocket for read-only prototyping and retain the iframe for privileged or reauth-dependent workflows. Do not silently disable `idle_minutes`, `reauth_sensitive` or dual approval.

## D-002 · 2026-09-30 · Native video in Arx

Arx's own go2rtc may be a reasonable implementation of the native camera wall, provided Arx checks its RBAC **and** current WisKey operator station/view scope before issuing each viewer lease. WisKey's 12 MSE and 12 RTC connection ceilings apply to its own bridges, not Arx's relay. They say nothing about the RTSP/session capacity of a Hikvision station or go2rtc deduplication. `stream_source()` returns a backend credential-bearing source only when the station advertises streaming; it is not a stable WisKey-to-Arx contract, and it must remain server-only. Prefer a separately specified backend-only media integration or authorized HA camera path. Channel 102 is not currently exposed by this method; no support or date is promised. D-002 needs site media measurements and operator-scoped authorization before it is accepted.

## D-003 · 2026-09-30 · Contract evolution

Keep the existing WisKey v1 commands and iframe contract intact. Future fields should be additive with capability discovery. Per-command full nested request/response/error schemas, delegated identity and reusable UI components would be new deliverables, not hidden assumptions in this package. Do not remove or reinterpret existing command fields without an agreed versioned migration.
