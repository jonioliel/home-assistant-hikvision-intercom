# WisKey delegation v0.2 — proposed, not implemented

This document specifies design obligations and draft transport envelopes for joint review. It is not an API exported by rc.37. Names below are provisional and must be published with implementation-backed schemas before integration activation. No Arx deployment should probe or import WisKey private handlers.

## 1. Trust boundary and registration

Arx add-on authenticates to `smplwise_bridge` under Arx's signed-request protocol. Bridge verifies canonical HMAC, freshness, nonce and post-start timestamp, resolves the trusted operator, and rejects inactive/system users. Signature alone does not authorize WisKey actions. The browser must not nominate the HA user ID. Supervisor headers are accepted only through the verified proxy; remote routes strip them.

Inside HA Core, WisKey exposes a public integration API obtained by the registered bridge. WisKey administrator approves the pair `(domain="smplwise_bridge", entry_id=<installed entry>)`, read-only grant and transport version. Approval is stored in a versioned WisKey-owned record, distinct from a transient in-process capability. Reinstall/new entry ID requires approval. Bridge unload/removal, administrator disable and restart invalidate live capabilities/sessions. Stored approval may permit re-registration after restart, never session resurrection.

Domain/entry ID are bindings, not cryptographic proof that Python code is trustworthy: installed HA integrations run in the same process. This design trusts the installed bridge implementation and its provenance, not arbitrary code already controlling HA Core. Expose no HTTP generic proxy to these capabilities.

Registration returns selected protocol version, registered client ID, permitted command names, features and effective bounds. Unsupported major version fails closed. Capability object stays in HA Core and is never serialized to the add-on/browser or logged. Registration failures have no implicit fallback to admin identity.

## 2. Shared command execution

Refactor WisKey's policy path into a transport-independent executor, with a separate delegated session adapter. Required parity: validation of command/API version/payload byte bounds, current HA user, WisKey grants/station/field scopes, rate limit, PanelSecurity state, dispatch, result redaction and audit. Share existing policy code; do not approximate guards in the bridge. Do not fabricate `ActiveConnection`, call `_dispatch` directly or patch HA's websocket registry.

A transport session supplies explicit result/error/event sinks and cleanup registration. Audio/TTS/capture identity checks remain on existing transports until individually refactored. Recheck grants on every request and event delivery. Pending-read results are rechecked before delivery if permissions changed while work was running.

## 3. Draft session lifecycle

Conceptual interface: `register → open_session → call/subscribe → close_session`. Function names are placeholders; no current signatures are promised.

Open input (bounded JSON strings, no tokens/passwords):

```json
{"protocol":"wiskey-delegation/0.2-draft","user_id":"verified-ha-user-id","via_actor":"arx:ingress","via_session":"opaque-session-reference","via_request":"request-reference"}
```

WisKey obtains installation identity from the approved capability, reloads HA user, rejects missing/inactive/system users and creates independent security state. Fresh sessions honor configured idle locking. Output concept:

```json
{"session_id":"opaque-server-reference","protocol":"wiskey-delegation/0.2-draft","authorization":{},"limits":{},"expires_at":"UTC timestamp"}
```

`authorization` must use the actual published `authorization/session` schema; `{}` is a placeholder, not its schema. Session ID alone confers no authority outside its capability/installation binding. IDs must not reveal tokens, usernames or session secrets. One delegation per Arx login is the candidate policy. Never reuse it across actors, installation entries or logins. Maximum lifetime/inactivity renewal rules remain a joint decision; security activity and transport keepalive are separate.

States: open-locked, open-unlocked, closing, closed. Close is idempotent. Reasons include logout, role_changed, revoked, user_disabled, bridge_unloaded, wiskey_disabled, restart, expired and transport_lost. Reject new calls once closing; cancel pending reads/subscriptions and bounded event queues, invalidate proof challenges and clean owned work. Do not keep sessions alive after add-on/bridge transport loss. Publish the heartbeat timeout before release.

WisKey checks live user/policy on each call and permission change. Arx pushes close on its own revocations; its reported ~1 second and HA detection ≤60 seconds need tests. Lack of Ingress logout notification remains a known limitation; heartbeat cannot by itself detect HA logout. Do not advertise immediate universal logout revocation without a validated signal/token binding.

## 4. Draft request, result and errors

```json
{"request_id":"r-123","command":"stations/list","params":{}}
```

The integration session is supplied through the bound API, never as an arbitrary caller actor parameter. IDs are unique within session until terminal completion. Validate the real command request schema; do not blindly merge params into a HA WS envelope. Draft result:

```json
{"request_id":"r-123","ok":true,"result":[],"context_id":"ha-context-id"}
```

```json
{"request_id":"r-123","ok":false,"error":{"code":"not_authorized","message":"Access denied"},"context_id":"ha-context-id"}
```

`result` uses the complete per-command schema, still pending. Actual WisKey command error codes must be preserved from that schema. Proposed transport-specific failures: unapproved_client, protocol_unsupported, invalid_session, session_closed, user_unavailable, command_not_delegated, payload_too_large, too_many_inflight, subscription_limit, transport_backpressure. These names are proposals, not additional rc.37 error codes. Export sanitized messages, never secrets or traces.

Error contract will classify action required, retry policy and outcome certainty per command. No automatic replay after disconnect. Reads may be refetched after restoring identity and authorization. A timed-out/cancelled write has unknown outcome unless execution is provably unstarted or authoritative readback confirms it; do not label transport cancellation as rollback. Current first phase admits no writes.

## 5. Initial command scope and schemas

Candidate allowlist: `authorization/session`, `overview/summary`, `stations/list`, `users/query`, `users/get`, `events/list`, and `subscribe` only with the transport below. Each still requires its normal user permission/security checks. Scope is an allowlist, not an area grant. No `security/touch` on this initial list; introduce an explicit reviewed activity mechanism if needed, preserving the existing rule that activity cannot unlock.

Deny everything else initially, including reauth commands, authorization settings, backups, platform, jobs, CSV/import/bulk, audit export, unrestricted support and media/audio/TTS/capture. Reauth proof uses a dedicated WisKey flow, not delegated password forwarding. Existing WS availability does not imply delegation availability.

Before activation deliver full nested request/result/event/error schemas for these commands, nullability/enums/placeholders/redacted_fields, pagination/revisions and positive/negative tests. Static AST catalogs do not meet this gate. A minimal personal-free background projection (D-006) is a separate proposed endpoint, not inferred from `overview/summary`.

## 6. Subscription transport

`subscribe` opens a retained subscription with its own `subscription_id`; acceptance is separate from subsequent events. Conceptual API provides explicit `unsubscribe(subscription_id)` and all session-close cleanup. Every delivery is associated with the bound real user and validated under current scopes. Draft event envelope:

```json
{"subscription_id":"s-1","sequence":7,"event":{"type":"refresh"}}
```

Sequence is session-local ordering only, with no replay/cursor guarantee. `event` must follow the actual published event catalog/schema. Existing refresh has no data/topics; Arx debounces and refetches the active projection. Proposed topics/station IDs are P2, not silently added here. Existing access_revoked/screen_locked events prompt UI close/lock and lease revocation; verify their exact existing payloads in schema work before writing fixtures.

Use bounded queues and subscription counts. Coalesce equivalent refresh notifications. When a consumer cannot keep up, close the affected subscription/session with an explicit transport error and require fresh authorized loading; never silently discard security invalidation while continuing delivery. Define per-session and installation queue byte/item limits in implementation. Session close, unsubscribe and cancellation race must each release resources once. No subscription refresh should extend an idle lock or elevation lifetime.

## 7. Idle and fresh reauthentication

Prefer a WisKey-owned same-origin proof page, purpose-bound to unlock or elevation for one delegated session. Arx asks the bridge to create a challenge; WisKey stores user, integration entry, session, purpose, creation/expiry and consumed flag. Proposed challenge lifetime: 120 seconds, subject to review. Handle in the page URL is a random correlation value, not a bearer permission; use no secret credential URL and exclude it from logs/referrers. Validate origin/CSRF and require the page's own authenticated HA identity to equal the delegated actor.

The page performs fresh supported HA credential/MFA verification within WisKey. Arx/bridge receives no password, refresh/access token or reusable proof. WisKey applies a successful one-shot proof server-side only to the bound, still-open session after rechecking user and policy. Completion notification returns status only. Wrong actor, expiry, replay, session close, permission revoke or disabled integration fails. Cached HA login alone is insufficient. Keep current elevation policy duration (currently 300 seconds) unless a separately agreed change is made. Unlock and elevation are distinct purposes; elevation must not silently bypass screen lock.

Current full panel is a workflow fallback, not a delegated proof issuer. Supported HA auth providers/MFA combinations must be specified and tested; rc.37's existing local-provider reauth is not a promise of universal provider support. No password relay and no permanent idle/reauth exemption.

## 8. Audit, disable and bounds

Actor remains the real HA user. Add registered `via=smplwise_bridge`, installation entry binding, `via_actor=arx:ingress|arx:remote`, opaque `via_session` and `via_request` correlation values (proposed max128 characters each). Do not put user-provided secrets into attribution. Carry request/context correlation through request audit, durable serialization, exports and eligible sampled denial entries. Preserve existing retention/sampling. Export migration and old record handling require fixtures. Audit fail/availability behavior must follow WisKey policy, not silently suppress identity fields.

Provide a WisKey administrator disable control per entry plus a global delegation switch, off for unapproved installations. Disabling prevents new sessions and terminates existing ones; it does not roll back a physical action already executed. Dual approval remains out of initial scope, later needs two distinct HA actors and existing requester/approver policy checks.

Candidate caps from Arx: one delegated session/login, max20 logins/user, max32 delegated sessions/installation, max4 in-flight calls/operator. Validate global in-flight/subscription/queue caps as well. A per-HA-user rate bucket must be shared with panel requests so opening more delegated sessions cannot multiply allowances. Numbers are draft ceilings, not throughput guarantees; overload produces bounded errors and never a privileged fallback. Publish TTLs, payload/queue sizes and exact limiter behavior with the implemented contract.

## 9. Gates and evidence required

1. Full schemas for seven candidate commands; allowed/denied actors, station/field scopes and last_access privacy fixtures.
2. Registration approval, wrong/new entry, disable, reload, restart and incompatible protocol.
3. Trusted identity provenance; missing/inactive/system user; browser ID spoof, invalid signature/stale timestamp/nonce replay including bridge restart (bridge tests).
4. User/permission change during request and before event delivery; station-scoped and redacted responses; denial sampling and audit/export via fields.
5. Idle initially locked; no touch/heartbeat bypass; same-user credential/MFA proof, wrong user/purpose, replay/expiry/revoke/close race; exact elevation lifetime.
6. Subscribe/unsubscribe/disconnect cleanup; bounded backpressure; event ordering and no replay; no unauthorized payload after revoke.
7. Shared limiter across panel/multiple sessions, per-user and installation caps, overload and cancellation with no duplicate writes.
8. Arx `/arx` read-only B0/B1, Ingress and Companion identity/fallback using actual device tests; record HA/add-on/bridge versions and measured revocation latencies.

Later write gate: full command-by-command schemas, permission/reauth/dual approval parity, uncertainty handling and explicitly approved physical tests. Later media gate: server-only descriptors, policy intersection, expiry/revoke, source confidentiality and actual station/relay capacity measurements.

None of these gates has been run in this delivery. Draft unanswered items: concrete public Python interface, lifecycle heartbeat/TTL/bounds, complete schemas/events/errors, supported proof providers, storage migration, per-user handler discovery and minimal background projection. These remain visible work, not inferred defaults.
