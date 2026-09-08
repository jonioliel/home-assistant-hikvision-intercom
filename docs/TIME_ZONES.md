# Station time zones and daylight saving — 0.14.0-alpha.1

## שימוש בעברית

ברירת המחדל היא תצוגת שעות לפי אזור הזמן וכללי שעון הקיץ שנקראו מכל אינטרקום.
שינוי אזור הזמן של המחשב או הטלפון אינו משנה את השעה המוצגת של התחנה.

- לאחר עדכון ב־HACS והפעלה מחדש של Home Assistant, פתח **ניהול אינטרקומים → אינטרקומים**.
  לכל תחנה מופיע אזור **שעון התחנה ותצוגה**: מקור אזור הזמן, דגימת שעון המכשיר,
  היסט UTC, מועד הבדיקה והפרש משוער מול HA. אפשר ללחוץ **קריאת שעון התחנה** לרענון.
- לבחירה ידנית: **הגדרות → מכשירים ושירותים → Hikvision Intercom → אפשרויות התחנה**.
  בחר מקור תצוגה ידני והזן שם IANA, לדוגמה `Asia/Jerusalem` או `UTC`. שמירת האפשרויות
  טוענת מחדש את התחנה. לחזרה לברירת המחדל בחר שוב לפי המכשיר.
- אזור הזמן חל על אירועי התחנה, פתיחות, קריאות אחרונות ודוחות. ליד כל חותמת מוצג ההיסט
  המתאים לאותו תאריך, לדוגמה `UTC+03:00` או `UTC+02:00`.
- בטופס תוקף משתמש אפשר לבחור תחנה, אזור HA או UTC. ברירת המחדל היא התחנה הראשונה
  המשויכת למשתמש, ובהיעדרה התחנה המנוהלת הראשונה. בטבלת המשתמשים המרכזית התוקף מוצג
  לפי אזור HA שמצוין במפורש, משום שאותו משתמש יכול להשתייך לתחנות באזורים שונים.
- מסנני האירועים משתמשים באזור התחנה שנבחרה; סינון של כל התחנות משתמש באזור HA.
  שעה מקומית שאינה קיימת בקפיצה לשעון קיץ או שמופיעה פעמיים בחזרה לשעון חורף נדחית.
  יש לתקן/לנקות שדה שגוי לפני החלפת אזור. לבחירת רגע במדויק אפשר לבחור UTC ולהזין אותו שם.
- המערכת קוראת את הגדרות השעה אחת ל־15 דקות. בכשל מאוחר היא מציגה אזהרה ושומרת על הכללים
  האחרונים שנקראו בהצלחה; לפני קריאה תקינה ראשונה משתמשת ב־UTC ומציינת זאת במפורש.

זהו תיקון התצוגה והמרת קלטי הזמן. הוא אינו משנה את שעון האינטרקום, שרת NTP או הגדרות
שעון הקיץ בציוד. חסימת סנכרון תוקף במקרה של סתירה בתשובת המכשיר נשארת פעילה.
בדיקת חלון הרשאה פיזי לפני/בתוך/אחרי התוקף עדיין נדרשת בנפרד.

## Protocol and evidence

The supplied ISAPI_IP Series_Pro Series.pdf, pages 14–15 (date/time semantics), 42–43
(clock and zone workflows) and 299–300 (Time API), documents the source contract. Its original
private copy remains outside Git. GET /ISAPI/System/time returns localTime with an offset;
ISAPI timestamps can also be UTC (Z). The integration respects the supplied offset and does
not assume every response is UTC or add a source offset twice.

A GET-only read of the commissioned DS-KV6124-E1, V3.9.0 build260115, returned:

```text
localTime: 2026-09-09T00:08:10+03:00
timeMode: NTP
timeZone: CST-2:00:00DST01:00:00,M4.1.0/02:00:00,M10.5.0/02:00:00
```

The sanitized fixture is tests/fixtures/device_clock_readonly.json. A second read through
ClockClient with expected identity returned 00:30:28+03:00 and rounded skew 0 seconds.
This is a read-time estimate, not a precision NTP measurement or a witnessed DST transition.

The device string defines base UTC+02:00, a one-hour daylight increment, April's first
Sunday at 02:00 for start, and October's last Sunday at 02:00 for end. The standard sign
and DST increment follow Hikvision's documented convention. The Mmonth.week.weekday
calendar uses Sunday zero and week five as the last occurrence, following the
[GNU/POSIX TZ calendar convention](https://sourceware.org/glibc/manual/2.28/html_node/TZ-Variable.html).
This interpretation is tested at both boundaries; the actual future firmware transition
remains a commissioning check. It is not evidence of support for arbitrary Hikvision models.

An offset cannot identify an IANA zone. We retain the device's actual rules rather than map
UTC+02:00 to Asia/Jerusalem. For example, the two rule sets differ on 28 March 2026. A manual
Asia/Jerusalem selection intentionally uses the IANA rules instead. Manual zones are validated
with HA's timezone database; the browser uses Intl for named-zone presentation. Keep HA and
browsers updated when civil timezone rules change.

## Data and lifecycle

- Device reads use a separate optional request lane with a 20-second deadline, coalesced refresh
  and a 900-second timer. Unload cancels the request and timer. Clock failure does not hold the
  call/release lane. No /System/time or /timeZone PUT endpoint is used.
- UTC storage, event identity/deduplication and access reconciliation are unchanged. Naive event
  timestamps retain the existing receipt-time fallback; they are not silently assigned UTC.
- Overview, event rows and station review timestamps use the station display zone. Central user
  validity and report-generation timestamps use explicitly labelled HA time. Existing known
  instants retain seconds and the selected side of a repeated DST hour when the field is unchanged.
- Activity report daily buckets use each record's station display zone. A multi-station daily row
  can therefore combine several local calendar days, not one shared UTC interval. Filter boundaries
  remain absolute UTC instants. CSV appends display_timestamp (ISO with offset) and display_timezone;
  the original timestamp column is preserved. User CSV continues to require offset-aware dates.
- Unsupported/contradictory device clock responses leave the last verified rules marked stale,
  or explicit UTC before a valid read. A manual zone remains usable. Browser inability to format
  a named zone falls back to an explicitly labelled UTC timestamp; invalid local input is not saved.
- Rules are refreshed on load and in memory, not stored as historical configuration. Historical
  records use the current rules for their own date, including that date's seasonal offset. A past
  change to a device's DST configuration cannot be reconstructed from the current Time response.
- Weekly/holiday draft preview remains a local calendar preview; clock support does not enable
  station schedule writes or prove physical credential enforcement.

The observed access-record validity contradiction (timeType local with +00:00 readback after
UTC writes) is a separate contract issue. validity_timezone_mismatch remains enforced until
[HW-VALIDITY](DEFERRED_VALIDATION.md) verifies write/readback and physical acceptance.
