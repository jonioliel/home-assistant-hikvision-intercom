# Isolation of synchronization failures

A busy response or a failed user operation is recorded on that user's station assignment. It does not terminate the remaining users in the pass. Conflicts continue to require the existing ownership/readback checks; this change does not overwrite records to bypass a conflict.

Each person reconciliation has a 180-second deadline, including transaction acquisition. When a person request times out, the engine checks identity and refreshes inventory within 20 seconds before attempting another person. An uncertain write retains its durable intent for readback on a later retry; it is never blindly replayed. A real station outage stops that station's pass, while independent station workers continue. Authentication, persistence failures and failures of the fresh station inventory remain station-wide barriers.

The station summary no longer repeats an individual person's error as if every user failed. Individual errors remain available in diagnostics and in expandable, wrapping details in the corresponding synchronization cell. Desktop and mobile regression tests cover long error text and unaffected successful users.

Validation includes busy, timeout, conflict, overall deadline, actual disconnection and storage-timeout scenarios with multiple users, as well as the existing access engine and manager regression suites. No physical station configuration or credentials are changed by these tests.
