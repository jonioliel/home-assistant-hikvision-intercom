# D-006 minimal background projection — proposed field contract

Requirement agreed; exact schema below proposed, not implemented. New additive command/capability name is deliberately unassigned. Do not send this schema to overview/summary or infer it describes that response. It is a minimal read-only station health projection generated on the WisKey server with explicit construction, never broad serialization followed by denylist stripping.

## Candidate fields

| Field | Type | Meaning |
|---|---|---|
| schema_version | const 1 | Version of this new projection only; unrelated to existing API.version |
| generated_at | UTC date-time | Server generation time, not last access/event time |
| permission_revision | nonnegative integer | Current operator/background policy revision |
| stations | array | Only stations admitted by current explicit station scope |
| stations[].id | string | Opaque configured station ID |
| stations[].name | string | Configured station label; labels themselves can contain personal text and must be operational labels if a no-personal-data guarantee is required |
| stations[].online | boolean or null | true/false known health; null means unknown |
| stations[].last_seen | UTC date-time or null | Last successful health observation, not access-event time |

Excluded entirely: last_access, call/event identity, person names/employee IDs, cards/PINs/photos/profiles, user counts/data, host/source credentials, model/firmware, raw errors, access groups and unbounded diagnostics. `call_state` is excluded initially because it is operational activity beyond pure health; add only via explicit agreed field revision if Arx needs it. Technical health detail can be considered separately after B0, not under the current fixed allowlist.

No unknown properties in this first schema, including nested station items. Arx constructs/cache-serves only these approved fields too; don't copy unknown input keys. WisKey must enforce current user, station/view scopes, lock and limiter. Minimal projection doesn't exempt background sessions from existing security policy. Empty list means no currently returned stations, not proof of zero installed stations. No area/station total counts.

Example fixture (not live evidence):

```json
{"schema_version":1,"generated_at":"2026-10-01T09:00:00Z","permission_revision":4,"stations":[{"id":"station-1","name":"Main entrance","online":true,"last_seen":"2026-10-01T08:59:58Z"}]}
```

Current overview can contain last_access identity through websocket.py:523, events.py:319-320 and operator_scope.py:237-243; field redaction there removes photo/card, not person_name/employee_no. This is source inspection, not a live exposure test.

Before implementation: Arx confirms id/name/online/last_seen meet B0, operational station-label policy is settled, full request/error/capability schema named, station-limited/non-admin/locked fixtures, stale cache/reconnect tests, and live B0 validates actual scope. No new behavior should be exposed without a new runtime release.
