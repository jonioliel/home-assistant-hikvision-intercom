# Project progress

Source of truth: CODEX_MASTER_SPEC.md v1.2, read completely on 2026-09-07.

| Phase | Status | Gate |
| --- | --- | --- |
| 0 — Reconnaissance | Tooling implemented; device evidence pending | Probe, call sequence, relay mapping, PIN/card findings |
| 1 — Core integration | Not started | Phase 0 evidence |
| 2 — Access backend | Not started | Verified credential and permission behavior |
| 3 — Admin panel | Not started | Backend and admin API |
| 4 — Events | Not started | Verified event behavior |
| 5 — Hardening | Not started | Nine-device soak and HACS install/upgrade acceptance |
| 6 — Optional future | Outside mandatory v1 | Follow-on work |

No release until required CI passes on the exact main commit.
A Phase 0 tooling prerelease must say HA setup/entities arrive in Phase 1.
Do not describe physical Phase 0, the full project or installation acceptance as complete.

Permanent requirements: camera in HA and panel; explicit relay selection enforced by backend/UI;
persistent offline sync/tombstones; secret redaction and administrator-only access management.
