# Unified search — additive VMS contract v1 (rc.36)

The technical domain remains `hikvision_intercom`. Existing authentication, personal identity, operator scope and embed v1 rules are unchanged. No new service-token trust or permission grant is introduced. Discover `unified_search` and the exact command in the existing API capability response before exposing the launcher.

Send through the authenticated Home Assistant WebSocket transport:

```json
{"id": 51, "type": "hikvision_intercom/search/query", "api_contract": 1, "query": "Local", "kind": "all", "offset": 0, "limit": 25, "snapshot": ""}
```

All five fields are required. `query` is a string up to 160 characters without controls; Unicode NFKC/case folding and AND matching are used. `kind` is `all`, `people`, `events` or `actions`. Integer `offset` is 0–100000 (must be zero for all), integer `limit` is 1–100. `snapshot` is empty on a new search, or the returned 24-character lowercase hexadecimal token on paging. Rejecting extra fields prevents client-supplied actors or policies.

The normal WebSocket result contains `query`, `kind`, `offset`, `limit`, `snapshot`, `stale`, `api_contract:1`, `sections`, and `coverage`. Each of the three sections contains `available`, `total`, `records`, `next_offset`, `previous_offset`. A forbidden source has `available:false`, `total:null` and no records or offsets; never render it as zero matches. An empty query returns no directory listing. `all` returns at most eight previews per permitted source; a selected source returns the requested page. Preserve the token for the same query/kind. A visible-source or policy change sets `stale:true` and resets offset to zero; update the pager from the response.

People: `id`, `name`, `employee_no`, permitted `phone`, `active`, `archived`. PIN/full card numbers, photo blobs and hidden fields are never indexed or returned. Permitted card suffixes can match only a four-digit search, but the internal suffix index is not returned. Use existing users/get under the same identity when opening details.

Events: `id`, `station_id`, `station_name`, `timestamp`, `received_at`, `person_name`, `employee_no`, `event_type`, `result`, `authentication`, `door`, masked `card`, `source`, `time_source`. Names are observed event evidence, not a current employee join. Removed station names may be empty. Source/time codes are the existing event contract.

Actions: `id` (audit sequence as string), `time`, `action`, `actor`, `actor_name`, `name_before`, `name_after`, `employee_no`, `fields`, `stations` (visible names). No raw before/after objects or credentials. This source requires the existing audit/list permission; a station/field restricted operator does not gain global audit access.

`coverage.basis` is `retained_records`; `event_retention_days`, `event_storage_failed` and `action_retention_days` are null for unavailable sources. This is not a station-history completeness certificate. Existing cache retention and administrative audit bounds remain in force. No device I/O or database migration occurs.

Errors use the existing transport shape: invalid_fields, unauthorized, permissions_changed and standard rate/payload errors. Destroy stale UI data immediately on auth/account/connection or permission context changes; ignore late replies using a session epoch. The server rechecks fresh account activity and effective policy before returning. Render all values as text and preserve RTL/LTR phone/timestamp isolation.

Embed consumers can retain existing navigation and screens. The panel adds an in-content search launcher without changing embed tab IDs or the root API version. Implement source tabs, bounded paging and existing detail/journal navigation rather than a parallel user editor.
