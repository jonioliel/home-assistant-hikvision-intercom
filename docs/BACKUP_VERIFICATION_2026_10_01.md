# Git backup verification · 2026-10-01

- Remote branch: codex/akuvox-arx-continuity.
- Artifact commit verified: 52605b1620a36d00ec751f876765c64c03d60488.
- Fresh shallow clone fetched from origin into an ignored verification checkout.
- All666 artifact paths in BACKUP_ARTIFACT_MANIFEST.json existed and matched SHA-256 exactly; zero mismatches. Total original artifact bytes70,919,348.
- Remote branch head matched the local commit after push.
- custom_components/, frontend/ and pyproject.toml unchanged relative to origin/main. No runtime release or live deployment.
- Historical handoff/design bytes preserved by path-specific Git attributes; catalogs' published hashes remain intact across checkout.
- No full runtime/hardware tests were needed/run for the documentation backup. Preliminary credential-pattern scan of selected text and ZIP text found no matches; this is a heuristic, not an exhaustive secrets audit.
- Remaining untracked .codex-remote-attachments contains a personal photograph intentionally excluded. Ignored private/credentials/HA data/environments and full Codex conversation history are not backed up by this branch.

This evidence file is added after the verified artifact commit; it does not change the artifact manifest or runtime.
