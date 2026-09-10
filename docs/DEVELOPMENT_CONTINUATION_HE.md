# Development checkpoint — operational sensors and camera layouts

Started 11 September 2026 on owner authorization to implement the additional roadmap within the remaining usage allowance.

## N73 — partial implementation

Four opt-in diagnostic sensor entities: observed managed people, unique pending people, sync state, and last successful reconciliation time. Disabled by default. Counts use a nonpersonal projection without serializing public user records or making station requests. Missing inventory is unknown; queued work remains visible while offline. The observed count includes the last inventory scan time. A completed reconciliation is not physical access confirmation.

Pending-work age is still open: the current durable schema has no reliable creation timestamp for every work type. No age is guessed from a user's edit time. N73 is not marked complete.

Initial validation: 45 access-manager tests passed, Ruff and formatting passed, strict mypy passed for 62 configured modules. Real HA lifecycle/opt-in coverage was added and awaits Linux CI. Other requested tasks remain open. No station I/O was performed during this implementation.

Next: N65 named camera layouts, then the next independent priority item. Published version remains 0.33.0-beta.1 until a tested release is created.
