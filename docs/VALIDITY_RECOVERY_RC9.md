# User validity recovery in RC9

## Problem

A station can echo timestamps containing a UTC offset while labelling Valid.timeType as local. Strict normalization correctly refuses to infer enforcement from that contradictory response, but previously it also blocked the user's later request to remove the expiry. A failed schedule deployment could write an expired interval that triggered the same secondary failure and hid the original schedule error.

## Recovery boundary

Normalization remains strict for unknown records. The reconciliation engine may recognize an exact UTC echo only when the whole managed person-and-card fingerprint matches the existing ownership binding or durable write intent. Only the contradictory label is varied for that comparison; changed names, permissions, credentials and validity endpoints are not ignored. This proves ownership, not enforcement.

A new explicit permanent-access request can then write Valid.enable=false and verify it. Timed access instead uses a fresh measured station clock to convert absolute requested timestamps to offset-free local timestamps, followed by exact readback. The device's rules at each endpoint are used; ambiguous DST folds/gaps and untrusted clocks stay blocked. Timing status retains absolute instants. Failure to deploy a schedule writes an expired local interval so the primary failure remains visible.

## Upgrade

Install RC9 and restart Home Assistant. Keep the user's intended validity selection and request synchronization. An exact journal-proven echo is repaired automatically. Do not delete/recreate users or clear ownership records to bypass a conflict. A genuine external modification or unsupported native plan still needs separate resolution.

## Validation boundaries

Regression tests cover cancellation, changed external records, local rewrite, minimal later edits, summer/winter conversion and DST ambiguity. Physical inside/outside access acceptance remains a separate test. Private live investigation records are not published with this report.
