# CSV and activity reports — introduced in 0.11, updated for 0.14

These Phase 6 features use the existing central database, synchronization engine and retained
normalized event cache. They introduce no ISAPI endpoint. All five WebSocket commands require
an administrator and retain request limiting and payload redaction.

## Import a CSV file

In **Users → Import CSV**, download the blank template or export the current users. Save a
comma-separated UTF-8 file (BOM accepted), select it, choose the mode, and **Preview changes**.
Inspect names, changed fields, target stations, credential counts and access-removal warnings.
Use **Apply & sync batch** and confirm only when the preview matches the intended changes.

- **Create new users only** is the default; any existing employee ID is an error.
- **Create and update matching employee IDs** explicitly updates central records with that ID.
  It does not adopt or authorize overwriting an unmanaged device record. Device conflicts still
  require the separate inventory/review workflow.
- Maximum 500 data rows and 256 KiB per file. Large files must be split deliberately.
- Required headers are `employee_no,display_name`. Optional headers are below. Header spelling
  is exact; duplicate/unknown headers, malformed quotes/JSON and duplicate IDs are rejected.
- Optional missing columns and blank optional cells preserve an existing field. For a new user,
  defaults apply: active, permanent, no PIN/cards/assignments. Blank does **not** remove a credential.
- One error blocks the entire batch. A changed file, mode, central state or captured station
  configuration requires another preview. A preview is not a capacity reservation.

| Column | Meaning |
| --- | --- |
| `employee_no` | Stable exact employee identifier, required; preserve leading zeros and case. |
| `display_name` | Required name; subject to central and observed station limits. |
| `active` | Literal `true` / `false`; false revokes station access while retaining the central user. |
| `valid_from`, `valid_until` | Both ISO timestamps with explicit timezone, or `CLEAR` in both cells for permanent validity. An omitted/blank pair preserves existing dates. |
| `pin` | Set digits, or `CLEAR` to remove. An empty cell preserves the current PIN. It never appears in preview/export. |
| `cards` | JSON array of exact string card numbers, replacing the card set; `[]` removes all. Retained numbers preserve their ID, label and enabled state; new ones are normal enabled cards. |
| `stations` | JSON object mapping station ID or unique exact name to true/false; replaces assignments. `{}` removes all. The dialog lists IDs/names. IDs win over matching names; ambiguous names/duplicate aliases are rejected. |

Use a CSV-aware editor to quote JSON cells. For example, the cell value `{"Front":true}` is
encoded in CSV as `"{""Front"":true}"`. Only the configured physical lock 1 is assigned.
Store employee IDs and card numbers as **text** in spreadsheets; Excel's automatic numeric
conversion can remove leading zeros or round long numbers before the integration sees them.

Validation checks the complete resulting central state, including credential uniqueness and
pending old-credential reservations. The complete batch is saved once before queues are requested,
with one request per affected station. A failure before successful storage publishes no rows.
Cancellation during CPU preparation publishes nothing; if storage has already started, the
existing cancellation-safe transaction finishes before releasing the storage lock. If the
connection is interrupted during apply, inspect Users/Sync and preview the file again rather
than assuming nothing was saved.

The durable save is atomic **centrally**. Stations reconcile independently and may be offline,
full, conflicted or reject firmware-specific fields. Readback/conflict guards still apply; an
HTTP acknowledgement is not physical credential acceptance. Removed/replaced credentials remain
reserved until affected stations confirm removal. Timed-validity timezone errors are not bypassed.
New unmanaged station identities require explicit adoption, even when their employee ID matches.

The browser clears the selected content when the dialog closes, the panel disconnects or admin
permission is lost. The server does not store the uploaded CSV as a file or echo it in errors/logs;
successfully applied credentials are stored in the existing private HA access database. The file
on the administrator's own computer is not deleted by the integration.

## Export central users

**Users → Export users CSV** exports employee IDs, names, active state, dates and assignment IDs.
PINs and card numbers are deliberately absent; the file is not a complete credential backup.
Re-importing an unmodified normal export in update mode leaves credentials unchanged and avoids
no-op revision increments. Disabled assignments remain represented. A removed station ID needs
review before importing into a different installation.

CSV output is UTF-8 with BOM and quoted cells. Potential spreadsheet formulas are prefixed with
an apostrophe, including leading-whitespace variants. A formula-looking name can therefore gain
an apostrophe on re-import; inspect the preview before applying. No CSV format can prevent a
spreadsheet from coercing identifiers when the administrator chooses numeric columns.

## Activity reports and filtered export

In **Events**, set the desired station/user/result/method/date filters and click **Apply filters**.
Then choose **Generate report** or **Export filtered events CSV**. The report uses all matching
records in the cache, including pages not loaded in the browser. Editing filters without applying
them does not change the selected query. Applying new filters clears the previous report.

Reports show generation time, totals, authentication results/methods, station breakdown and station-local
calendar-day groups. Unlocking records are separate from authentication so one access operation
is not automatically counted twice as two authentications. Counts are event records, not distinct
people, visits, attendance or proof that a door physically moved.

The cache retains at most 5,000 records for 30 days. A report neither downloads more history nor
infers missing events. Recovery, incomplete/unsupported history and storage warnings remain visible.
Zero matches means no retained match. From 0.14 daily boundaries follow each record’s station
display zone; fleet daily rows can combine different UTC intervals. Date filters use the selected
station zone, or the HA zone for all stations, and are converted to UTC for querying. Stored
timestamps and time-source information are preserved. Reports are snapshots and are regenerated
explicitly. See [time zones and DST](TIME_ZONES.md).

Exported rows contain timestamp, station, employee ID, person name, event type, authentication,
result, door, masked card suffix, recovery flag and time source. From 0.14 they also append
display_timestamp (ISO with offset) and display_timezone, preserving the original timestamp.
They can contain personal names
and identifiers; they never contain PINs, full card numbers or raw device responses. The export
is an administrator download, not the pseudonymous Sync diagnostics support report.

Late responses after an applied-filter change, loss of admin access or panel disconnection are
discarded, including downloads. This behavior and Hebrew/mobile layout are covered by browser tests.

[Deferred physical validation](DEFERRED_VALIDATION.md) · [Event contracts](EVENTS.md)
