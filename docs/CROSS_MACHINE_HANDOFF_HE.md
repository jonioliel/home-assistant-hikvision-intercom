# העברת WisKey למחשב אחר · 01.10.2026

## מה מגובה ואיפה

מאגר: https://github.com/jonioliel/home-assistant-hikvision-intercom

ענף מסירה: `codex/akuvox-arx-continuity`. הענף התחיל מ־main, commit `4bffe0810dd93e61191140b7241a01892e26b8dc`, גרסת `2.0.0-rc.37`. לפני המסירה אומת שעץ הקוד ב־main זהה לעץ המקומי `909579e3d113803e6274dbe4e4046aa5e6bf3c3c` שעליו מבוססים קטלוגי Arx. אין להחליף את provenance של הקטלוגים ב־commit החדש של התיעוד.

בענף נשמרים: הקוד שהיה ב־main, תוכנית Akuvox, חבילת העיצוב V4, מסירות Arx contract.1–4 וחבילות המקור/build שכבר נמסרו. גיבוי תוצרי handoff/design נבדק לפי BACKUP_ARTIFACT_MANIFEST.json. פקודת git clone של הענף מחזירה אותם בלי תלות בנתיב המחשב הראשון.

לא מועברים: תמליל מלא של שיחות Codex, צילום אישי מתוך .codex-remote-attachments, תיקיית private, .env, סודות/טוקנים, .storage של HA, פרטי תחנות חיים, סביבת Python/Node מותקנת, וריפו Arx המלא שנמצא במחשב הראשון. זה גיבוי ידע/קוד/תוצרים, לא גיבוי של התקנת HA או כל תוכן המחשב. סיכום ההקשר הדרוש לפיתוח נמצא כאן; אין להסתמך על סנכרון שיחה בין מחשבים.

## התחלה מחר, 02.10.2026

```powershell
git clone --branch codex/akuvox-arx-continuity https://github.com/jonioliel/home-assistant-hikvision-intercom.git wiskey
cd wiskey
git status --short
git log -1 --oneline
git switch -c codex/akuvox-provider
```

פתח את התיקייה במחשב השני והתחל משימה עם הטקסט הבא:

> המשך את פיתוח WisKey לתמיכת Akuvox תחת אותה אינטגרציה. קרא קודם CONTINUE_HERE.md, docs/CROSS_MACHINE_HANDOFF_HE.md, docs/AKUVOX_ARX_IMPLEMENTATION_STAGES_HE.md, תוכנית Akuvox המפורטת ויומן Arx contract.4. התחל בשלב A0/A1: מיפוי תלויות Hikvision, חוזה provider מצומצם ועטיפת המימוש הקיים ללא שינוי התנהגות. אל תניח שיש API מואצל, הקרנת רקע או SDK מוכנים. שמור domain/IDs/WS/embed ואכיפת הרשאות קיימים. הוסף Akuvox לפי דגם וקושחה מאומתים, תחילה קריאה בלבד; כשאין ציוד התקדם עם fixtures מסוננים וסמן NOT_RUN. אל תפרסם גרסה לפני בדיקות תאימות Hikvision ו־Arx. עדכן את מסמך ההמשך וה־changelog, שמור commits ודחוף את ענף העבודה ל־origin כדי שנוכל להמשיך מהמחשב הראשון.

התקן dependencies לפי README/pyproject.toml ו־frontend/package.json; אין במאגר הבטחה שסביבת HA מלאה זמינה ב־Windows. בדיקות שמחייבות HA/ציוד יבוצעו בסביבה המתאימה, ולא יוחלפו בהצלחה מדומה.

## מצב Arx המחייב את התכנון

Arx הוא השם החדש של VMS; מותקן כתוסף HA עם integration `smplwise_bridge` (לפי דיווח Arx0.3.1). מקור המידע הוא שלוש תשובות Arx שנשמרו ב־handoff/wiskey-arx-contract-rc37.4/request/; הקוד של Arx לא נבדק כאן עצמאית.

- rc.37 פרוס/פורסם; מסירות contract.1–4 הן תיעוד, לא גרסאות runtime.
- (b) חיבור HA WS אמיתי לכל מפעיל, לקריאה בלבד ב־/arx. iframe נשאר לכתיבות/reauth ול־Ingress/Companion כשאין זהות זמינה. הטלפון מתקדם לאפליקציית Arx עצמה.
- (a+) האצלה בתוך HA Core היא יעד מתוכנן, לא API קיים. אין private dispatch או ActiveConnection מזויף.
- D-006 מוסכם: הקרנת רקע סגורה id/name/online/last_seen, בלי last_access או אנשים. עדיין אין פקודה ממומשת או סכמות בקשה/שגיאה מלאות. הקוד הנוכחי יכול להחזיר זהות ב־last_access גם לחשבון overview ללא users/events; Arx דיווח שהמטמון/UI שלו עדיין מכילים אותה עד B0.
- D-007 heartbeat20/timeout60 מוסכם בתכנון. D-008 TTL/תקרות/אתגר נגד heartbeat מאוחר עדיין הצעה. אין בדיקות חיות המוכיחות אותם.
- הכתיבות הישנות בערוץ Supervisor נשארות לפי החלטת בעל המוצר; WisKey רואה זהות שירות. אין כתיבות חדשות ואין אישור כפול דרך השירות.
- D-002 וידאו דרך relay Arx פתוח, דורש חיתוך RBAC עם הרשאת מפעיל WisKey ומדידות. descriptor/102 הם P2; לא להסתמך על stream_source הפרטי.
- קטלוגי238 פקודות/301 קודי שגיאה הם חילוץ סטטי. שבע סכמות קריאה מקוננות מלאות עדיין פתוחות. diff נקי אינו היתר לכתיבה.
- Arx מתקדם תחילה במדיה CR-015 ואז B0/B1. אין צורך לבקש מהבעלים חשבון רקע לפני B0 ופיצול הערוצים.

## מצב Akuvox

קיימת תוכנית מפורטת, אך provider Akuvox אינו ממומש. דגמי הפיילוט/קושחה/גישה לציוד עדיין צריכים להתקבל מהבעלים. אין להציג את מפת הדרכים כהסמכת דגמים. API, QR, שיחה, SIP, talk ו־TTS תלויים בדגם/קושחה ובבדיקות אמיתיות.

## עבודה משני מחשבים

ענף העבודה החדש נפרד מענף המסירה. בתחילת עבודה fetch ובדיקת main; אין שני עובדים שדוחפים במקביל לאותו ענף. commit+push בסיום כל מקטע יחד עם עדכון סטטוס מה מומש/נבדק/פתוח. העברת עבודה בין מחשבים נעשית לפי branch+commit, לא לפי מספר rc בלבד. אין force-push לענף משותף.

כאן לא הוחלפו גרסה, runtime או התקנה. מסמך זה אינו אישור בדיקות ציוד או release. אם main מתקדם, בצע merge/rebase בענף הפיתוח ופתור תאימות לפני פרסום. שמור את מסירות Arx הישנות כראיות immutable; מסירה חדשה מקבלת תיקייה ו־CHANGES חדשים.
