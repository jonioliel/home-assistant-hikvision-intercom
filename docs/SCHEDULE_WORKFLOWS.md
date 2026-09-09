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
