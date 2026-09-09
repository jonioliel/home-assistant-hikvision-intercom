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
