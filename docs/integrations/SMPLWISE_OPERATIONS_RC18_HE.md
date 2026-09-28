# מרכז תפעול והתחברות מערכת חיצונית — rc.18

ה־domain ונתיב ההתקנה נשארים `hikvision_intercom`. התוספות אינן מחליפות את
[המדריך המלא ל־VMS](SMPLWISE_VMS_ADDON_IMPLEMENTATION_GUIDE.md), אם הוא מותקן בסביבתך,
או את [קטלוג הפקודות שנוצר מהקוד](WISKEY_VMS_PANEL_COMMANDS.json).
מקור המימוש: `operations_api.py`, `operations_center.py`, `operations_runtime.py`
ו־`frontend/src/platform-center.ts`. אין צורך להעתיק מסד נתונים ל־VMS.

## חיבור והרשאות

השתמש בחיבור WebSocket הקיים `/api/websocket` ובתהליך האימות המתועד במדריך הראשי.
כל פקודות `platform/*` דורשות חשבון פעיל שהוא מנהל, ופעולות רגישות כפופות לנעילה
ולאימות נוסף כאשר המדיניות פעילה. טוקן רגיל של מפעיל אינו נותן הרשאה למרכז החדש.
שמור טוקן ומפתחות בשרת התוסף בלבד, מחוץ לדפדפן ומחוץ ללוגים. אין להניח שטוקן
Supervisor הוא טוקן משתמש מנהל; השתמש במסלול האימות המאושר של ההתקנה.

בקשה לדוגמה לאחר אימות:

```json
{"id": 101, "type": "hikvision_intercom/platform/get", "api_contract": 1}
```

התוצאה כוללת `revision`, קטלוג תחנות, הגדרות, שימוש באירועים, תצפיות ותוצאות.
היא אינה כוללת את מפתחות הארכיון או ה־webhook. `views`, `reports` ו־`report_runs`
מוחזרים רק לבעל החשבון. עדכן ממשק אחרי שמירה; `revision_conflict` מחייב טעינה וסקירה
חדשה. שינויי מסך אינם הרשאה: השרת בודק גם בקשות שאינן נשלחות מהפאנל.

## הפקודות החדשות

בכולן הקידומת `hikvision_intercom/`; מזהה WebSocket הוא מספר עולה, לא מזהה סקירה.
הטיפוסים והפרמטרים המדויקים נמצאים בקטלוג JSON המקושר.

| פקודה | שימוש |
| --- | --- |
| `platform/get` | הגדרות מותרות וקטלוג; אינו פותח מדיה |
| `platform/save`, `platform/delete` | שמירה/מחיקה עם revision; אוספים: stations/templates/views/reports |
| `platform/config_read` | קריאה בלבד ל־1–12 תחנות ולמזהה דלת מנוהלת |
| `platform/config_preview` | קריאה וסקירת שדות נתמכים; ללא כתיבה |
| `platform/config_apply` | review_id ואישור מפורש; תוצאה נפרדת לכל תחנה |
| `platform/retention_preview` | השפעת ימים/כמות/נפח ללא מחיקה |
| `platform/retention_apply` | החלת סקירה מאושרת; יכולה למחוק אירועים |
| `platform/archive` | ארכיון חודשי של אירועים שנשמרו, בחודש UTC |
| `platform/report` | הפקת דוח ששמור לחשבון מתוך views או reports |
| `platform/export` | ייצוא פרטי תפעול ותבניות בלבד |
| `platform/import_preview`, `platform/import_apply` | מיפוי תחנות מפורש, סקירה ואישור; אין כתיבה לציוד |
| `platform/webhook_save` | הגדרת יעד/סוגים/הפעלה; confirmed נדרש |
| `platform/webhook_key` | חשיפת מפתח למנהל עם אישור; אין לשמור בתצוגה |
| `platform/integrity` | מצב רכיבי האחסון; ללא תיקון או מחיקה |
| `platform/demo` | נתוני הדגמה סינתטיים ורשימת קבלה; אפס כתיבות לתחנות |

סקירות זמניות תקפות לחמש דקות, פעם אחת, לחשבון, לגרסת ההגדרות ולזהות התחנה.
שינוי זהות/מיפוי/ערך או פקיעת חלון תחזוקה מבטלים החלה. אין לבצע ניסיון חוזר של
כתיבה לאחר תוצאה לא ודאית בלי קריאה וסקירה חדשות. כשל תחנה אינו טענה שנכתב אליה
ואינו עוצר תחנות אחרות. עם אישור כפול פעיל, החלת הצי החדשה נחסמת.

ל־`platform/save` של תחנה, `record_id` הוא מזהה תחנה קיים ו־`values` הם:

```json
{
  "zone":"בניין א", "owner":"אחראי אחזקה", "tags":["ראשית"],
  "thresholds":{"offline":600,"sync_stalled":900,"event_gap":600},
  "window":{"enabled":false,"days":[0,1,2,3,4],"start":"08:00","end":"18:00","timezone":"Asia/Jerusalem"}
}
```

ימי השבוע הם 0=שני ועד 6=ראשון. חלון אינו יכול לחצות חצות. הספים בשניות.
זו מדיניות תפעול בלבד; היא אינה משנה את שעות הכניסה של אנשים.
דוח שמור כולל label/filters; סיכום מתוזמן כולל גם enabled/hour/timezone/days.
התזמון נבדק כל חמש דקות, פעם ביום בשעה שנבחרה, כל עוד חשבון היוצר הוא מנהל פעיל.
נשמר סיכום כמותי מקומי; לא נשלחת הודעה אוטומטית.

## אירועים בתשתית ו־webhook

אירוע `hikvision_intercom_operations_event` כולל version/id/kind/at/values.
אפשר להאזין לו בחיבור התשתית הקיים. ה־webhook הוא דרך חלופית, כבוי כברירת מחדל.
היעד חייב להיות HTTPS, ללא query, fragment, שם משתמש או סיסמה, בפורט 443 או 8443.
אין הפניות או ניסיונות חוזרים; עד 100 רשומות בתור וניסיון בודד לאירוע. שינוי
הגדרות מבטל רשומות ממתינות. אין הבטחת מסירה מלאה או סדר מוחלט.

סוגים ושדות מותרים בלבד:

- `access_event`: station_id/result/authentication/door/timestamp; אירוע חי בלבד.
- `security_denied`: command/code; ללא הגוף שנדחה; עד 60 דגימות בדקה.
- `configuration_result`: station_id/state/code; ללא הערכים שנכתבו.

אין שם אדם, טלפון, מספר עובד, קוד, כרטיס, תמונה, שמע או סיסמה בהודעות הללו.
תוצאה `delivered` פירושה תגובת HTTP מוצלחת מהמקבל, לא ביצוע פעולה במערכת המקבלת.
לפרטים נוספים השתמש בפקודות הקריאה הקיימות, תחת הרשאות נפרדות.

חתימה: HMAC-SHA256 עם מפתח hex בן 32 בייטים, על
`timestamp_utf8 + b'.' + raw_http_body`. אין לפרש ולהרכיב מחדש JSON לפני האימות.
כותרות: `X-Smplwise-Timestamp`, `X-Smplwise-Signature` (`sha256=...`),
`X-Smplwise-Event-Id`. המקבל חייב לדחות זמן ישן ולזהות מזהה שכבר התקבל.

```python
import hashlib, hmac, json
from datetime import UTC, datetime


def verify_notification(raw_body, headers, key_hex, seen_ids):
    if len(raw_body) > 16384:
        raise ValueError("message too large")
    at = headers["X-Smplwise-Timestamp"]
    when = datetime.fromisoformat(at)
    if when.tzinfo is None or abs((datetime.now(UTC) - when).total_seconds()) > 300:
        raise ValueError("expired timestamp")
    expected = (
        "sha256="
        + hmac.new(
            bytes.fromhex(key_hex), at.encode() + b"." + raw_body, hashlib.sha256
        ).hexdigest()
    )
    if not hmac.compare_digest(expected, headers["X-Smplwise-Signature"]):
        raise ValueError("invalid signature")
    body = json.loads(raw_body)
    identifier = headers["X-Smplwise-Event-Id"]
    if body["version"] != 1 or body["at"] != at or body["id"] != identifier:
        raise ValueError("envelope mismatch")
    if identifier in seen_ids:
        raise ValueError("duplicate")
    seen_ids.add(identifier)  # production: durable, bounded, atomic expiry cache
    return body
```

הקוד הוא דוגמת אימות, לא שרת HTTPS מלא. מטפל רשת צריך להגביל גודל/קצב ולשמור
מפתח וצבר מזהים בשרת. מקור API הספרייה: [Python hmac](https://docs.python.org/3/library/hmac.html).

## ארכיון, מדיניות והגירה

ארכיון כולל גוף, algorithm=Ed25519, public_key ו־signature ב־base64. החתימה היא
על JSON UTF-8 ממוין, ללא רווחים, `ensure_ascii=False`, של body בלבד.
`operations_archive.verify` מאמת חתימה, סכמת רשומה וחודש. מפתח מהקובץ מוכיח עקביות
בלבד; להגדרת מקור מהימן העבר trusted_public_key ששמרת בנפרד.
הארכיון מכיל רק רשומות שנשמרו. אינו מוכיח כיסוי מלא, אינו כולל מאגר אנשים או
מפתחות, ואינו גיבוי שרת. המדיניות מבוססת על זמן קליטה; החודש מבוסס על זמן האירוע ב־UTC.

קובץ העברת תפעול אינו מעביר חשבונות, הרשאות, אנשים, אישורי ספק או זהות תחנה.
מיפוי חסר/כפול נדחה. ייבוא מאושר מחליף את ספריית התבניות ומעדכן רק תחנות ממופות.
למעבר אנשים השתמש בגיבוי המוצפן הקיים; למעבר שרת נדרש גיבוי מלא נפרד.

## שימור מסכים קיימים

המסך החדש הוא כלי נוסף. לשחזור מסכי VMS המשך להשתמש בקטלוג הפקודות הקיים ובמדריך
המסכים הקודם. אין לשנות תחומי הרשאות, תורי סנכרון, טיוטות או מסלולי מדיה כדי
להציג מרכז זה. קישור `person_link` באירועים מוחזר למנהלים רק כשיש בעלים יחיד
שזוהה בתחנה לפני זמן האירוע. פתח `users/get` לפי המזהה; אל תחפש אדם לפי שם בלבד.
שליחת WhatsApp נשארת preview → עריכה → confirmed send.
