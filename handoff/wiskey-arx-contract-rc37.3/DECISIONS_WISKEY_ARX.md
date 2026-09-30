# Shared master decision log · rc37-contract.3

Updated 2026-10-01; incorporates both Arx replies dated 2026-10-01. States: `proposed / agreed / agreed-with-amendments / open / superseded`. Delivery state (`planned`, `implemented`, `verified`) is separate from decision state. Agreement on design does not mean runtime implementation.

## D-001 · Operator identity

Proposer: WisKey, 2026-09-30; amendments: Arx, reply 2026-10-01. **State: agreed-with-amendments. Delivery: delegation planned.**

Now: real per-user HA WS (b), read-only in `/arx`; retain iframe for privileged/reauth workflows and where b is unavailable, including Ingress and Companion. A locked connection receives no read-only exemption. `security/touch` never unlocks it.

Permanent Ingress target: WisKey-owned in-process delegated capability (a+), approved for the bridge domain/config entry, with real active non-system HA users, shared policy pipeline and its own session/subscription transport. No fake ActiveConnection/private dispatch. HMAC is bridge authentication, not a WisKey grant. Durable/exported `via` attribution requires additive storage changes; denial logging retains existing bounded sampling. Dual approval requires distinct real HA actors. See DELEGATION v0.2 for the unimplemented proposal.

Background service account scope and token split follow B0 and owner provisioning; strict absence of personal data is unresolved in D-006. Bridge implementation/authentication claims in Arx's reply remain Arx-reported evidence.

Arx reply 2 accepts this text and reports owner settings idle_minutes=0, reauth_sensitive=false, dual_approval=false. Not independently checked in HA. Continue handling settings changes and locked sessions. Phone priority is Arx's own app via `/arx` on (b); Companion remains iframe transition only. No separate Companion identity implementation planned. Bridge draft work starts with B0/B1 after CR-015, not before. Production activation still requires full schemas, WisKey implementation and acceptance gates.

## D-002 · Native video

Proposer: WisKey, 2026-09-30; amendments: Arx, reply 2026-10-01. **State: open. Delivery: P2 planned.**

Arx's relay uses its own budgets. Each viewer lease must intersect Arx RBAC and fresh real-operator WisKey station/view scope with unlocked security state. Without operator identity use iframe. Revoke/close when denied, locked or unable to revalidate. Server-only additive source lease/descriptor is the proposed contract; private `stream_source()` is not one. Until then Arx uses its own configured station sources, under the same operator checks.

Acceptance requires site measurements per model/firmware, proven authorization/revocation and source handling. Channel 102 has no ETA. Shared go2rtc is not agreed until one upstream pull per station is demonstrated. Polling windows must be documented and measured. No station credentials or source URLs reach browser/logs.

## D-003 · Contract evolution

Proposer: WisKey, 2026-09-30; accepted: Arx reply 2026-10-01. **State: agreed.**

Existing v1 and embed contract preserved. Additive capability discovery and explicit versioned migration for breaking changes. Full schemas, delegation and independent UI components are new deliverables. WisKey continues developing; keep one Arx adapter and a pinned contract, with unknown enums shown as unknown and unknown fields not echoed into writes. Existing EVOLUTION.md remains applicable.

## D-004 · Existing Supervisor-backed writes

Proposer: Arx, reply 2026-10-01. **State: agreed-with-amendments. Delivery: existing behavior, migration planned.**

Record the owner's instruction to retain current configured writes temporarily, default limited to Arx administrators, without adding native writes or service-account dual approval. WisKey attribution remains the service identity; operator attribution exists only in Arx audit. This is not native identity parity. Each future migration requires a complete command schema and dedicated tests. Uncertain writes are not replayed. No operational change is made by this documentation delivery.

## D-005 · Versioned delivery and contract diff

Proposer: Arx, reply 2026-10-01. **State: agreed.**

Each handoff contains version, source commit, CHANGES and generator outputs. Arx diffs added/removed commands, required keys, permissions, READ classification and errors against a pinned catalog, returning bridge version and parity. Removal or required-key change needs explicit migration review. Clean static diff never authorizes writes and does not establish nested schema equivalence. Catalogs may be copied under the repository MIT license with provenance and limitations retained.

## D-006 · Background overview without personal data

Proposer: WisKey, 2026-09-30 review of Arx reply; accepted: Arx reply 2, 2026-10-01. **State: agreed. Delivery: open P1.**

Correction to contract.1 ANSWERS 8.2: non-admin `overview:view` and denied users/events do not guarantee personal-free overview. Current station `last_access` can retain person name/employee number. Proposed solution: an explicitly specified minimal background projection in WisKey containing only approved station identity/health fields, with no last access/person/card/PIN/photo/profile/event identity. Do not silently alter existing overview semantics. Decide exact field allowlist and command/capability in schema review; no new endpoint is defined here. Arx redaction alone does not remove upstream disclosure to the background account.

Arx reply 2 clarifies current service cache/UI still contains last_access person identity (memory only, Arx-reported). Removal is planned at B0, not already delivered. B0 will exclude last_access entirely from background cache/API/UI and test logs; personal recent access will come only from operator events/list or iframe. Split write/background channels before owner provisions the non-admin account. Full personal-free status requires both WisKey projection and Arx integration. BACKGROUND_PROJECTION_DRAFT.md supplies a candidate field allowlist/schema; exact new command/capability awaits review and implementation.

## D-007 · Delegation heartbeat and session lifetime

Proposer: WisKey, 2026-10-01, responding to Arx reply 2 question 3. **State: proposed. Delivery: design only.**

Select Arx option (a) as the draft: heartbeat every20 seconds, close after60 seconds without an authenticated heartbeat, delegation never outlives its bound Arx login. No idle/elevation refresh from heartbeat. Close promptly on known logout/revoke/disable/transport loss, without waiting for timeout. Use a monotonic clock and server receipt time. Require verified live login before heartbeat; it cannot renew an already closed session. Finite absolute lifetime/session refresh behavior and total installation queue/subscription/in-flight caps remain open before activation. No universal HA logout detection is promised. See DELEGATION_V0.3_ADDENDUM.md.

## Provenance

Both Arx replies preserved in request/. Original proposals and complete runtime baseline remain in contract.1. Product disputes return to the owner; D-007 and the exact D-006 field/schema draft need Arx review. Accepted decisions D-001/D-004 retain their agreed-with-amendments state; D-002 remains open.
