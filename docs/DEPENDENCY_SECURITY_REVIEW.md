# Dependency security review — 2026-09-29

The release pipeline scans the complete installed Python dependency inventory
and runtime browser dependencies. Unreviewed findings fail the release. The JSON
audit artifact includes the original inventory and every reviewed finding;
`passed_with_reviews` must not be described as a vulnerability-free environment.

## Infrastructure-owned cryptography pin

The tested infrastructure version 2026.9.1 and current 2026.9.3 both require
`cryptography==48.0.1`. Forcing 50.x from a custom integration would violate that
shared runtime requirement and risk breaking other integrations. This release
keeps the existing pin; it does **not** patch the upstream library or claim that
other integrations using it are protected.

Evidence: [2026.9.1 requirements](https://github.com/home-assistant/core/blob/2026.9.1/pyproject.toml),
[2026.9.3 requirements](https://github.com/home-assistant/core/blob/2026.9.3/pyproject.toml).

The following findings are reviewed only for this integration's reachable code:

| Advisory | Affected API | Upstream fix | Integration exposure |
| --- | --- | --- | --- |
| [PYSEC-2026-3554 / CVE-2026-69248](https://github.com/pyca/cryptography/security/advisories/GHSA-m2h6-j472-rp4c) | X.509 name-constraint verification | 49.0.0 | No certificate-chain verification using cryptography |
| [PYSEC-2026-3553 / CVE-2026-69249](https://github.com/pyca/cryptography/security/advisories/GHSA-jwv3-5hgf-82ww) | X.509 certificate-chain building | 49.0.0 | No certificate-chain building using cryptography |
| [PYSEC-2026-3552 / CVE-2026-69247](https://github.com/pyca/cryptography/security/advisories/GHSA-g6cj-pr64-35w5) | PKCS#7 EnvelopedData decryption | 50.0.0 | No PKCS#7 or RSA decryption |

Our direct uses are AES-GCM and scrypt for authenticated encrypted backups,
and Ed25519 with raw-key serialization for signed archives. HTTPS verification
uses Python's standard SSL path through httpx, not cryptography's X.509 verifier.
The assessment is scoped to these integration paths, not the whole server.

`tools/audit_dependencies.py` accepts only these exact advisory IDs/aliases on
package `cryptography`, version `48.0.1`, until **2026-10-31**. A new vulnerability,
different version/package, expired review, failed scan, or changed direct
cryptography API imports blocks the check. Tests exercise each boundary.

Follow-up: review the upstream infrastructure pin before 2026-10-31 and upgrade
the shared dependency when supported. A future use of certificate verification,
PKCS#7, RSA, or any new cryptography APIs requires a fresh review. CI preserves
the findings even when this narrow review permits a release.

## Local development environment recheck — 2026-09-29

The full installed-inventory scan also found old development-environment copies
of aiohttp 3.13.3 and pip 25.0.1. They were updated locally to aiohttp 3.14.3 and
pip 26.2.1, then the strict scan returned `passed_with_reviews`, with no blocking
findings. No new advisory exemptions were introduced. This did not update the
live infrastructure server, change integration runtime requirements, or establish
that another installation has the same inventory. Each CI/runtime environment
must pass its own scan.

Primary release references: [aiohttp 3.14.3](https://github.com/aio-libs/aiohttp/releases/tag/v3.14.3)
and [pip changelog](https://pip.pypa.io/en/stable/news/).
