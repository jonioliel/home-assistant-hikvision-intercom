# WisKey Beta — development delivery

Approved work: [40-task roadmap](ROADMAP_NEXT_40_HE.md), 10 September 2026.
Status: local **0.33.0-beta.1** release candidate; no Beta artifact published yet. Publication requires the final Linux/HA/HACS gates. Public runtime remains 0.32.1-alpha.1.

## First delivery: user administration

Implemented roadmap items 01, 04, 05, 06, 07, 08 and 09:

- Typed profile fields (text, closed list, decimal number, date) and required fields. Browser and repository validate new/changed values. Unchanged legacy values remain readable and do not block revocation. A required definition does not retroactively delete or invalidate people.
- Bulk profile patches, group membership changes and reset of personal exceptions. Reviews show before/after, preserve other groups and credentials, and commit with durable operation receipts. Metadata-only changes do not queue device writes.
- Group policy impact review lists affected members, effective doors and preserved personal exceptions. It is bound to user revisions, policy revision and station configuration, expires after five minutes and must be explicitly applied when grants change. Renaming alone saves without a permission confirmation. A lost response can be checked using its receipt. A cancelled request still queues a committed policy change.
- Reverse permission directory by door, search and exception mode, 50 rows per page. Central desired access and applied revision are shown separately; this is not a device readback or proof of physical access.
- Onboarding templates hold profile defaults and groups only. Applying one modifies a new draft, replaces its profile/groups/exceptions, and never creates a person until Save. Templates cannot contain identity, credentials or photos.

## Second delivery: media, user views and CSV

Implemented software items 02, 10, 11, 16, 17, 19 and 37:

- Named views store filters, sorting and custom-column visibility/order per HA administrator in the current browser. Core identity/actions remain visible; renamed fields resolve by stable ID. Stale concurrent browser preference writes require reloading the preferences.
- CSV inspection returns headers only. Explicit mapping binds source columns to canonical fields and optional custom-field IDs. Unknown/duplicate destinations, ambiguous groups/stations and mixed absolute/personal permissions are rejected. A mapping change invalidates the review. Export keeps group memberships and exceptions separate; metadata-only imports do not queue device writes. Independent cell failures are collected with row/canonical-column codes, without values. Original atomic 500-row/256-KiB limits remain; resumable chunked imports (12) are not included.
- Four/nine live camera wall with an explicit start, stream budget, fixed selected order and offscreen cleanup. Enlarging one view suspends the wall. This has synthetic browser budget coverage, not nine-camera physical performance acceptance.
- A playback watchdog watches decoded-frame progress (or current time where unavailable). After 12 seconds without progress it permits two reconnects, then configured HLS fallback or manual retry. Paused/hidden video does not trigger recovery. No access/audio action is generated.
- Per-user microphone choice and an explicit local, non-transmitting input meter. The local test stops after 60 seconds, on backgrounding/device loss or lifecycle change; late permission streams close. Browser device IDs stay in local preferences and do not enter diagnostic exports. Based on [media device enumeration](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices), [exact device constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/deviceId) and [decoded frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
- USB keyboard-reader input is scoped to a password field. Enter opens a masked review; explicit use adds an exact identifier to the draft and the existing Save persists it. Input over 32 characters is rejected rather than truncated; no global keystroke capture, inferred byte-order conversion or reader-wide compatibility claim.
- Cancelled group/bulk replies still schedule already-committed work; policy reviews identify a station whose driver remains attached but status is offline. A closed manager leaves durable intents for restart.

## Third delivery: activity reports

Implemented software items 13 and 14. Current group and exact profile-value filters apply consistently to the paginated event list, aggregate, CSV and full print output. A detached membership index joins only a station/employee identity with observed ownership before the device timestamp; missing identities, receipt-time substitutions, old unobserved bindings and wrong stations remain excluded. A current filter never claims historical membership.

Up to twenty named query templates per HA administrator/browser retain applied filters and absolute time ranges, without caching event records. Removed groups/fields/stations cannot silently broaden a saved query. The print endpoint includes every matching retained row (maximum 5,000), original and station-display timestamps, and completeness warnings. Preview HTML escapes data, loads in a sandbox without scripts/network and supports the browser print/PDF dialog. Resetting filters or changing the actor invalidates old printable data.

Research item 40 is delivered in [mobile credential feasibility](MOBILE_CREDENTIAL_FEASIBILITY_HE.md). Items 18/27/39 have new [read-only evidence](BETA_CAPABILITY_CHECKS_HE.md), not new support flags. Sixteen software items plus this feasibility decision are not completion of the forty-task roadmap.

## Persistence and upgrade

Access state migrates from schema 5 to **6** using the existing durable migration mechanism. Profile settings migrate from schema 1 to **2**, defaulting existing fields to optional text and templates to an empty list. Older clients omitting new field attributes or templates preserve them. Ownership, pending deletion journals and personal exceptions are preserved.

Restore a backup when rolling back to older code that cannot read schema 6. Do not replace the runtime with an old version against a migrated database. Large group-policy reviews are bounded at 10,000 managed people; this is a software review limit, not a claim about any station's capacity. Ordinary selected-user operations remain capped at 200.

## Validation during implementation

Local Python validation passed **994 tests** in 108.67 seconds, including 500-row CSV create/update, schema migration, large group-policy receipts and conservative membership joins. Ruff checks/formatting, strict mypy (62 configured source files), TypeScript and source formatting pass. Compilation of the HA modules/tests also passes; compilation does not replace the Linux HA runtime suite.

The final full browser suite passed **352 tests** in 6.3 minutes. Rebuilding after source formatting produced the identical tested panel bundle (`03d5fd71c830f5c212e03d8fef2e20d834ae6ce6cdeeef62752264b537b0dc8c`). Focused tests cover RTL and 360/768/1440px layouts, multi-camera budgets, microphone lifecycle, video stalls, saved views, explicit USB confirmation, exact current-membership queries and all-record print output with escaped untrusted names. The print test invokes the frame's print action; it does not certify every external printer/PDF destination.

During implementation, a full Python run concurrent with browser load hit the existing 30-second loopback audio deadline. The isolated exercise and the final sequential full Python suite passed; no timeout threshold was relaxed. Browser tests found an outdated tool count and exact accessible-label mismatches, both corrected. Report tests also corrected the synthetic administrator storage key. Final results below supersede those intermediate failures.

Real HA transport tests were added for policy reviews, receipts, directory, CSV mapping and current-membership/print APIs. They require Linux CI and have not yet run for this candidate. HACS/Hassfest and publication are likewise pending; earlier published release results do not validate this candidate.

No physical acceptance was inferred from local tests. Core acceptance remains 31/38; speaker audio, ringing/validity and fleet acceptance remain in [deferred validation](DEFERRED_VALIDATION.md).

## Publication status

The first implementation commit is `edf4b4885afe194b5fb10d7e8c55df6c1cd48696`; the complete candidate is retained on the local `codex/wiskey-beta-development` branch. Neither has been pushed. Automatic approval review rejected the public push even after origin and public repository metadata were verified and a private-value scan passed. The owner's explicit confirmation of the exact public destination is pending. No alternate publication path was used. After authorization, Linux/HA, HACS and Hassfest must pass on this candidate before the release workflow may publish it.


Release validation follow-up: the first GitHub HA run passed 311 cases and found one incorrect test expectation for a list-valued station ID. The directory correctly rejects it with the existing `invalid_text` validator code. The test now expects that exact code; production validation is unchanged. HACS, Hassfest, both Python jobs and all browser cases passed on that checkpoint. The complete release workflow still gates publication.
