# Personal access renewal — additive VMS API v1 (rc.35)

Transport: the existing authenticated `/api/websocket` connection. Domain remains `hikvision_intercom`; include integer `id`, string `type`, and `api_contract: 1`.
Use a separately authenticated **personal Home Assistant identity** for each person. Never accept caller-provided actor/person IDs, a shared add-on service token as a personal identity, or an independent VMS JWT as proof. Native VMS identity federation is not implemented.
The existing embed v1 operator contract, routes and commands remain compatible.

## Render the exact personal screen

Use `/wiskey-renewal` under the same trusted origin/session as the existing integration. It loads `wiskey-renewal-panel` from the same versioned panel module. It has no duplicate sidebar entry. Preserve existing CSP/frame policy; do not weaken it or place tokens in URLs.
Accounts with no operator grant also see this page inside the main panel. Operators use the dedicated route. The personal page does not subscribe to the global private overview.

## Personal commands

Every command resolves the person on the server from the connection's active, non-system-generated identity. Additional fields such as `actor`, `user_id`, `account_id` are rejected.

| Type suffix | Required command fields | Behavior |
|---|---|---|
| `renewal/self` | none | Read only own projection |
| `renewal/request` | `revision:int`, `until:str`, `reason:str`, `request_key:str` | Create a pending request, not an access grant |
| `renewal/cancel` | `request_id:str` | Cancel only an own pending request; cancelled replay is idempotent |

Response: `{linked, timezone, api_contract:1}` plus, when linked, `{name, revision, active, valid_from, valid_until, can_request, requests}`.
Requests contain only `{id, until, reason, state, created_at}`. No managed person ID, PIN, card, door list, phone, account directory or other people's data is returned. Most recent20 own requests; states pending/approved/rejected/cancelled and derived stale/expired.

`until` must be an aware ISO8601 future instant later than the current finite expiry. Convert wall time using returned facility IANA timezone; reject DST folds/gaps rather than guessing. `reason` is nonempty, at most240 characters. `request_key` is a canonical16–64 character unique client nonce, e.g. UUID. Reusing it with identical payload returns the existing request; changing payload under the same nonce fails. A second pending request for the same person is rejected.
After timeout/disconnect, do not automatically replay writes. Read `renewal/self` and review saved state. Clear cached private data/drafts on authenticated identity/connection changes and lock. Existing `security/*` session/touch/lock/reauth commands are available to personal sessions without granting operator permissions.

## Administrator binding

`renewal/bindings` returns `{revision, bindings, directory}`. Each binding maps account ID to `{user_id,name,available}`; directory contains active/inactive personal account `{id,name,active}` records, excludes system-generated accounts.

`renewal/binding_update` requires `{account_id:str,user_id:str,revision:int,confirmed:bool}`. `confirmed` must be true after showing both identities and effects. Empty user_id removes the mapping. Compare-and-swap revision; only one personal account per managed person and one person per account. Relinking invalidates earlier pending personal requests. Admin search uses existing paged `users/query`; do not load all people or infer a binding by matching text.
This mapping is independent of operator authorization settings and cannot grant screen/door privileges.

## Separate approval

Reuse administrator `workflows/get` and `workflows/renew_decide` with `{request_id,approve}`. Renewal rows add `personal:bool` and `current_until` to the existing fields. Show current/new expiry, person, reason and origin before approval. The request actor cannot approve their own request, even if administrator.
Before commit the server checks active owner, current binding generation, person revision/active/archive state, future extension and existing station validation. Requests expire after7 days. Central atomic save is followed by normal reconciliation; it does not prove a physical door result. Never advertise approval as station synchronization completion.
The existing internal `workflows/renew_request` remains an operator command and is not a substitute for personal identity.

## Errors and storage

Expect `unauthorized`, `invalid_fields`, `confirmation_required`, `revision_conflict`, `renewal_identity_unlinked`, `renewal_identity_in_use`, `renewal_identity_inactive`, `renewal_identity_changed`, `renewal_person_unavailable`, `invalid_validity`, `renewal_already_pending`, `renewal_request_changed`, `separate_approver_required`, `approval_expired`, `operation_not_found`, `workflow_limit`, plus existing lock/reauth and transport errors. Do not expose private error payloads.
Identity bindings and requests live in schema16 central access state, with migration preserving schema15 requests and all existing access data. There is no separate VMS-owned identity database and no anonymous endpoint.


When dual approval is enabled, the personal requester is not counted as an administrator. First admin approval stores `reviewer` and returns `{saved:true,awaiting_second_approver:true}` without extending access. A different active administrator approves afterward; active first reviewer and current identity/person state are rechecked. `workflows/get` exposes reviewer and the pending state to admins.
