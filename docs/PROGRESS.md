# Project progress

Source of truth: CODEX_MASTER_SPEC.md v1.2, read completely on 2026-09-07.

| Phase | Status | Gate |
| --- | --- | --- |
| 0 — Reconnaissance | Protocol baseline complete; commissioning remains open | Probe, call sequence, relay mapping, PIN/card findings |
| 1 — Core integration | Software complete | 190 protocol tests + 41 real HA tests; HACS/Hassfest pass |
| 2 — Access backend | Software complete; all CI passed; publication awaiting approval | Verified credential and permission behavior |
| 3 — Admin panel | Software complete; all CI passed; publication awaiting approval | All CI; publication awaiting approval |
| 4 — Events | Software complete; all CI passed; publication awaiting approval | Verified event behavior |
| 5 — Hardening | Software complete; all CI passed; hardware/installation acceptance open | Nine-device soak and HACS install/upgrade acceptance |
| 6 — Optional future | Outside mandatory v1 | Follow-on work |

No release until required CI passes on the exact main commit.
A Phase 0 tooling prerelease must say HA setup/entities arrive in Phase 1.
Do not describe physical Phase 0, the full project or installation acceptance as complete.

Permanent requirements: camera in HA and panel; explicit relay selection enforced by backend/UI;
persistent offline sync/tombstones; secret redaction and administrator-only access management.

Phase 0: 130 tests / 90% coverage, Ruff, mypy, HACS and Hassfest passed; commit `608abe7`
was published as `v0.1.0-alpha.1` by release workflow 34206758291.
Phase 1: commit `706ae2f` passed 190 protocol/configuration tests and 41 real HA tests
(100% ConfigFlow coverage), Ruff, mypy, HACS and Hassfest. Version `0.2.0-alpha.1`
was published from `edb6a81` by release workflow 34211929200.
Physical HA installation acceptance remains open.
See VALIDATION.md and CAPABILITY_MATRIX.md for evidence and remaining acceptance work.
The owner approved publication of source/history/specification and sanitized evidence.

Remote evidence now covers 20 successful ISAPI reads, idle call samples, local PIN mode,
real JSON alert-stream fixtures and independently decoded RTSP/snapshot frames.
The supervised second-station session confirmed API door 1, existing-card authentication and
initial six-digit local PIN acceptance. PIN modification was acknowledged and read back, but
both old and new PINs failed physically. Diagnosis and temporary-user cleanup remain open.
The owner excludes disabled relay 2 project-wide and defers answer testing because no
answering screen is installed. A witnessed bell attempt produced busy tone and only idle samples.
See the [station B evidence](../tests/fixtures/ds_kv6124_e1_fw_3_9_0_station_b/README.md).
Two stream reconnections returned HTTP 500 before a later successful retry.

Manufacturer review and continuation scope: [MANUFACTURER_PROTOCOL.md](MANUFACTURER_PROTOCOL.md).
The owner requested continued development while away from the equipment; physical checks
remain deferred, not counted as passed. Numeric PIN event meanings are now documented.

Phase 2 checkpoints: `c99beb0` passed 244 local tests and all CI; `26f9b34` passed
272 protocol tests and 54 real HA tests with 100% ConfigFlow coverage, HACS and Hassfest.
The final backend includes changed-field updates, cancellation-safe atomic persistence,
explicit import/conflict resolution, durable deletion, independent queues and offline recovery.
Current local verification: 280 tests, Ruff and mypy (20 protocol/access/tool files).
Real read-only access-client validation returned two users and one card with zero mutations.
The administrator panel follows in Phase 3. Physical commissioning is still open.

Phase 2 final commit `0c061d6` passed all checks (280 protocol + 54 HA tests). An automatic
approval review rejected updating default `main` and publishing `v0.3.0-alpha.1`, stating that
explicit default-branch authorization was missing. The owner approval question is pending.
No workaround or default-branch mutation was attempted after that rejection.

Phase 3 checkpoint `384c179` passed 280 protocol tests, 86 actual HA tests (100% ConfigFlow),
9 Chromium UI tests, TypeScript, reproducible bundle checks, HACS and Hassfest. Subsequent UI
coverage now has 12 tests. The first HA run found outer schema errors could echo malformed
credential payloads; validation was moved inside admin handlers and the privacy regression passed.
UI screenshots use synthetic data and illustrative camera frames, never live station identities.

Phase 3 final `f7d925a` passed all CI: 281 protocol, 86 HA and 12 browser tests.
Phase 4 adds event framing, verified access normalization, event entities, bounded audit storage
and an administrator history view. A read-only manufacturer-documented event query returned
241 records in nine pages, with no credential writes or physical commands.

Phase 4 checkpoint `b0b7f67` passed 320 protocol and 94 real HA tests; the browser run
identified a filter-label locator problem, since fixed with explicit accessible labels.
All 14 local browser tests then passed. The production stream parser was subsequently
verified against nested MIME framing: 13 documents / 11 access events in 12 seconds.
Final Phase 4 adds a framing regression and capability-bounded dense-window recovery.

Phase 4 final `c15ef98` passed 321 protocol tests, 94 real HA tests, 14 browser tests,
HACS and Hassfest. It prepares `0.5.0-alpha.1`; no main mutation/publication occurred.
Phase 5 checkpoint `65ee939` passed 328 protocol and 14 browser tests, HACS and Hassfest.
The HA run identified a diagnostics capability-field mismatch (100 passed / 2 failed),
which was corrected to the actual capability model before final validation.
A real 60-second concurrent read-only check completed 28 polls, 3 snapshots and 50 event
messages, with zero errors and zero physical or credential writes. This is one station,
not the mandatory nine-station hardware soak. Six simulated fleet rotation/restart cycles pass.

Phase 5 final software commit `14e62c8` passed all GitHub checks: 328 protocol tests,
104 actual HA tests, 14 browser tests, HACS and Hassfest. ConfigFlow and config-entry
migration each have 100% line coverage in the HA job. Version `0.6.0-alpha.1` is prepared.
Only owner-dependent commissioning, HA/HACS acceptance, nine-station physical soak and
explicit approval to update main/publish remain. No Phase 6 optional work is required for v1.
The latest local documentation commit records this evidence without changing runtime behavior.
