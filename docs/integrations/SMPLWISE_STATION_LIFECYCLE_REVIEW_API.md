# Station onboarding and lifecycle impact — additive interface

Release: 2.0.0-rc.21. Technical domain: hikvision_intercom. API contract v1 remains unchanged.

## Sequential onboarding

The panel wraps the platform's existing authenticated config-entry HTTP flow. It does
not define another station credential API. See [sequence specification](../STATION_ONBOARDING_SEQUENCE_HE.md).
The VMS browser can embed the shipped panel. A custom VMS setup client must use a
real administrator session and preserve every native identity and relay confirmation
step. A backend supervisor token must not be treated as the authority of every VMS user.

The queue is a transient browser convenience with a 20-address resource budget;
it is not a product station limit. No credentials are persisted to browser storage.

## Read-only lifecycle review

Capability: station_lifecycle_review. Command:

    {"id": 1, "type": "hikvision_intercom/platform/lifecycle_review",
     "api_contract": 1, "source_id": "<existing-config-entry-id>",
     "target_id": "<replacement-config-entry-id-or-empty-string>"}

Only active administrators are permitted. A blank target means retirement impact.
The same source and target are rejected. The command performs identity reads for
loaded connections and computes desired policy on a detached repository snapshot.
It rechecks the current account, revisions, runtime identity and relay mappings
before returning. It does not start synchronization or call a write-capable endpoint.

The result includes:

- read_only: true, can_apply: false, device_writes: 0.
- affected_people: exact count; rows: up to 200; rows_complete and row_budget.
- Per-person before/after station IDs, group/personal allow/personal deny origin,
  physical locks and whether a native schedule needs separate redeployment.
- Group projection, including disabled groups; disabled groups are never activated.
- known_bindings and counts of pending tombstones/retired cards/retired PIN cleanup.
- unknown_owners from cached source inventory, null when inventory is unavailable.
  source_observed_at identifies this cached observation; it is not a fresh cleanup proof.
- blockers for existing replacement ownership/policy, unknown or nonempty replacement
  inventory, missing physical lock mappings, local user schedules and hold programs.
- stations: friendly names, identity_verified, identity_checked_at, safe error codes and
  physical-index/API-ID mappings. Identity verification is not inventory verification.
- cleanup_verified: false and source_removal_ready: false.

No PIN, card number, credential, photo, device serial, native schedule payload or raw
device response is returned. An unavailable source can still have desired permissions
and pending cleanup; it must not be interpreted as an empty or successfully retired device.

This is not an executable approval. Do not implement an Apply/Remove button using this
response. Atomic permission transfer and verified retirement are subsequent work packages.
Connection removal alone never proves erasure of physical credentials.
