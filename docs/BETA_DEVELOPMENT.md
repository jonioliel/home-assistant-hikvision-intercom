# WisKey Beta — development delivery

Approved work: [40-task roadmap](ROADMAP_NEXT_40_HE.md), 10 September 2026.
Status: implementation in progress; no Beta artifact published yet.

## First delivery: user administration

Implemented roadmap items 01, 04, 05, 06, 07, 08 and 09:

- Typed profile fields (text, closed list, decimal number, date) and required fields. Browser and repository validate new/changed values. Unchanged legacy values remain readable and do not block revocation. A required definition does not retroactively delete or invalidate people.
- Bulk profile patches, group membership changes and reset of personal exceptions. Reviews show before/after, preserve other groups and credentials, and commit with durable operation receipts. Metadata-only changes do not queue device writes.
- Group policy impact review lists affected members, effective doors and preserved personal exceptions. It is bound to user revisions, policy revision and station configuration, expires after five minutes and must be explicitly applied when grants change. Renaming alone saves without a permission confirmation. A lost response can be checked using its receipt. A cancelled request still queues a committed policy change.
- Reverse permission directory by door, search and exception mode, 50 rows per page. Central desired access and applied revision are shown separately; this is not a device readback or proof of physical access.
- Onboarding templates hold profile defaults and groups only. Applying one modifies a new draft, replaces its profile/groups/exceptions, and never creates a person until Save. Templates cannot contain identity, credentials or photos.

## Persistence and upgrade

Access state migrates from schema 5 to **6** using the existing durable migration mechanism. Profile settings migrate from schema 1 to **2**, defaulting existing fields to optional text and templates to an empty list. Older clients omitting new field attributes or templates preserve them. Ownership, pending deletion journals and personal exceptions are preserved.

Restore a backup when rolling back to older code that cannot read schema 6. Do not replace the runtime with an old version against a migrated database. Large group-policy reviews are bounded at 10,000 managed people; this is a software review limit, not a claim about any station's capacity. Ordinary selected-user operations remain capped at 200.

## Validation during implementation

- Python: 971 passed in the full local suite, plus 95 focused checks after the final migration-corruption guard.
- Browser: existing profiles/groups and new permission report verified at 360/768/1440 pixels in Hebrew. All five new permission/onboarding browser checks passed; final release suite pending at this checkpoint.
- TypeScript and strict Python type checks passed.
- Real HA transport tests added for policy reviews, receipts and permission directory; run by Linux CI.

No physical acceptance was inferred from these tests. Core acceptance remains 31/38; speaker audio, ringing/validity and fleet acceptance remain in [deferred validation](DEFERRED_VALIDATION.md). The other roadmap tasks are still open, not represented as complete by this delivery.
