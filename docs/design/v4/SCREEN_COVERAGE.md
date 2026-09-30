# כיסוי מסכי WisKey — הצעת עיצוב 04

בסיס: 1.9.3. כל שורה היא תמונת מחשב בבהיר ובכהה, גם אם במוצר היא לשונית או מצב ולא דף עצמאי. מקורות front-end נמצאים תחת `frontend/src/`; שמות API בטבלה הם עוגני חיפוש קיימים, לא API חדש.

| מסך / קובץ PNG | עוגן במוצר | יכולות לשימור | כלל קבלה חשוב |
|---|---|---|---|
| overview | panel.ts; access-overview.ts; live-clock.ts | סקירה, חיבור, צלצול, ממתינים, פעולות דלת ופעילות | פקודה אינה מצב דלת; busy נפרד לכל ממסר; שעה חיה |
| overview-12 | camera-wall.ts; panel.ts; camera.ts | קיבולת, עימוד, חיפוש, מסך מלא ויחס תמונה | 1–X תחנות; 12 הוא גודל תצוגה; thumbnails אינם זרמי וידאו |
| people | panel.ts; user-filters.ts; saved-user-views.ts; phone.ts | רשימה, תמונה, שדות, נייד, קבוצות, חיפוש, תצוגות, paging ובחירה | server paging 25/50/100/200 נשמר; אין בחירה משתמעת של כולם |
| person | user-details.ts; panel.ts | זהות, תמונה, פרטים, הרשאות, תוקף, פעילות והודעות | תצוגה נפרדת מעורך; כל הדלתות בדוגמה גלויות במחשב |
| person-edit | panel.ts; profile-fields.ts; user-photo.ts | שם, מזהה, נייד, שדות, מצב, קבוצות, תוקף ופעולות ניהול | draft ו־revision יחידים; ללא שמירה אוטומטית |
| person-access | panel.ts; types.ts | ירושת קבוצה, אישור/חסימה אישית, בחירת ממסר | לא להמיר קבוצות לתפקיד HA; חריג אישי נשמר |
| person-timing | user-timing.ts; timing-validity.ts; panel.ts | ימי שבוע, שעות/כל היום, זמן מקומי, HA/תחנה ותצוגה מקדימה | אכיפה נבדלת משמירה; אזהרת זמינות HA |
| person-dates | user-timing.ts; timing-validity.ts | תאריכים מסוימים וחלונות זמן | שמירת תוקף כללי; אין לוח מדומה שמוצג כנאכף |
| person-always | user-timing.ts; panel.ts | הסרת הגבלת ימים ושעות | הסרת תאריך תפוגה רק בבחירה מפורשת |
| credentials | panel.ts; types.ts | PIN, כרטיסים, הסרה/עדכון, תחנה ו־USB | אין חשיפת קודים קיימים בטבלה; לא מאבדים מסלול תחנה |
| pin | panel.ts; users/pin_check; users/pin_generate | בדיקת כפילות, יצירה ייחודית ואימות | הייחודיות נקבעת בשרת גם בזמן שמירה |
| card | panel.ts captureBody; usb-card-input.ts | תחנה וקורא, התחלה, קריאה, ביטול, timeout ואישור שיוך | קריאה אינה שיוך עד אישור; USB נשאר זמין |
| photo | user-photo.ts | הרשאה, צילום, שימוש, צילום מחדש והסרה | שחרור media track; ללא scrollbar בתמונה |
| groups | profile-settings.ts | רשימת קבוצות, שם, פעילות ותחנות מורשות | קבוצות מורישות תחנות לפי המודל הנוכחי |
| group-edit | profile-settings.ts reviewView; bulk-users.ts | עריכת קבוצה, תצוגת השפעה, preview/apply וקבלה | חסימות אישיות נשמרות; לא משכתבים קבוצה בלי revision |
| directory | permission-directory.ts | הרשאות אפקטיביות, מקור וחריג אישי | חיפוש/סינון לפי החוזה הקיים; מסך ביקורת ולא מנוע הרשאות חדש |
| bulk | bulk-users.ts; operations-center.ts | בחירה מרובה, preview, apply, receipts ומעקב | תוצאות חלקיות וקבלות לאחר reconnect; אין cancel חדש שלא קיים |
| imports | panel.ts csvBody/importBody; bulk-users.ts | CSV ומלאי תחנה, מיפוי, preview, שורות שגויות וקיבולת | adopt/ignore נשמרים בתת־מסך משותף; אין כתיבה לפני אישור |
| lifecycle | identity-lifecycle.ts | פג/מסתיים, חשד לכפילות, בלי אמצעי כניסה ויצוא | אין מיזוג/שליחת תזכורות אוטומטיים |
| whatsapp | user-details.ts; phone.ts | חשבון, E.164, תצוגה מקדימה, עריכת הודעה, כרטיס בלבד ואישור שליחה | אין שליחה עקב שמירה; סטטוס קבלה אינו קריאה |
| chat | user-details.ts WhatsApp history/media | היסטוריה, בועות, זמנים ומדיה כשזמינה | רק תוכן אמיתי מן האינטגרציה; אין הבטחת יכולות שליחה חדשות |
| doors | panel.ts devicesView; types.ts | מלאי תחנות, חיבור, ממסרים, סנכרון וייצוא | תחנה מנותקת אינה אדם מושבת |
| station | panel.ts stationSettings | זהות/דגם/קושחה, קשר אחרון, ממסרים, תורים ונתוני תחנה | מסכי מצלמה/הרשאות/שעות נפתחים בהקשר התחנה |
| programs | door-programs.ts; hold-open.ts | תוכניות HA פעילות/מושהות/בהסרה; עריכה ומחיקה | אין לקרוא לתוכנית פעילה טיוטה; אי אפשר להבטיח קריאת לוח מקומי לא נתמך |
| program-edit | door-programs.ts | שם, דלת, שבוע/חד פעמי, שעות, אזור זמן, שמירה/הפעלה | פתיחה קבועה אינה הרשאת אדם; סיום חוזר למצב רגיל דרך המסלול הקיים |
| codes | public-codes.ts | תאי קוד מוגדר/פנוי/לא אומת, קריאה, החלפה והסרה | לא מציגים PIN קיים; כותבים רק כשהיכולת זמינה |
| code-edit | public-codes.ts | קוד ישן כשנדרש, חדש, יעד, כתיבה ואימות | טופס נפרד מקוד אישי; תוצאה לא ידועה מחייבת בירור |
| technical | station-technical.ts; panel.ts | מיפוי ממסר, שמות/API ID, יכולות, הגדרות דלת, שעון ותחזוקה | להציג רק שדות שהציוד תומך בהם; ניהול relay 2 אינו הרשאה גורפת |
| call | camera.ts; audio-controls.ts; microphone-input.ts; tts-controls.ts; dialog-viewport.ts | וידאו, האזנה, דיבור, דלת, מסך מלא, TTS ואבחון | node יציב, מיוט ראשוני, user gesture, סגירה/רקע ו־busy |
| call-active | call-controls.ts; audio-controls.ts; panel.ts cameraBody | צלצול, מענה, דחייה, ניתוק ועדכון מצב | תצוגה לפי יכולות/אירועים; אישור פקודה אינו מענה מאומת |
| activity | events.ts; event-tools.ts | אירועים חיים/היסטוריים, אדם/תמונה, שיטה, תוצאה, זמן ופילטרים | תמונה נוכחית אינה ראיית צילום היסטורית |
| event | events.ts evidenceView; event-tools.ts | פרטי מקור, אי־זיהוי, נתונים חסרים, trace ואבחון | ללא ניחוש זהות; הפרדת ראיות משמות נוכחיים |
| reports | events.ts reportView; report-tools.ts | סיכום, מסננים, תצוגות שמורות, CSV והדפסה | קבוצות/שדות נוכחיים מסומנים כך, לא מידע היסטורי מומצא |
| sync | panel.ts syncView | מטריצה אדם×תחנה, מצבים, ממתינים, tombstones וסנכרון | שמות קריאים; אדם אחד לא עוצר אחרים |
| sync-detail | panel.ts syncView; sync/diagnostics | שלב, זמן, קוד שגיאה מוסווה, בירור/retry כשהותר | timeout לא ידוע אינו כישלון כתיבה ודאי |
| operations | operations-center.ts | סנכרון/CSV/bulk, מצב, התקדמות, ילדים וקבלות | בלי יכולת ביטול/חידוש מומצאת; ניתוק מסך לא מבטל job |
| management | panel.ts toolsView | כלי ניהול נגישים לפי הרשאה | אין שינוי ברמות authorization |
| fields | profile-settings.ts; profile-fields.ts | שדות, תוויות, בחירות, חובה, צילום ותבניות קליטה | הסוגים והמשתנים בדיוק לפי יכולות השרת |
| templates | whatsapp-templates.ts; profile-settings.ts | תבניות הודעה, ארגון, משתנים ותצוגה מקדימה; תבניות אדם נפרדות | השתמש בשמות placeholder אמיתיים, לא בשמות ההדגמה |
| media | media-settings.ts | HLS/go2rtc, MSE/RTC, fallback, ספק, גילוי ובדיקה; PTT/Toggle | שינוי גורף דרך ההגדרות הקיימות |
| clocks | clock-settings.ts; fleet-clocks.ts | NTP שרת/פורט/מרווח, סנכרון יחיד/כללי, אזור זמן וסטייה | מארח HA הוא מסלול נפרד ומותנה תמיכה |
| permissions | access-control.ts; panel_permissions.py | משתמשי HA, 5 אזורים, ללא/צפייה/ניהול | מסך זה למנהל HA בלבד; בדיקה בשרת |
| health | health.ts; event-tools.ts | תקינות, תורים, היסטוריה, clocks, support bundle, readiness ובדיקות שדה | אבחון מוסווה; אין קריאות כבדות עקב כל render |
| audit | admin-audit.ts | מבצע, פעולה, יעד, זמן, מסננים וייצוא | לא רושמים PIN/כרטיס מלא; תיעוד ניהול נפרד מאירוע גישה |
| schedules | schedules.ts | ספרייה, CRUD, שכפול, שבוע, חריגים, הערכה, יבוא/יצוא | שמור אינו מופץ; tools מתקדמים עדיין נגישים |
| deployment | deployment-plans.ts; schedule-operations.ts; schedules.ts | מוכנות, מלאי, תלויות, תוכנית פריסה, תמונת בסיס, אימות ופעולות | gating לכל תחנה; claim/abort/archive במסלול המתקדם הקיים |
| recovery | panel.ts reviewBody; conflict APIs | מקור WisKey מול ציוד, פתרון הבדלים/מחיקות ותוצאה | קריאה חדשה ו־revision לפני שינוי; אין אימוץ אוטומטי |
| appearance | appearance.ts; appearance_settings.py | עיצובים ישנים וחדשים, אישי/ברירת מחדל משותפת | העדפה גלובלית כבר קיימת; לשמר user override ו־revision |
| states | api-contract.ts; panel.ts; request.ts | ריק, אין תוצאות, שגיאה עם מידע קודם, אין גישה, dirty/revision conflict | מסך עזר לתכנון מצבים קיימים; לא שירות חדש |

## עומק שאינו דורש מסך ראשי נוסף

תצוגות שמורות, פגינציה, אפשרויות מסננים, אזהרות כפילות, מצבי בקשה, קבלת פעולה, תחנה שאינה תומכת ופרטי אבחון משתמשים ברכיבי משנה של המסכים הממופים. אין למחוק אותם אם אינם מוצגים במצב הראשי של צילום PNG.

מסך יבוא מכסה CSV ויבוא מהתחנה; מסלול adopt/ignore נותר תת־מסך קיים. מסך בריאות מכסה גם רישום בדיקות שדה, דוח מוכנות וחבילת תמיכה. ספריית הלוחות והפריסה מכסות את הכלים המתקדמים, כולל חריגים, הערכה, תלויות, תמונות בסיס ויומן פעולות. יצוא, הדפסה ושגיאות נשמרים לפי המודול המקורי.

## ממשקים שאינם חלק מעיצוב הפאנל

ישויות Home Assistant, שירותים, config/options flow, עדכוני HACS, האינטגרציה/התוסף go2rtc, שכבות ISAPI, האחסון, תורי הסנכרון, מנועי האכיפה והסודות אינם מוחלפים. הם נסקרו כגבולות התלות של הפאנל; ההדמיה אינה עיצוב מחדש של כל Home Assistant או של ממשק היצרן.

