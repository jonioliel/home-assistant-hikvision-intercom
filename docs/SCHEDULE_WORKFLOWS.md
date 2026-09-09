# Schedule workflows

## Dependency audit (Phase 6, read-only)

The administrator can trace explicit user RightPlan template references through observed
weekly plans, holiday groups and holiday plans. The documented user fields are `doorNo`
and comma-separated `planTemplateNo` (manufacturer UserInfo schema). Reading uses the
previously verified UserInfo Search protocol; it does not search card records or write devices.

Missing/empty RightPlan means unknown defaults, not no access or no dependency. Malformed
assignments are counted without using partially parsed references. Disabled resources remain
in the graph. Unobserved IDs may fall outside partial inventory coverage; they are not declared
missing configurations. Complete traversal does not establish effective enforcement or ownership.

User identities, names and credentials are discarded before returning the summary. Counts and
up to 20 resource IDs per category are shown/exported. Schedule inventory and user search each
have a 60-second deadline, with a 130-second API deadline including the read queue. The existing
per-station/fleet read limits apply. No baseline, central user or schedule draft is changed.

Physical enforcement, allocation/ownership and safe schedule writes remain deferred.

## Multi-station compatibility queue

The current draft can be assessed across all configured stations with two concurrent reads.
Unavailable/unloaded stations or stations without a managed lock are explicitly skipped.
Each station keeps an independent result or failure; no automatic retry, device write or baseline
save occurs. The existing API enforces its per-station and fleet limits on the server as well.

Cancel stops queued reads while in-flight reads finish. Editing/reloading the draft, changing
the selected station, leaving the screen or losing administrator access invalidates the queue
and prevents late responses from restoring it. The report download includes the draft name,
station labels/status and sanitized results, with baseline approval tokens removed. It describes
software compatibility and search coverage, not physical enforcement or a nine-station soak test.

## Portable draft import/export

Export saved drafts from the library as JSON format `hikvision_intercom.schedule_drafts`,
version 1. Only names, weekly windows and holiday exceptions are included. Database IDs,
revisions, station configuration, users, credentials and baseline fingerprints/tokens are excluded.
Unsaved editor changes are not exported. Keep exported names and attendance schedules private.

Import accepts at most 8 MiB and 100 drafts, subject to the library's total limit of 100.
Duplicate JSON keys, unknown fields, invalid times/dates and any invalid batch member reject
the entire file. A preview shows each name, window/holiday counts and repeated-name counts.
Explicit confirmation appends fresh UUID copies in one durable save; no existing draft is replaced.
Repeated names are allowed and remain separate drafts. The current unsaved editor is preserved.

The single-use preview belongs to its administrator, expires in five minutes, and is invalidated
by any library change or a newer preview by that administrator. Pending previews are memory-only
and capped at 16. A failed save publishes none of the batch. Cancellation waits for an atomic
save to finish. An unknown response requires library reload; no automatic import retry is made.
These files transfer local drafts only; they do not deploy schedules or assign user permissions.

## Clone and copy daily windows

Clone current draft opens a new unsaved copy, including current edits and holiday exceptions.
The original stored UUID/revision are not copied; Save creates a new draft. The localized copy
suffix respects the 32-character name limit. Navigation retains the normal unsaved-change guard.

Choose a source weekday and target weekdays to replace their windows. Non-empty targets require
confirmation naming the affected days. A closed source day clears targets. Each target receives
an independent copy, so editing one day cannot change another. Copy invalidates stale previews
and assessment queues, and does not write storage until Save draft is selected. Server validation
still rejects overlapping, reversed or excessive windows.

## Observed evidence and acceptance

A production-client read at 2026-09-09T05:28:38Z returned three users, all with empty/missing
RightPlan references, classified as unknown defaults. No raw identities or credentials are
published. Templates, weekly plans and groups completed their searches; holidays remain partial.
No station writes occurred. Non-empty RightPlan parsing is covered by manufacturer schemas and
synthetic tests; it is not a claim of physically verified assignment/enforcement.

User-read failures export null dependency counts, not zero assignments. Searches across resources
and users are not an atomic snapshot; devices may change between reads. Physical commissioning,
resource ownership/allocation, schedule writing/readback and user assignment remain open.
