# Project progress

Source of truth: CODEX_MASTER_SPEC.md v1.2, read completely on 2026-09-07.

| Phase | Status | Remaining gate |
| --- | --- | --- |
| 0 — Reconnaissance | Protocol baseline and active relay mapping verified | Ring sequence and changed-PIN behavior |
| 1 — Core integration | Main components implemented; HACS installation/update owner-confirmed | Ringing and full installed camera/call acceptance |
| 2 — Access backend | CRUD/import/sync/recovery implemented; permanent user sync verified | PIN/card lifecycle and timed-validity enforcement/fixes |
| 3 — Admin panel | Main screens implemented; 0.9 completes Save controls, lock names and validity summaries | Installed-system acceptance |
| 4 — Events | Stream/history/normalization/recovery implemented and read against station | Actual bell sequence and physical event acceptance |
| 5 — Hardening | Diagnostics/Repairs/migrations/privacy/release automation implemented | Nine-station hardware soak and final acceptance |
| 6 — Optional future | Outside mandatory v1 | Follow-on work |

The September 8 audit estimated roughly 90% software implementation and 80% overall completion,
including physical acceptance, before the 0.9 additions. These are scope estimates, not measured
hours or percentages derived from test counts. Historical "software complete" entries below
record major-component milestones; they do not certify every specification detail or physical gate.
The owner's single-active-relay scope supersedes the generic second-relay requirements.

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
explicit default-branch authorization was missing. At that checkpoint the owner approval question was pending.
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
Owner-dependent commissioning, HA/HACS acceptance and nine-station physical soak remain.
No Phase 6 optional work is required for v1.
The latest local documentation commit records this evidence without changing runtime behavior.

Publication authorization: the owner explicitly approved merging Phases 2–5 into `main`
and publishing `v0.6.0-alpha.1` for installation and testing on 2026-09-08. This resolves
the earlier approval gate. The gated release workflow reruns CI on the exact main commit.
Hardware and real installation acceptance remain open; the owner will install and report.

Post-installation correction: the owner confirmed HACS installation and working integration,
then reported station-bound user sync failures. A production-manager test reproduced invalid
validity dates on the real station. Version 0.6.1-alpha.1 fixes permanent-user creation and adds
safe stage diagnostics plus actionable Sync errors. Real create/name-update/targeted-delete
passed without credentials or relay actions; original records remained unchanged. Timed
validity timezone interpretation remains explicitly unverified and blocks timed readback.

Fleet status completion (0.7.0-alpha.1) fills the required Overview/Intercom health details:
retained last access, successful status contact/request duration, pending unique users and
last successful reconciliation. PIN-removal queues are visible and masked-card suffix search
is available. No new ISAPI behavior or physical operation is introduced. The owner reports the
installed integration working well; outstanding physical gates remain tracked in HARDENING.md.

Station inspection and assignment completion (0.8.0-alpha.1) corrects the rescan/sync action
mix-up and fills Intercom capability/mapping/event-health presentation plus deliberate fleet
assignment selection. Read-only inspection and ordinary background synchronization have separate
semantics. No new ISAPI mutation, storage migration or physical action was introduced.


0.9.0-alpha.1 closes the three identified UI/software gaps: independent immediate-sync choice,
configured active-lock names across HA/panel, and configured validity summaries in the user list.
Save continues to participate in automatic reconciliation; it does not add a permanent hold state.
No device credentials, relay commands or firmware-validity behavior were changed for these features.
Local protocol/access regressions pass (354 tests); HA transport/entity/configuration regressions
and browser acceptance are included in the release's CI gate. Physical gates above remain open.


Admin-completion code `4efe4e0ebfe568dff1487542bcb2ced58ef30756` passed all branch CI:
354 protocol/access tests on Python 3.12 and 3.14, 119 actual Home Assistant tests,
30 browser tests, Ruff, mypy, TypeScript and reproducible frontend build. ConfigFlow retains
100% coverage. Python checks: 34254503208; HACS: 34254503166; Hassfest: 34254503200.
The owner is currently unavailable for supervised physical checks; those gates remain deferred.


0.9.1-alpha.1 addresses owner acceptance feedback: one pending release previously set the panel's
global busy flag and disabled every door. The browser regression reproduced this on 0.9.0.
Release state is now per station, with local progress/outcome and unchanged target validation.
A related panel reattachment/queued-refresh issue uncovered during lifecycle testing is corrected.
The owner confirmed updating to 0.9.0; no physical commissioning result is inferred from that.


Independent-door code `93538ecc24bd4e23791ac8ba3c3191be516b407f` passed all branch CI:
354 protocol/access tests on Python 3.12/3.14, 123 actual HA tests, 38 browser tests,
Ruff, mypy, TypeScript and reproducible bundle checks. ConfigFlow coverage remains 100%.
Python checks34259688049; HACS34259688072; Hassfest34259688067. HA job102174232294
confirms independent runtime completion, same-target guarding and safe failure translation.
These tests mock device I/O and do not close the outstanding physical commissioning gates.
