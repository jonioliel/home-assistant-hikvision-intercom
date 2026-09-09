# Schedule deployment preparation

## Candidate compiler

The compiler translates a normalized local draft and explicitly supplied resource IDs into
candidate manufacturer schedule bodies. It sends no requests and does not allocate device slots.
Weekly and holiday periods include every advertised period slot, with unused slots disabled and
zero times (as observed in the commissioned device). The end-of-day value remains 24:00:00;
local wall times are not converted to UTC. Holiday names are kept locally: the provided holiday
PUT schema does not establish writable holidayPlanName support, so it is not sent as a candidate.

Ordering is weekly/holiday resources, holiday group, then template. Identifier/reference ranges,
name bounds, weekday support, window count and time precision are checked against advertised
capabilities. A missing constraint blocks compilation rather than inventing a capability.
The holiday-group member count is still unknown and remains a separate assessment blocker.
An empty group reference is a candidate representation, not proof of effective all-week access.

Source contracts: manufacturer IP/Pro ISAPI pages 438-447; observed capability fixture
`tests/fixtures/schedule_capabilities_readonly.json`. This does not prove PUT acceptance,
readback equivalence or physical enforcement. No write path is enabled by compilation.

## Observed configuration comparison

Explicitly selected records are captured privately from validated Search pages. Unselected raw
records are not retained, and any failed resource search discards its captured rows. Public
inventory reports keep their previous allowlisted schema. User references reuse the existing
verified UserInfo Search reader, without searching cards or sending configuration requests.

Comparison sorts period slots and reference lists, preserves seconds, dates and disabled slots,
and reports changed field names without returning existing station configuration names or values.
Missing records are not free slots. Unknown fields (including authentication-count controls) make
comparison unsupported instead of silently dropping access restrictions. Disabled referenced
resources still count as dependencies. A matching configuration still has ownership and write
verification blockers; no write command or automatic resource selection is introduced.

## Saved deployment proposals

Select a saved, unchanged draft in Access schedules, then use Deployment proposals. Choose a
station and enter template/weekly IDs; for holidays, enter a group ID and one distinct holiday ID
per date-ordered exception. There is no automatic device-slot allocation. Compare first, then
explicitly save the local proposal. Its blockers remain visible and it cannot apply to a device.

A saved proposal retains the source draft snapshot/revision and reserves its resource IDs only
against other local proposals for that station. A different station can use the same numbers.
This is not ownership of a device resource, proof that a disabled resource is unused, or a device
write journal. At most 32 proposals and 16 pending reviews are retained. Pending reviews belong to
one administrator, expire in five minutes and are single-use. Source changes or changed device
identity/firmware reject an outdated save. A stale draft is not silently copied into a saved plan.

Recheck reads again and records a new report/revision; it compares against the original raw
configuration and capability fingerprints. Originals are not advanced by rechecking. Source draft
edits/deletion are shown separately; deleting a draft does not delete its proposal snapshot.
A changed device identity/firmware requires a new proposal. Failed/unknown local saves do not
retry automatically. Reload proposals to inspect the outcome. Navigation during reads discards
late UI responses; local saving/deletion blocks navigation briefly until its response arrives.

Download proposed configuration exports candidate bodies and the safe report, not raw station
records, credentials, identity/firmware fingerprints, private keys or approval tokens. Existing
configuration differences are field names only. The desired draft names/windows are included and
should be treated as private scheduling information. Delete local proposal releases only its
local reservations; it never removes a device configuration.

Storage `.storage/hikvision_intercom.schedule_plans` is independent, private and atomic. Load
validates the schema, candidate bounds, report allowlists, digests and reservation uniqueness.
Corruption raises its own Repair while core access, drafts and comparison baselines remain usable.
Rechecking is explicit; this release adds no background monitor or automatic deployment.

## Live read evidence

Two production-client comparisons on 2026-09-09, including local save/reload between them,
found the same observed selected configurations. The weekly resource was referenced by a template
outside the proposal, and three users had unknown defaults. Holiday inventory was partial.
The proposal remained blocked and **zero station writes** occurred. Existing credentials and relay
states were not changed. Raw device data and private fingerprint storage are not published.

## Remaining deployment work

Device ownership/adoption, complete relevant inventory, verified PUT/readback and RightPlan user
assignment, durable device-write recovery and physical weekly/holiday/DST enforcement remain open.
The candidate compiler and comparator are implemented building blocks for that work; their local
proposal status must never be used to bypass those gates. Mandatory acceptance remains 28/38.
