# HACS: מעבר התקנה קיימת מ־hikvision_intercom ל־smplwise_access_control

## למה התקבלה השגיאה

מהדורת v2.0.0-rc.1 כוללת את האינטגרציה בתיקייה custom_components/smplwise_access_control. רישום HACS של התקנה קיימת עדיין מצביע על custom_components/hikvision_intercom; לכן פעולת Update/Install מחפשת בגרסה החדשה את custom_components/hikvision_intercom/manifest.json ומחזירה No manifest.json file found. רענון מידע, אתחול דפדפן או ניסיון הורדה נוסף לא משנים את נתיב התיקייה השמור.

זהו מעבר של מזהה טכני (domain): Home Assistant דורש ששם התיקייה יתאים לשדה domain ב־manifest, ו־HACS מנהלת אינטגרציה אחת בלבד בכל מאגר. לא נוסיף לתג שתי תיקיות אינטגרציה ולא נערוך ידנית את נתוני HACS הפרטיים. [מבנה מאגר HACS](https://www.hacs.xyz/docs/publish/integration/) · [כלל ה־domain של Home Assistant](https://developers.home-assistant.io/docs/creating_integration_manifest/).

**אם ניסיון ההורדה נכשל:** בדוק שהאינטגרציה הקיימת והתחנות עדיין נטענות ושקוד הגרסה המקומי נשאר הקודם. הכישלון המדווח התרחש לפני התקנת ה־domain החדש. אל תמחק את האינטגרציה ממסך **הגדרות ← מכשירים ושירותים**, ואל תנסה שוב Update לגרסת RC זו.

## לפני שינוי בהתקנה החיה

1. צור גיבוי מלא **וניתן לשחזור** של תצורת Home Assistant, כולל .storage, custom_components ונתוני HACS. שמור עותק מחוץ למערכת. הגיבוי מכיל סיסמאות, PIN ומספרי כרטיס; אין לשתף אותו בקישור ציבורי.
2. חלץ עותק מלא של התצורה בסביבת בדיקה נפרדת. השג את קוד [תג v2.0.0-rc.1](https://github.com/jonioliel/home-assistant-hikvision-intercom/releases/tag/v2.0.0-rc.1); הוא כולל את custom_components/smplwise_access_control ואת tools/migrate_domain_offline.py.
3. הרץ בדיקה יבשה על **העותק**, בעזרת Python 3.12 ומעלה. היא מציגה מונים בלבד ואינה משנה קבצים:

   ~~~text
   python3 tools/migrate_domain_offline.py /path/to/ha-config-copy
   ~~~

   ודא שמספר רשומות התחנות וקובצי הנתונים תואם לציפיות. אם הבדיקה מסרבת לפעול, אין לעקוף אותה. למשל, תיקיית .storage חסרה, נתוני ה־domain החדש כבר קיימים או שאין קובצי נתונים ישנים.
4. כשה־Home Assistant של **העותק** כבוי, העתק אליו את custom_components/smplwise_access_control. הרץ את כלי המעבר על העותק:

   ~~~text
   python3 tools/migrate_domain_offline.py /path/to/ha-config-copy --apply --ha-stopped
   ~~~

   הכלי יוצר ZIP של הקבצים ששונו לפני כתיבה, משאיר את קובצי האחסון הישנים, ושומר את מזהי התחנות והישויות. ה־ZIP הזה אינו מחליף גיבוי מלא.
5. הפעל HA בסביבת הבדיקה **ללא גישת כתיבה לאינטרקומים החיים**. בדוק שמספר התחנות, המשתמשים, הקבוצות, ההרשאות, הכרטיסים, התוכניות והאירועים נשמר; בדוק שלא נוצרו ישויות או מכשירים כפולים. בדוק גם אוטומציות, VMS ולקוחות API המשתמשים בשם הישן.
6. בדוק באותו עותק את מעבר HACS: ב־HACS הסר את **רישום המאגר הישן בלבד** דרך תפריט המאגר ← Remove. אל תסיר את האינטגרציה עצמה במסך מכשירים ושירותים. לאחר מכן הוסף שוב את jonioliel/home-assistant-hikvision-intercom כמאגר Integration מותאם, בחר v2.0.0-rc.1 והתקן. ודא שהתיקייה המנוהלת היא smplwise_access_control, שהתחנות נשארו קיימות ושגרסה עתידית תוכל להתעדכן. לפי [תיעוד HACS](https://www.hacs.xyz/docs/use/repositories/dashboard/), הסרת מאגר מסירה את קובצי המאגר אך אינה מסירה את הנתונים הקשורים אליו; עדיין חובה לבדוק זאת על העותק שלך.

## מעבר בהתקנה החיה — רק אחרי חזרה מוצלחת על העותק

1. קבע חלון תחזוקה. צור שוב גיבוי מלא ונפרד, וודא שאפשר לשחזר ממנו גם קוד, גם .storage וגם את רישום HACS.
2. עצור את **Home Assistant Core**. הפעל את הפקודות ממארח או מכלי עזר שעדיין פעיל בזמן ש־Core כבוי ושיש לו גישה לתיקיית התצורה ו־Python. אל תריץ את כלי הכתיבה על מערכת HA פעילה.
3. התקן בתצורה את custom_components/smplwise_access_control מתג הגרסה שנבדק. שמור בינתיים את התיקייה הישנה במסגרת הגיבוי. הרץ בדיקה יבשה, ואז --apply --ha-stopped עם קובץ גיבוי מחוץ ל־.storage:

   ~~~text
   python3 tools/migrate_domain_offline.py /path/to/live-config
   python3 tools/migrate_domain_offline.py /path/to/live-config --apply --ha-stopped --backup /path/outside-config/smplwise-domain-backup.zip
   ~~~

4. הפעל את HA ובדוק תחנה אחת ואת נתוני המשתמשים לפני סנכרון כולל. בדוק בהמשך את כלל התחנות, הרשאות הדלתות, אירועים, מצלמות, שמע ואוטומציות.
5. רק לאחר שה־domain החדש תקין, הסר ב־HACS את רישום המאגר הישן והוסף אותו מחדש כמתואר בסעיף 6 של הבדיקה. ודא שהתיקייה החדשה עדיין קיימת ושהתג הנבחר הוא v2.0.0-rc.1. אם HACS אינו מאפשר להסיר את הרישום, עצור; אין לערוך את קובצי .storage של HACS ידנית.
6. אם שלב כלשהו נכשל, עצור את HA ושחזר **את הגיבוי המלא כיחידה אחת**, כולל קוד האינטגרציה הישנה, קובצי .storage ורישום HACS. שחזור הקוד בלבד אינו שחזור מעבר domain.

הוראות אלה מתארות מסלול הגירה מבוקר; הוא עדיין לא אומת על עותק של ההתקנה המסוימת שלך. אין לפרש את הצלחת בדיקות CI או את הצלחת ההורדה בהתקנה חדשה כאישור להריץ אותו על מערכת בקרת כניסה פעילה. [בדיקות הקבלה המלאות](manual-tests/SMPLWISE_DOMAIN_MIGRATION_TESTS_HE.html) · [מדריך מעבר הנתונים](DOMAIN_RENAME_MIGRATION_HE.md).
