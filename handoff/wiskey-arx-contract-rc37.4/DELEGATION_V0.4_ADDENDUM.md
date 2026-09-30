# Delegation v0.4 addendum — proposals, not implemented

Extends v0.2/v0.3 design; source/runtime rc.37 unchanged. Agreed D-007 heartbeat components are distinct from proposed D-008 TTL/caps. No endpoint/signature/error names here are callable.

## Lifetime and renewal

Remote /arx sessions: expiry=min(bridge-verified token_exp, WisKey-open+30min). Bridge must validate the expiry source from authenticated login, not browser input. WisKey accepts no operator token. Use monotonic expiry after converting the remaining trusted lifetime; reject already-expired or invalid expiry. Wall-clock changes must not extend an existing session.

Ingress has no reported operator token_exp: propose WisKey absolute30min and new-session identity/policy verification. Do not infer token expiry or logout detection from trusted header identity alone. Reopen requires a presently authenticated ingress actor; no reuse of a cached actor as proof. Every route also closes on earlier login revocation, known transport loss or heartbeat timeout.

Token rotation creates a new session, no TTL extension; close old at handover. Transfer no elevation/proof/subscription state. Initial security state follows current WisKey settings. Define transient session admission at rotation so32-session cap cannot be bypassed; close old first or reserve replacement slot atomically. Do not replay pending requests after handover. Outcome uncertainty remains subject to existing write gate, with no writes in phase1.

## Heartbeat delay mitigation (proposed)

Every20s heartbeat cycle: bridge creates session-bound random one-shot challenge, serial and startup epoch; expires10s after issuance under bridge monotonic clock. Add-on checks bound login exists, not revoked, expiry in future, then signs response using existing HMAC discipline with session/challenge/serial/epoch binding. Bridge accepts exactly one matching current challenge before its local deadline and advances last-authenticated receipt time. Reject stale/wrong/repeated/out-of-order/post-restart replies; invalid replies never advance lifetime. Existing60s signature window is not the heartbeat challenge lifetime. Do not allow multiple pending challenges to build an unbounded queue.

Signature and sequence alone cannot prove freshness of an unseen delayed message; one-shot short-lived bridge challenge bounds that delay. Proposed10s deadline needs latency/load validation. If unavailable, fail closed and reopen through normal authorization. Close threshold60s is enforced on call entry and cleanup, never resurrected by a late reply. Heartbeat does not detect HA logout or count as UI activity/reauth. No existing Arx protocol has been changed in this delivery.

## Initial proposed installation caps

32 delegated sessions total; 16 in-flight delegated calls total; 4 per HA actor aggregated across delegated sessions. One retained subscription/session, 32 total. Pending outgoing events per session at most32 items and64KiB; installation at most1MiB serialized event bytes. Whichever bound is first applies. Count using encoded bytes; separately bound bookkeeping/tasks so byte accounting alone does not imply bounded memory.

No unbounded pending call queue; admission refusal is explicit before execution, no fallback identity. Per-actor rate allowance shared with panel must use policy-preserving integration, not a new per-session bucket. These caps do not silently change existing panel concurrency. Request/response size limits follow full schemas/existing policy; they remain pending for publication. Queue caps apply to subscription events, not arbitrary command results.

Coalesce refresh only. Security invalidation cannot be silently dropped; on queue pressure close subscription/session and cancel owned resources, signal transport failure when possible. Oversized event fails closed. Resource accounting releases exactly once on completion/cancel/close; no subscription/work survives closed session. Final numeric bounds require implementation and load tests before activation. Test cross-user fairness, malicious slow consumer, reconnect/rotation at cap, panel+delegation limiter parity and cleanup.

## Background schema amendment

Operational station-name description added; exact minimal fields accepted by Arx. No call_state yet: consider optional additive field after live B0 and exact enum/event schema review. model/firmware stay out, pending separate technical-health contract. Names can carry personal content; site's operational-label policy is necessary for personal-free semantics.

Remaining gates: full seven-command schemas, D-006 request/error/name/capability, shared executor, proof/audit migration, defined handlers, anti-delay protocol review, resource/TTL test evidence and actual deployments. None run here.
