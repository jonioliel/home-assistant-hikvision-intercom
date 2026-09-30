# תוכנית ביצוע Akuvox תוך שמירת תאימות Arx

תאריך: 01.10.2026. סטטוס: תוכנית עבודה, ללא מימוש runtime במסירה זו. משלימה את התוכנית המפורטת; ההבהרות כאן קודמות להנחות רחבות יותר בה.

## גבולות הארכיטקטורה

WisKey נשארת אותה אינטגרציה: `hikvision_intercom`. Arx מדברת עם מודל WisKey אחיד; אינה שולחת פקודות Akuvox או ISAPI. provider נבחר לכל תחנה, לא לכל ההתקנה. אותה התקנה יכולה להכיל Hikvision ו־Akuvox עם יכולות שונות.

כיום runtime.py תלוי ב־HikvisionClient/StationProfile, וב־AccessClient ומימושי ISAPI אחרים; זו אינה החלפת client בשורה אחת. יש למפות גם coordinator, config flow, מצלמות, access sync, clocks, אירועים, media/audio/TTS ושגיאות. התחל בחוזה provider קטן ליכולות שכבר צריך, ולא בהמרה כוללת של כל מודל התחום מראש.

שכבות מוצעות: ליבת WisKey והרשאות → חוזה provider → Hikvision adapter / Akuvox adapter. providers אינם עוקפים permissions, station scopes, limiter, PanelSecurity, dual approval או audit. actor/via נשארים אחריות הליבה; יצרן תחנה אינו זהות מפעיל.

## שלבי עבודה ושערי קבלה

| שלב | תוצר | מה מוכיח קבלה |
|---|---|---|
| A0 | רשימת קריאות יצרן/תלויות ותסריטי baseline | מיפוי call sites, API/IDs/storage והרשאות; דגם+קושחה מוגדרים לפיילוט או marked unknown |
| A1 | provider facade ועטיפת Hikvision הקיים | התנהגות/serialization/IDs זהים; regression אמיתי לפעולות הקיימות, כולל ניתוק וניקוי |
| A2 | Akuvox experimental לקריאה בלבד | probe/health/מידע תחנה ויכולת snapshot/RTSP רק אם תועדו; fixtures ממקור מאומת, בלי כתיבת ציוד |
| A3 | config flow לבחירת יצרן ותחנות מעורבות | רשומות קיימות נשארות Hikvision בהיעדר provider; אין החלפת IDs או איבוד נתונים |
| A4 | אירועים וממסר פיילוט | אימות callback, dedup/time source, ממסר נבחר, אין retry אחרי אי־ודאות; פעולה פיזית רק בהסמכה מאושרת |
| A5 | אנשים/כרטיסים/PIN/לוח זמנים | CRUD+readback, partial failure, scopes ו־revision לפי דגם; לא להבטיח יכולת לא מתועדת |
| A6 | QR, SIP/talk/TTS ותכונות מתקדמות | הסמכה עצמאית לכל יכולת/קושחה; לא להפוך אותן לתנאי לפרסום שכבת קריאה ניסיונית |

ה־Definition of Done הרחב במסמך המקורי הוא היעד המלא, לא שער שחייבים לעבור כדי למסור פיילוט מצומצם. תכונה unsupported/unknown מוצגת בהתאם ולא מדמה הצלחה. אין כרגע דגם מוסמך.

## שמירת חוזה Arx

1. domain, נתיבי WS/HTTP/panel, embed-api-v1, מזהי תחנות/ישויות ושמות שירותים קיימים לא משתנים.
2. שדות קיימים שומרים משמעות/סוג/nullability. provider/model capabilities יתווספו בצורה תוספתית ומגורסה בלבד; אין שינוי שקט בפקודה קיימת כדי להכיל Akuvox.
3. UI ו־Arx שואלים capabilities והרשאות. אין הנחה שכל תחנה כוללת מצלמה, קול, שני ממסרים או users write. יכולת ופרטי מקור הם פר־תחנה.
4. D-006 מינימלי נשאר סגור; provider, call_state, firmware ושדות חדשים אינם נכנסים אליו אוטומטית. הרחבה דורשת schema review ומסירת CHANGES. תווית תחנה היא תווית תפעולית.
5. מקור וידאו וסודות נשארים בשרת. אין חשיפת RTSP דרך schema ציבורי ואין שינוי בחוזה descriptor שאינו קיים עדיין. SIP אינו ISAPI audio; בעלות/ביטול והרשאות נבדקים בנפרד.
6. כל פקודה חדשה משלבת request/result/error/event schemas, discovery לפי משתמש ומבחני allowed/denied. אין הצגת כתיבה בארקס על בסיס static catalog בלבד.
7. מפתחים Akuvox בנפרד מעבודת האצלה. חיבור יצרן חדש אינו היתר להוסיף native writes בארקס או לשנות D-004.

## שער לפני כל גרסת התקנה

- diff מול חוזה/קטלוג rc.37 המוצמד, כולל שדות מקוננים וסמנטיקה ידנית; הסרה או שינוי required מצריכים החלטת מיגרציה.
- Hikvision-only upgrade, התקנה מעורבת, תחנה offline, scopes/read-only/locked/redaction, event subscribe cancel והחלפת הרשאות.
- גרסת runtime עקבית ב־manifest/const/pyproject/build, tag+commit מדויקים; build מקורו באותו עץ.
- העברת Arx חדשה: CHANGES, סכמות/קטלוגים, capabilities חדשים, הוראות שדרוג והחזרה, מגבלות ומספרי בדיקות עם NOT_RUN מפורש.
- שחזור נתונים אינו הבטחה שקוד ישן יכול לקרוא סכמת אחסון חדשה. לפני מיגרציה: גיבוי HA/נתונים ואימות restore בגרסה הקודמת. אין migration irreversible סמוי.
- רק בעל תפקיד אחד מוציא tag/release; ענפי עבודה לא מעלים אוטומטית rc ולא מתקינים ציוד. branch docs הנוכחי אינו גרסה חדשה.

## תיקונים לתוכנית Akuvox המפורטת

נתיבי new_api והיכולות אינם אוניברסליים. לפני שימוש צריך לאמת תיעוד דגם/קושחה ותשובה אמתית; כתובת דוגמה אינה endpoint מאושר.

callback עם סוד בנתיב הוא חלופה מוגבלת לדגם שאינו יכול header authentication; יש להעדיף header כאשר נתמך, ולמנוע לוגי URL/סוד בכל hop. IP allowlist אינו אימות לבדו. שום endpoint callback חדש לא ממומש כאן.

אין כיום הבטחה ל־secret store חדש או audit בלתי ניתן לעריכה: אלו יעדים, לא תכונות קיימות. יש להשתמש במדיניות ההרשאות של WisKey, ולא להחליף את כל כתיבות המפעילים ב־admin-only בלי החלטה. rollback למיגרציה דורש restore מתועד, לא הנחה של down-migration אוטומטי.

## מקורות והמידע הדרוש לפיילוט

בתאריך01.10.2026 נבדק תיעוד Akuvox הרשמי ל־HTTP API ושילוב שרת מקומי: https://knowledge.akuvox.com/docs/integration-with-third-party-device-4 וגם https://knowledge.akuvox.com/docs/integration-with-third-party-device-23 . הוא מראה מסלולי אימות/שילוב, לא הסמכה לכל דגם. למימוש יש לקבע מקור מסוים לדגם, לשמור תאריך/קושחה וממצאי probe מסוננים.

דרוש מהבעלים בהמשך: דגם מלא, קושחה, יכולות יעד ראשונות, גישה מקומית לציוד וממסר בדיקה. פרטי גישה נמסרים בערוץ מקומי ואינם ב־Git. עד אז אפשר לבצע A0/A1 ולהכין fixtures מלאכותיים שמסומנים בבירור, בלי להכריז על תמיכת חומרה.
