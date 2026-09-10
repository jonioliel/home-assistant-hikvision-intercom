# Development checkpoint — operational sensors and camera layouts

Started 11 September 2026 on owner authorization to implement the additional roadmap within the remaining usage allowance.

## N73 — partial implementation

Four opt-in diagnostic sensor entities: observed managed people, unique pending people, sync state, and last successful reconciliation time. Disabled by default. Counts use a nonpersonal projection without serializing public user records or making station requests. Missing inventory is unknown; queued work remains visible while offline. The observed count includes the last inventory scan time. A completed reconciliation is not physical access confirmation.

Pending-work age is still open: the current durable schema has no reliable creation timestamp for every work type. No age is guessed from a user's edit time. N73 is not marked complete.

Initial validation: 45 access-manager tests passed, Ruff and formatting passed, strict mypy passed for 62 configured modules. Real HA lifecycle/opt-in coverage was added and awaits Linux CI. Other requested tasks remain open. No station I/O was performed during this implementation.

Next: N65 named camera layouts, then the next independent priority item. Published version remains 0.33.0-beta.1 until a tested release is created.

## N65 — implemented and locally validated

Named camera layouts save camera order and four/nine budget per administrator/browser (maximum twenty). Loading always stops playback; removed cameras are reported and not silently replaced. Saving checks concurrent storage changes; malformed storage is preserved and not overwritten. Logout/user changes reset selection and playback. Eleven focused browser cases passed including 360/768/1440px layouts, save/load, order, missing cameras, actor changes, corrupt and stale preferences.

The first HA sensor run passed 312 cases and found a new test incorrectly assuming inventory exists immediately after loading a station with no managed people. Commit b94411c asserts unknown before a scan, then requests reconciliation and verifies zero after the actual scan. No production behavior was weakened.

N65 final local verification: all 356 browser tests passed, TypeScript and formatting passed. N73 corrected CI on b94411c passed all workflows. N77 clock comparison is the next implementation underway.
