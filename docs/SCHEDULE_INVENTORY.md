# בדיקת התאמת תוכנית לתחנה — 0.15.0-alpha.1

המסך משווה את טיוטת השעות הנבחרת למגבלות שהתחנה מפרסמת וקורא סיכום של רשומות
התזמון הקיימות. הוא אינו שומר את הטיוטה, מקצה משאבים, משנה הרשאות או מחיל שעות בדלת.

## שימוש

1. פתחו **תוכניות שעות**, טענו טיוטה או הכינו תוכנית חדשה עם שם וחלונות תקינים.
2. בחרו תחנה מקוונת באזור בדיקת התחנה ולחצו **בדיקת התאמת הטיוטה**.
3. בדקו את מספר החלונות הנדרש לעומת המגבלה שפורסמה, דיוק השעות וימי השבוע הנתמכים.
   הבדיקה כוללת גם שינויים שטרם נשמרו. חריגה מוצגת בנפרד ממידע שאינו ידוע.
4. עיינו בספירות התבניות, השבועות, קבוצות החגים והחגים. בדיקה חלקית או כושלת נשארת
   מסומנת כך; רשומות כבויות אינן מקומות פנויים. היעזרו בכפתור הורדת דוח ההתאמה לתיעוד.
5. לאחר עריכה או החלפת תחנה יש להריץ שוב. תוצאה מבקשה קודמת אינה מוצגת עבור הטיוטה החדשה.

״בתוך המגבלה שנבדקה״ מתייחס רק לסעיף הנבדק. הבדיקה אינה מאשרת גבולות תאריכים,
מגבלות שמות, את כל מגבלות רשימות ההפניה, קדימות חגים בקושחה, קבלה פיזית או מקום פנוי.
מספר החגים שניתן להפנות אליהם מתוך קבוצה עדיין אינו מאומת ומוצג כלא ידוע.
תוצאת ההתאמה אינה מפעילה כפתור שיוך או כתיבה. [עריכת טיוטות](ACCESS_SCHEDULES.md).

הבדיקה מוגבלת בזמן ורצה בנפרד מתור התקשורת הרגיל של התחנה. אפשר להמשיך להשתמש
במסכים ובדלתות האחרות. מעבר מהטיוטה עדיין מכבד את ההתראה הקיימת על שינויים לא שמורים.
אחת מבדיקות המוכנות/ההתאמה יכולה לרוץ לכל תחנה ועד שלוש בצי. נדרשת הרשאת מנהל.

## ראיה מהמכשיר

ב־2026-09-09 נבדק לקוח הקוד החדש מול DS-KV6124-E1, קושחה V3.9.0 build 260115,
לאחר אימות זהות התחנה. לא נכתבו תוכניות, משתמשים, PIN, כרטיסים או שעון ולא הופעל מנעול.

| סוג | נקראו / דווחו | פעילות / כבויות ברשומות שנקראו | מצב |
| --- | --- | --- | --- |
| תבניות הרשאה | 255 / 255 | 0 / 255 | החיפוש הושלם |
| תוכניות שבועיות | 255 / 255 | 0 / 255 | החיפוש הושלם |
| קבוצות חגים | 64 / 64 | 1 / 63 | החיפוש הושלם |
| תוכניות חג | 300 / 1024 | 0 / 300 | חלקי: מגבלת מיקום חיפוש |

255 מזהי שבוע הופיעו בהפניות מתבניות, גם כשהתבניות כבויות. ספירת ההפניות כוללת רק
מזהים שנמצאו ברשומות שנקראו; לא נקראו שיוכי משתמשים ולא נקבעה בעלות על אף משאב.
רצף עמודים אינו תמונת מצב אטומית: שינויים חיצוניים בזמן הסריקה עלולים שלא להתגלות
גם כאשר הספירה הכוללת לא השתנתה. לכן תוצאה מלאה אינה בסיס להקצאה או לדריסה.

[דגימות מסוננות](../tests/fixtures/schedule_search_readonly.json) מכילות רק מזהי משאבים,
מצבי enable, הפניות וספירות. שמות, חלונות, תאריכים, כתובות וזהויות פרטיות הושמטו.
הדוח המוחזר לממשק מצומצם עוד יותר לספירות, יכולות וקודי שגיאה; הוא אינו מכיל רשומות גולמיות.

## Verified firmware search contract

The template route and request shape were found in the commissioned station's own browser
client; the route map exposed the other three search operations. Read-only live requests
then verified all four request/response shapes. Manufacturer source assets remain private.
This is evidence for the observed firmware, not an assumed contract for every Hikvision model.

| Resource root under `/ISAPI/AccessControl/` | Search capability flag | Record identifier |
| --- | --- | --- |
| `UserRightPlanTemplate` | `isSupportSearchUserRightPlanTemplate` | `planTemplateID` |
| `UserRightWeekPlanCfg` | `isSupportSearchUserRightWeekPlan` | `weekPlanID` |
| `UserRightHolidayGroupCfg` | `isSupportSearchUserRightHolidayGroup` | `holidayGroupID` |
| `UserRightHolidayPlanCfg` | `isSupportSearchUserRightHolidayPlan` | `holidayPlanID` |

Both the base operation and search flag must explicitly advertise support. The reader gets
`<root>/capabilities?format=json` and `<root>/Search/capabilities?format=json`, then performs
read-only `POST <root>/Search?format=json`. The observed top-level request is:

```json
{"searchID":"<32 hex characters>","searchResultPosition":1,"maxResults":50,"enable":false}
```

The actual response has top-level `responseStatus`, `totalMatches`, `numOfMatches` and
`matchResults`; it does not echo searchID. An echo, if present, must match. Observed terminal
statuses are `OK` and `NO MATCH`; `MORE` advances by the returned count. Duplicate IDs,
inconsistent totals, invalid counts/types, an empty MORE page and early terminal responses
are rejected. Raw device strings are never returned as errors. The query enable=false is
preserved as observed: it returned an enabled holiday group, so it is not interpreted as a
disabled-only filter. No alternative filter is used to claim complete coverage of unknown modes.

Live search capabilities advertise searchID length 1–32, position 1–256, page size 1–100,
and boolean enable options. The integration caps pages at 50 records and 32 pages, enforces
advertised bounds, response size limits and a 60-second overall read deadline. The live scan
made 29 capability/search calls after the separate identity confirmation: 1 general capability,
8 resource/search capabilities and 20 search pages. On holidays the next start would be 301,
outside 1–256, so the scan stops at 300 with `schedule_search_bound`. No undocumented request
beyond the bound is sent. A failed authentication/connection stops remaining requests.

Direct per-ID GET samples still return device statusCode 3. The Search path provides a verified
read alternative without explaining that rejection or proving a write contract. Empty/disabled
records, default-looking identifiers and successful reads never authorize mutation.

## המשך הפיתוח

צריך להשלים קריאה מלאה בגבולות מאומתים, חוזה כתיבה וקריאה חוזרת, יומן בעלות והקצאה
עמיד, טיפול בשינוי חיצוני ובהתאוששות ושיוך RightPlan למשתמש בדיקה. אחריהם נדרש אימות
פיזי של חלונות שבועיים, חגים וגבולות זמן. [יומן המשך](DEFERRED_VALIDATION.md).
שתי תכונות השעות ב־Phase 6 נשארות חלקיות; מדידת הקבלה המחייבת נשארת 28/38 (73.7%).
