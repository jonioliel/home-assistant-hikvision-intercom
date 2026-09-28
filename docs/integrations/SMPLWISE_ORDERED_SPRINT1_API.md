# Ordered sprint 1 — additive API and approval contracts

Technical domain and WebSocket prefix remain `hikvision_intercom`. Discover
capabilities through the response's existing `api` descriptor. Existing `overview`,
embed v1, CSV, media, groups and permissions contracts remain available.

## Lightweight overview

Capability: `overview_summary`. Command: `hikvision_intercom/overview/summary`,
with no additional arguments. It returns the normal station/overview projection,
`users: []`, `users_complete: false`, and `user_count` for the caller's visible
people. A zero-length users array here does not mean an empty database. Use
`users/query` for pages and `users/get` for details. Use the old overview only
after an unknown-command response or when a legacy consumer explicitly needs
the full people snapshot. A directory error must not be rendered as an empty
database. Counts and station details follow the same operator scope as before.

`users/query` adds `profile_facets`: bounded values from the entire projected,
visible directory, including off-page values. Restricted profile fields are not
included. Each field is bounded to 200 values. Preserve paging and snapshot checks.

## Quality observations

Capability: `operational_quality_metrics`. Existing station health diagnostics
add a `quality` object with requests, door-command acknowledgements and
synchronization observations. Metrics expose counts, failures, P95, percentages
and a startup comparison (first 20 observations versus up to 100 later ones,
requiring at least 20). Insufficient samples produce null, never a fabricated zero.
Counters reset with their runtime and are not persisted service-level promises.
Door acknowledgement time does not establish a physical door state. Transport
gap count/duration does not establish how many source events were lost.

## Checkpoint job second approval

Capability: `checkpoint_job_approval`. All commands require a current active
infrastructure administrator; normal people-view permissions do not grant these
administrative commands. Jobs may be staged while dual approval is enabled.

1. `jobs/list` adds `dual_approval` and `reviews` (other operators' pending jobs).
2. Owner calls `jobs/approval_request` with `job_id`, current `revision`, `action`
   (`resume` or `retry_failed`), and `confirmed: true`. It does not start work.
3. Reviewer calls `jobs/approval_review` with `job_id`. Response includes current
   job/revision, opaque `review_id`, `own_request`, and masked before/after `impact`.
   Review details include assignment changes and timing, not PIN/card secrets.
4. A distinct administrator calls `jobs/approval_decide` with `job_id`, exact
   `revision`, `review_id`, `approve`, and `confirmed: true`.
5. Owner explicitly calls the existing `jobs/action` with the updated revision.

Approval expires after 24 hours and is bound to reviewed row contents and current
people/policy revisions. It is rechecked before each row, including the approver's
current administrator/active status. Restart pauses work; saved rows are not
replayed. A fresh approval is required for an explicit failed-row retry. A rejected,
expired or stale approval never implicitly grants access. Canceling remaining rows
does not undo rows already saved. Public job states remain backward compatible.

Foreground CSV now also supports `workflows/submit` for `users/csv_apply`; its
`values` use the existing foreground names: `csv`, `mode`, `review_token`, and
optional `column_map`. The exact preview is rebuilt and verified. Normal
`users/csv_apply` is still blocked when dual approval requires this workflow.

## Fleet configuration second approval

Capability: `fleet_configuration_approval`, also in `platform/get.capabilities`.
The owner obtains the existing `platform/config_preview`. A preview that has no
eligible rows cannot be approved or applied.

- `platform/config_pending` has no arguments; returns bounded active reviews.
- `platform/config_review` takes `review_id`; returns names, doors, before/after
  values, `own_request`, `state`, remaining seconds and exact-plan `fingerprint`.
- Distinct administrator calls `platform/config_decide` with `review_id`, exact
  `fingerprint`, `approve`, and `confirmed: true`. It writes no device settings.
- Owner explicitly calls existing `platform/config_apply` with `review_id` and
  `confirmed: true`. The single-use review expires after five minutes and is
  intentionally memory-only: an infrastructure restart invalidates it.

Station identity/relay mapping, configuration revision, maintenance window and
approver authorization are checked again during apply. Read-before-write and
readback remain in the technical dispatcher. Each station gets its own receipt;
failure on one station does not make another verified result fail. No automatic
retry, unlock, microphone activation or announcement is introduced.

The generated [command catalog](WISKEY_VMS_PANEL_COMMANDS.json) contains exact
schemas. An API consumer must feature-detect before offering the new controls.
