# RC17 workflow API for the VMS

These commands extend the authenticated panel WebSocket API. The technical domain
remains `hikvision_intercom`. Use the infrastructure WebSocket authentication and
the VMS integration guide; never connect directly to the private `.storage` files.
Read the advertised `api.commands` before rendering a control. API contract version
remains 1; all existing commands retain their shapes.

Send `{ "id": <unique integer>, "type": "hikvision_intercom/<command>", ... }`.
Responses use the existing result/error envelope. Mutations require active account,
screen security, area/person/station scope and optional fresh authentication. Most
workflow management is administrator-only; `workflows/renew_request` also permits
properly scoped operators with user-management permission. No credential or token
belongs in browser logs, URLs, telemetry or exported diagnostics.

## Jobs

- `jobs/list` returns only jobs owned by the authenticated actor.
- `jobs/bulk_create`: `operation_id`, `confirmed: true`, after the existing bulk
  preview; creates a paused job. The preview belongs to this actor.
- `jobs/csv_create`: `content`, `mode`, `review_token`, `column_map`, `confirmed: true`,
  after the existing CSV preview. Invalid/stale previews cannot become jobs.
- `jobs/action`: `job_id`, current `revision`, `action` of `pause`, `resume`, `cancel`
  or `retry_failed`. Render progress from the server, not optimistic row completion.
- `jobs/errors`: `job_id`; download the returned CSV with the existing download helper.

Saved rows and checkpoints commit together. After restart running jobs become paused.
Cancellation does not undo saved desired access or pending station revocation. Dual
approval prevents job creation/resumption; existing running jobs pause if it is enabled.

## Backup

- `backups/export`: `passphrase` (12–512 characters); returns `content`, `filename`.
- `backups/preview`: encrypted `content`, `passphrase`, `mapping: {}` for the same
  installation, `mode: "add_only"` or `"update_matching"`. Show the returned collision
  and impact rows. This does not write.
- `backups/apply`: `review_id`, `confirmed: true`. Reviews are actor-bound, expire
  after ten minutes and require unchanged data/rules. A saved request can be replayed
  safely using its durable receipt.

Import restores reviewed people and desired access only. It preserves active station
ownership and revocation journals. Profile/group definitions must match. This is not
a host/settings restore or a code rollback. See the sprint guide for full backups.

## Screen security

- `security/session`, `security/touch`, `security/lock` have no payload.
- `security/reauth_start` returns the login flow and fields.
- `security/reauth_step`: `flow_id`, `values` with the requested password or MFA field.
  Render the server schema/errors, never assume password alone is sufficient. Account
  identity is fixed by the current connection; another user's proof is rejected.

Idle lock and fresh-proof elevation belong to the connection, not a client-provided
user ID. New connections are locked when an idle policy is active. On `screen_locked`,
clear all private views/drafts and stop media; authentication never replays a pending
write automatically. Password accounts use the local provider and configured MFA.

## Review center

`workflows/get`: `days` (1–365) returns settings, masked approvals, transfers, masked
inventory, presets, access reminders and renewal requests. `workflows/settings_update`
uses current `revision` and `values` containing `idle_minutes`, `reauth_sensitive`,
`dual_approval`. Defaults are off. Preserve all three fields when updating.

When an access mutation returns `approval_required`, offer a review request:

```json
{
  "id": 31,
  "type": "hikvision_intercom/workflows/submit",
  "command": "users/update",
  "values": {"user_id": "PERSON_ID", "revision": 4, "data": {"active": false}},
  "label": "Disable access after departure"
}
```

`workflows/decide` takes `request_id`, `approve`; a different active administrator
approves. Then the requester explicitly calls `workflows/apply` with `request_id`.
`workflows/withdraw` lets the requester discard a pending/approved request. Render
the stored masked `impact` before/after rows, not raw private mutation data. Changed
revisions/rules invalidate application. Unsupported commands return
`approval_command_unsupported`; never retry them through another write route.

## Identity and cards

- `workflows/transfer_start`: `kind` (`card`, `identity`, `merge`), `source`, `target`
  (empty for identity), source `revision`, `value` (card ID/new employee number),
  `confirmed: true`. Wait for `ready`; absence of a network error is not removal proof.
- Under dual approval: another admin calls `workflows/transfer_review` with
  `transfer_id`, `approve`, then the owner calls `workflows/transfer_begin`.
- `workflows/transfer_finish`: `transfer_id`, `cancel`, `confirmed: true`.
  Completion waits for every required revocation. Cancellation never resurrects access.
- `workflows/transfer_recheck`: `transfer_id` after reviewing a changed destination;
  invalidates the previous approval where applicable.
- `workflows/inventory_save`: `card_id` (empty for creation), `revision` (0 for new),
  `values: {card_no, label, status, return_by}`. On edit an empty card number retains
  its private value; never display or copy the masked public number into the payload.
  Status is `available`, `temporary`, `lost` or `blocked`; return date can be null.
- `workflows/inventory_issue`: `card_id`, target `user_id`, target `revision`,
  `confirmed: true`.
- `workflows/inventory_return`: `card_id`, inventory `revision`, `delete`,
  `confirmed: true`. Deletion is blocked until all active/retired ownership is removed.

Inventory return dates are operational tracking, not access expiry. Lost/blocked
cards revoke desired access and cannot be issued by another person-edit route.
Merge preserves destination permissions, rather than unioning access.

## Presets and renewal

- `workflows/template_save`: `template_id`, `revision`, `values: {label, data, message}`.
  Data can contain groups, profile fields, desired doors, validity and infrastructure
  timing. PINs/cards and personal native-schedule bindings are forbidden.
- `workflows/template_delete`: `template_id`, `revision`.
- Applying a preset in the VMS fills a local person draft only, preserving that
  person's credentials. Review, save and synchronize through existing user commands.
- `workflows/reminder_action`: `reminder_id`, `action` (`ack` or `snooze`).
  Offer existing manual WhatsApp preparation; no automatic sending.
- `workflows/renew_request`: `user_id`, current `revision`, `until` (ISO timestamp),
  `reason`. Requires an existing bounded period and extends only its end.
- `workflows/renew_decide`: `request_id`, `approve`; only another active admin can
  approve. This never changes doors or weekday/hour schedules.

The generated [full command catalog](WISKEY_VMS_PANEL_COMMANDS.json) is authoritative
for field names. UI paths and limitations are in the
[Hebrew sprint guide](../PRIORITY_TEN_SPRINT_2026_09_28_HE.md).
