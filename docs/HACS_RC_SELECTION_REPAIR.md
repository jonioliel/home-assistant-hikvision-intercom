# HACS RC selection repair — 2026-09-15

The owner reported `The version 2f6155c for this integration can not be used with HACS`.

Read-only inspection of the installed Home Assistant 2026.9.2 / HACS 2.0.5 instance found:

- WisKey prerelease visibility was disabled (`show_beta=false`).
- HACS listed no releases and presented the short default-branch commit as both installed and available.
- `hacs.json` was independently accessible for the short commit, main and `v1.0.0-rc.2`; the Home Assistant minimum-version requirement was satisfied.
- HACS source raises this particular message when it cannot obtain/parse the target HACS manifest. The original transient manifest-read failure was not reproduced; do not claim that short commit references are inherently invalid.

Repair used the installed HACS administrator API, scoped only to the WisKey repository:

1. Enabled prerelease visibility for WisKey.
2. Confirmed that the release list now contains `v1.0.0-rc.2` and the update targets that tag.
3. Downloaded that exact tag through HACS successfully.
4. Confirmed installed and available versions are `v1.0.0-rc.2`, `pending_upgrade=false`, and status is `pending-restart`.

Home Assistant was not restarted. No station settings or door commands were changed.
Temporary API sessions were revoked; credentials and tokens were not written to the report.
No runtime/package change or replacement release was necessary.

[HACS prerelease switch behavior](https://www.hacs.xyz/docs/use/entities/switch/)
[HACS 2.0.5 target-manifest validation](https://github.com/hacs/integration/blob/2.0.5/custom_components/hacs/repositories/base.py)

For RC updates, enable prereleases for this repository and select a published version tag.
A successful download still requires restarting Home Assistant before the new integration code runs.
