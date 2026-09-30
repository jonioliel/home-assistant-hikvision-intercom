# WisKey מקורי בתוך Arx (בלי iframe): התייעצות על שיטת הזהות, ובקשה לחבילת מסירה מלאה

**אל:** צוות הפיתוח של WisKey (Codex) · **מאת:** SMPLWISE Arx (בעל המוצר) · **תאריך:** 30.09.2026
**בסיס:** WisKey `2.0.0-rc.37` (commit `4bffe08`, `api_contract=1`), החבילה "WisKey-Arx-native-integration-rc37", ומסמך
Gate A שלנו.

**שני חלקים.** (1) **התייעצות** (סעיפים 0-1): לפני שנבנה משהו במסלול הזהות, אנחנו שואלים מה WisKey יכול לתמוך בו,
ומציעים להגיע יחד לשיטה שעובדת לשני הצדדים. יש לנו המלצה, אבל ההחלטה משותפת ואנחנו מזמינים הצעה נגדית.
(2) **בקשה לחוזה מלא** (סעיפים 2-10): סכמות, אירועים, מדיה, אודיו, UI, מודל נתונים ודוגמאות. בחלק הזה אין צורך בשינוי
קוד, רק בתיעוד.

> **הבקשה המרכזית לחלק 2:** בכל תחום שנגעתם בו, תנו את התיאור המפורט ביותר שאתם יכולים. כל שדה, כל קוד שגיאה, כל
> מצב, כל מקרה קצה. אם משהו ידוע לכם רק מהקוד, תכתבו אותו. אנחנו מממשים מול המסמכים שלכם, בלי לנחש ובלי להעתיק קוד.
> "ראו בקוד" אינה תשובה: אנחנו לא מעתיקים ממנו, ורוצים חוזה שתעמדו מאחוריו.

## 0. מה מצאנו ומה אנחנו מציעים

**מה זה Arx בפועל (נבדק, לא הנחה):** תוסף HA עם Ingress (`ingress: true`, `homeassistant_api: true`, `panel_admin: false`)
ולצידו אינטגרציית HA משלנו, `smplwise_bridge` (0.3.1), שרצה בתוך HA Core. הגשר טוען `User` אמיתי מ‑`hass.auth`, מריץ
שירותים חתומים ב‑HMAC-SHA256 (סוד צימוד, `ts.nonce.sha256(body)`, חלון 60 ש', דחיית nonce חוזר) עם `Context(user_id)`
של המשתמש הממופה, ודוחף ספריית משתמשי HA לתוסף. אין ל‑Arx custom panel, ולכן לדף Arx **אין `hass`**. כניסה שנייה,
`/arx` (מרחוק), מגישה את אותו UI על ה‑origin של HA עם כניסת HA רשמית לכל משתמש.

**מה כבר רץ היום מול WisKey (מ‑0.1.102):** ערוץ WS אחד של התוסף עם `SUPERVISOR_TOKEN`: `authorization/session`,
`overview`, `subscribe`, `events/list`, `users/query`, `users/get`, ובכתיבה `stations/test_unlock`, `users/create|update|delete`,
`users/pin_generate`, `cards/*capture*`, `media/signal`, `tts/engines` + `tts/start`. בנוסף ה‑iframe לפי `embed-api-v1` (rc.37:
`embed=1&chrome=none&tab&tool&density&wall`). מצלמות עמדה: סטילס דרך go2rtc של Arx.

**מה כבר קיבלנו ולא צריך לחזור עליו:** `START_HERE_HE.md`, `CLAUDE_TASK.md`, `ACCEPTANCE_HE.md`, `SMPLWISE_VMS_ADDON_IMPLEMENTATION_GUIDE.md`,
`WISKEY_OPERATOR_SCOPES.md`, `VISIT_OPERATIONS_API.md`, `SMPLWISE_RC17_WORKFLOWS_API.md`, `FLEET_ALERTS_API.md`,
`INVESTIGATION_TIMELINE_API.md`, `UNIFIED_SEARCH_API_V1.md`, `WISKEY_EMBED_API_V1.md`, `WISKEY_VMS_PANEL_COMMANDS.json` (238 פקודות,
שדות עליונים בלבד), וקוד המקור (backend + `reference/frontend/src`). מה שחסר לנו הוא **החוזה המלא**: סכמות מקוננות,
תשובות, שגיאות לכל פקודה, סמנטיקת מצבים, ודוגמאות אמיתיות.

**מה מצאנו (Gate A, מקריאת הקוד, עוד לא אומת על המתקן):**

| מסלול | מי ש‑WisKey רואה ב‑`connection.user` | ההשלכה |
|---|---|---|
| המסכים המקוריים של Arx (ערוץ `SUPERVISOR_TOKEN`) | משתמש המערכת `Supervisor` (admin) | ה‑station scope, השדות, האישור הכפול, דלי ה‑rate והאודיט שלכם לא חלים על המפעיל |
| ה‑iframe (`/hikvision-intercom?embed=1`) | המפעיל האמיתי | הכול חל, אבל זה iframe, ובאפליקציית Companion הוא לא מתחבר |
| שירותי הגשר `smplwise_bridge.*` | לא עוברים דרך WisKey | הגשר כבר פועל בשם משתמש HA ממופה (HMAC + `Context(user_id)`) |

המסלול הראשון סותר את מדיניות הזהות שלנו ואת המסמך שלכם (`WISKEY_OPERATOR_SCOPES.md`: "A Supervisor/system token must
not be treated as the browser operator's identity"). לכן לא נוסיף כתיבות חדשות במסכים המקוריים עד שנסכים על שיטה.

### 0.1 נקודת ההחלטה המשותפת: איך מפעיל Arx מגיע אליכם בזהותו

אנחנו מבקשים שתגידו **מה מהאפשרויות הבאות WisKey יכול לתמוך בו, ומה אתם מעדיפים**, או שתציעו אחרת:

| | אפשרות | מה נדרש מ‑WisKey | מה נדרש מ‑Arx | חסרונות |
|---|---|---|---|---|
| **(a+)** | נקודת כניסה מואצלת בבעלות WisKey: הגשר שלנו מריץ פקודות **כמשתמש ה‑HA הממופה**, WisKey רושם `via` באודיט, ומנהל WisKey יכול לכבות | API קטן ותוספתי (הצעה בסעיף 0.2), כחצי יום עד יום לפי הערכתנו | מתאם בגשר ובתוסף, 1-1.5 שבועות | תלות ב‑API חדש שלכם; שורש האמון הוא הגשר שלנו |
| **(b)** | טוקן HA לכל מפעיל, מוחזק בשרת Arx, וחיבור WS נפרד לכל מפעיל | כלום | כניסת HA שנייה בתוך Ingress (כולל MFA), אחסון refresh tokens מוצפן, ביטול | כניסה כפולה למפעיל; סוד ארוך־חיים חדש אצלנו |
| **(c)** | משהו שכבר יש לכם או שאתם מעדיפים: מיפוי חשבון שירות/מפעיל משלכם, מפתח API לכל מפעיל, מנגנון "act-as" קיים, או רכיב שמקבל `hass` | לפי ההצעה שלכם | לפי ההצעה שלכם | לא ידוע לנו |

**ההמלצה שלנו: (a+)**, ובמקביל (b) רק בכניסה `/arx` (שם כבר יש לנו טוקן משתמש) כהוכחה מהירה לקריאה בלבד. אם יש לכם
דרך טובה יותר, נשמח לאמץ אותה. מה שחשוב לנו: זהות אמיתית אצלכם, ההרשאות והאודיט שלכם חלים, ובלי סיסמאות HA דרך Arx.

### 0.2 אם תבחרו ב‑(a+): הטיוטה שלנו לנקודת הכניסה המואצלת

זו טיוטה לדיון, לא דרישה. הגשר שלנו מריץ פקודות WisKey **כמשתמש ה‑HA הממופה של המפעיל**, דרך API תוספתי שאתם כותבים ומחזיקים. אתם מריצים את
**אותו מסלול** של `handle` היום (`is_active`, `command_allowed`, schema, `validate_client`, גודל, `AdminLimiter`,
`panel_security.guard`, `_dispatch(actor=user.id, user=user)`, `audit_denial`), ומוסיפים `via` לאודיט. בלי שינוי
בחוזה v1, בשמות פקודות או באחסון. הצעה לממשק (שנו מה שתרצו, אבל תתעדו את מה שבחרתם):

```python
# custom_components/hikvision_intercom/delegation.py  (WisKey-owned, additive)
registration = await delegation.async_register(hass, delegate="smplwise_bridge", entry_id=<bridge config entry>)
#   -> מופיע אצלכם בניהול כ"ממתין לאישור"; מנהל WisKey מאשר או דוחה. בלי אישור: delegation_not_approved.
session = await registration.async_open(
    user_id="<HA user id>",            # ממופה אצלנו; אסור None, system_generated או משתמש לא פעיל
    actor_label="arx:<arx user id>",   # ≤128 תווים, לאודיט בלבד, לא משמש להרשאה
    session_ref="<opaque Arx session>",# לקישור אודיט ולביטול
)
result = await session.async_call("users/get", {"user_id": "...", "api_contract": 1}, request_id="<uuid>")
unsub  = session.subscribe("subscribe", {}, on_event)      # וגם audio/start, tts/start, cards/capture_* אם רלוונטי
state  = session.security()                                 # כמו security.public(connection)
await session.async_close(reason="logout" | "role_changed" | "revoked" | "idle")
```

ההתנהגות שאנחנו מציעים, לאישורכם, לתיקון או להחלפה:
1. **שורש אמון:** אובייקט `registration` הוא capability: רק מי שמחזיק אותו פותח סשנים. האישור ניתן במסך הניהול שלכם,
   ע"י מנהל WisKey. אנחנו מבינים שקוד אחר באותו תהליך Python יכול תאורטית לעשות הכול; מודל האיום הוא הסכמה מפורשת
   ומניעת שימוש בטעות, לא הגנה מאינטגרציה זדונית. אם אתם מעדיפים סוד צימוד (HMAC לכל קריאה) או פקודת WS
   (`hikvision_intercom/delegation/*` על חיבור admin), תכתבו למה ואת הפרוטוקול המלא.
2. **זהות:** WisKey טוען את ה‑`User` בעצמו מ‑`user_id`, ודוחה משתמש לא קיים, לא פעיל או `system_generated`
   (`delegated_user_invalid`). `user=None` לעולם לא מגיע ל‑`_overview`.
3. **אודיט:** כל רשומה (הצלחה ודחייה) מקבלת `actor=<HA user id>` כרגיל, ובנוסף `via="smplwise_bridge"`, `via_actor`,
   `via_session`, `via_request`. השדות מופיעים ב‑`audit/list`, ב‑`audit/export` וב‑CSV.
4. **מתג כיבוי:** הגדרת מנהל (למשל `delegation.enabled` + רשימת delegates מאושרים, עם `revision`). כיבוי סוגר את כל
   הסשנים המואצלים, שולח `access_revoked` למנויים שלהם ומפסיק מדיה, אודיו ו‑capture פתוחים.
5. **נעילת idle ו‑reauth:** זו השאלה שהכי חשוב לנו לשמוע עליה את דעתכם (סעיף 0.3). הרעיון שלנו, לדיון: Arx מדווח
   פעילות (`security/touch`) רק על פעולה אמיתית של המפעיל; סשן נעול מחזיר `screen_locked`; ופקודה רגישה תחת
   `reauth_sensitive` מחזירה `reauth_required`, ו‑Arx פותח דף WisKey קטן באותו origin של HA (למשל
   `/hikvision-intercom?embed=1&reauth=<delegation handle>`), שבו המפעיל מזדהה **אצלכם**. ההצלחה מעלה את הסשן המואצל
   ל‑300 ש'. Arx לעולם לא מעביר סיסמת HA.
6. **rate limit:** דלי נפרד לכל משתמש מואצל, בלי לחלוק עם כל Arx (היום: burst 30, ‏2/s, ‏8 במקביל, עד 128 זהויות).
7. **שגיאות חדשות:** `delegation_disabled`, `delegation_not_approved`, `delegated_user_invalid`, `delegation_session_closed`,
   `command_not_delegable`, בנוסף לכל הקודים הקיימים.

### 0.3 מה אנחנו שואלים לגבי השיטה, ומה נוכל לתת לכם

1. **מה אתם יכולים לתמוך בו:** (a+), (b), (c), או שילוב. מה אתם מעדיפים, ולמה. אם (c), תארו אותה כמו שתיארנו את (a+).
2. **idle ו‑reauth לקורא מואצל:** איך `idle_minutes` ו‑`reauth_sensitive` צריכים להתנהג כשהמפעיל עובד דרך Arx? מי מדווח
   פעילות, מה פותח נעילה, ואיך מספקים הוכחה טרייה בלי שסיסמה תעבור דרכנו?
3. **מה אתם צריכים מאיתנו** כדי שהאודיט והאישור הכפול שלכם יישארו בעלי משמעות: שיטת חתימה או צימוד, תוויות שחקן
   (`actor_label`, מזהה סשן Arx, מזהה בקשה), מגבלות rate בצד שלנו, allowlist פקודות בגשר, דיווח logout ושינוי תפקיד.
4. **מה אנחנו כבר נותנים:** מיפוי מפעיל Arx ← משתמש HA (דחייה של `system_generated` ושל משתמש לא פעיל), HMAC עם nonce
   ו‑timestamp בין התוסף לגשר, אודיט Arx לפני כל שליחה, allowlist פקודות בתוסף, וסגירת סשנים ב‑logout ובשינוי תפקיד.
5. **הצעה נגדית:** אם כל הכיוון לא נראה לכם, נשמח לשמוע מה כן. לא נבנה את מסלול הזהות לפני שנסכים.

### 0.4 וידאו עמדות: ההצעה שלנו (לאישורכם)

לקיר מקורי ב‑Arx לא נשתמש בגשרי MSE/RTC שלכם: התקרה של 12 גלובלית לכל מופע HA, ולשרת Arx אין זהות משתמש לחתום
איתה נתיב. במקום זה, הגשר שלנו קורא (admin, opt-in לכל מצלמה, בשרת בלבד) את `stream_source` של ישות המצלמה שלכם
(`overview.stations[].entities.camera`). Arx מושך את הזרם ל‑go2rtc משלו ומגיש אותו דרך ה‑relay שלו (MSE/WebRTC, תקציב
ו‑lease משלו). ההרשאה: RBAC של Arx **בחיתוך** עם `station_ids` של המפעיל מ‑`authorization/session` המואצל. נבקש
שתאשרו שזה שימוש נתמך, ותפרטו את מה שנשאל בסעיף 4.

### 0.5 מה לא נעשה, בכל שיטה

**גם אם טכנית אפשר:** לא נעתיק קוד WisKey ל‑Arx; לא נקרא ולא נכתוב ל‑`.storage/hikvision_intercom.*`; לא
נפנה ל‑ISAPI של עמדה בנתונים שבבעלותכם; לא נקרא ל‑handler דרך `hass.data["websocket_api"]`; לא נזייף `actor` ולא נסמוך
על `user_id` מהדפדפן; לא נחשוף לדפדפן, ל‑URL, ללוג או לצילום מסך `SUPERVISOR_TOKEN`, סוד צימוד, refresh token, RTSP,
טוקן אודיו, PIN או מספר כרטיס מלא; לא נעביר סיסמאות HA; אין proxy כללי ל‑HA WS (רק פעולות מוגדרות ב‑allowlist); אין
retry אוטומטי לשחרור דלת, capture או כתיבת אדם אחרי תוצאה לא ודאית; ה‑iframe וחוזה v1 נשארים כנתיב חזרה.

## 1. זהות והרשאה

סעיף 1.1 תלוי בשיטה שנסכים עליה בסעיף 0. סעיפים 1.2-1.5 נחוצים לנו בכל שיטה, כי בכולן WisKey הוא שאוכף.

### 1.1 פירוט השיטה שתבחרו (אם (a+): ה‑API המואצל)
נבקש מסמך `DELEGATION.md` עם: חתימות מלאות (טיפוסים, חריגים, async/sync); מחזור חיים של `registration` ו‑`session`
(מה קורה בטעינה מחדש של WisKey, של הגשר, ב‑restart של HA, בעדכון גרסה); האם סשן מואצל שקול בדיוק ל‑`ActiveConnection`
לכל דבר (`panel_security.sessions`, בעלות אודיו `bridge.connection is connection`, סשן capture, `subscriptions`); מספר
סשנים מקסימלי (לכל משתמש, בסך הכול); timeouts; ביטול בקשה תלויה; האם `async_call` מחזיר בדיוק את ה‑`result` של WS
ומעלה `AccessError(code)` באותם קודים; רשימת פקודות **שלא** ניתנות להאצלה (הצעה שלנו: `security/reauth_*`,
`authorization/settings_update`, `backups/*`, `platform/*`, יבוא CSV); ומבחני קבלה שתריצו אצלכם.

### 1.2 מודל ה‑operator scope, במלואו
הקוד ב‑rc.37 כבר עבר את המסמך: `panel_permissions` בסכמה 3, עם `profile_fields` (עד 12 שדות מותאמים, רמה לכל שדה),
`station_group_ids` ו‑`station_groups` (עד 64 קבוצות תחנות), בעוד `WISKEY_OPERATOR_SCOPES.md` אומר ששדות מותאמים נשלטים
כקטגוריה אחת. נבקש מפרט אחד מעודכן:
- טבלה **לכל אחת מ‑238 הפקודות** + `subscribe`, `audio/*`, `tts/*`, MSE/RTC: דרישות אזור (`requirements`), האם זמינה
  תחת station restriction (`SCOPED_STATION_COMMANDS`/`SCOPED_COMMON_COMMANDS`), תחת field restriction, דרישת שדה
  (`FIELD_COMMANDS`), האם היא ב‑`READ_COMMANDS` (כלומר לא "רגישה" ל‑reauth ולא דורשת `api_contract`), והאם admin-only.
- סדר ההערכה המדויק (אזור ← scope ← שדה ← יעד ← revision) וקוד השגיאה בכל שלב.
- הקרנה (projection): לכל אובייקט (overview, station, person, event, group, sync row, fleet alert), אילו שדות נמחקים,
  אילו מקבלים placeholder, ומה ערך ה‑placeholder בדיוק. מה `redacted_fields` ו‑`operator_editable` מכילים.
- זהות משותפת (`person_scope_shared`): הגדרה מדויקת, ואיך UI מזהה אותה מראש (לא רק מהשגיאה).
- `station_groups`: מבנה, הרחבה לתחנות חדשות, וההתנהגות כשקבוצה נמחקת.

### 1.3 מה `authorization/session` מחזיר
נבקש סכמה מלאה ומשמעות לכל שדה: `allowed`, `is_admin`, `areas`, `station_ids` (null מול רשימה ריקה), `fields`,
`profile_fields`, `revision` (של מה בדיוק, ומתי עולה), `personal_renewal`, `security` (`locked`, `idle_minutes`,
`reauth_sensitive`, `elevated`). האם `overview.access` זהה לו או שונה, ובמה. מה ההבדל בין `revision` כאן לבין revision
של מדיניות המדיה ושל `workflows.settings`.

### 1.4 אישור כפול (dual approval)
היום (`access/workflows.py`) המאשר חייב להיות שונה מהמבקש. נבקש: רשימת **כל** הפעולות שנכנסות לאישור כפול כש‑
`dual_approval=true` (transfers, cards, identity, jobs, בקשות ביקור?), מצבי הבקשה ומעבריהם, מי רשאי לאשר (אזור, scope,
admin), תוקף, ביטול, מה קורה כשהמאשר מאבד הרשאה באמצע, ואיך `approval_required` / `separate_approver_required` /
`visit_second_operator_required` נבדלים. והאם מותר שגם המבקש וגם המאשר יפעלו דרך Arx (שני משתמשי HA שונים, `via` זהה).

### 1.5 ביטול ורענון
מתי בדיוק נשלח `refresh`, `access_revoked` ו‑`screen_locked` (ראו 3); מה Arx חייב לנקות בכל אחד; ומה קורה לבקשה שכבר
התקבלה כשהרשאה משתנה באמצע (`permissions_changed`: האם הכתיבה אולי הושלמה, ואיך בודקים).

### 1.6 מדיניות idle / reauth / rate לסשן מואצל
ראו סעיף 0.3 ושאלות 1.6-1.8 בסעיף 10.

## 2. קטלוג הפקודות

### 2.0 מה אנחנו צריכים לכל פקודה (תבנית אחת)
לכל פקודה ב‑`WISKEY_VMS_PANEL_COMMANDS.json`, וגם `subscribe`, `audio/*`, `tts/*`, `media/*`:
1. **בקשה:** JSON Schema מלא, מקונן, כולל טיפוסים, חובה/רשות, ברירות מחדל, טווחים, אורכים, enum, פורמט זמן (UTC? offset?
   אזור זמן?), מזהים אטומים, וגבול גודל (65,536 / 1 MB / 64 MB).
2. **תשובה:** JSON Schema מלא. אילו שדות תלויים בהרשאה או ביכולת עמדה, ומה מופיע כשהם מוסתרים.
3. **שגיאות:** כל קוד שהפקודה יכולה להחזיר, **מתי** בדיוק, האם בטוח לנסות שוב (read / idempotent / אסור), ומה ה‑UI אמור
   לעשות. (ספרנו כ‑300 קודי `AccessError`/`AudioError` שונים בקוד; נבקש קטלוג שגיאות אחד, `errors/catalog.json`.)
4. **Revision / concurrency:** איזה revision נשלח (של אדם, מדיניות, ספרייה, בקשה), מה מחזירים ב‑`revision_conflict`,
   והאם יש merge או רק "טען מחדש".
5. **Preview / confirm:** לפעולות דו‑שלביות: מה ה‑preview מחזיר (`review_token`, `operation_id`, `expires`), תוקף, קשירה
   לשחקן ולנתונים, ומה מבטל אותו (`review_stale`, `bulk_review_stale`, `review_expired`).
6. **Idempotency:** האם בקשה חוזרת (אחרי ניתוק) יוצרת כפילות; האם יש receipt עמיד שאפשר לבדוק.
7. **תופעות לוואי וסנכרון:** מה נשמר, מה נכנס לתור עמדה, ואיך מבחינים בין `saved` / `pending sync` / `synced` / `failed` /
   `verified in field` (אילו שדות: `sync_state`, `desired_revision`, `applied_revision`, `last_error`, readback).
8. **עמדה לא מקוונת:** `station_offline` / `station_unloaded` / `device_unavailable` / `device_busy`: מה נשמר ומה לא.
9. **Paging:** `snapshot`, `offset`, `next_offset`, `previous_offset`, `stale`, `before`/`next` cursor; גבולות `limit`;
   יציבות סדר.
10. **רדקציה:** אילו שדות לעולם לא חוזרים (PIN, כרטיס מלא, RTSP), ואילו מוסתרים לפי scope.
11. **דוגמה אמיתית:** בקשה + תשובה + שגיאה אחת, מהמתקן שלכם, עם ערכים מנוקים.

**הפורמט המועדף:** קובץ JSON Schema לכל פקודה (`schemas/<area>/<command>.request.json`, `.response.json`) או קטלוג
WS אחד בסגנון OpenAPI/AsyncAPI, שנוצר מהקוד (כמו `tools.generate_panel_catalog`) ונבדק בטסטים שלכם כך שלא יתיישן.

### 2.1 עדיפויות
- **P1 (שערים B-C, ומעבר הכתיבות הקיימות בשער D):** `authorization/session`, `overview`, `overview/summary`, `subscribe`,
  `search/query`, `sync/status`, `appearance/settings_get`, `stations/list|get`, `stations/test_unlock`, `users/query|get|list`,
  `users/photo_get`, `users/create|update|delete|set_active`, `users/pin_check|pin_generate`, `cards/*`, `sync/user`,
  `profiles/settings_get`, `permissions/directory`, `events/list|detail`, `health/get`, `fleet/alerts`, `media/call|signal`,
  `media/settings_get`, `tts/engines|start`, `audio/*`.
- **P2 (תהליכי כתיבה הבאים):** `stations/technical_*`, `stations/rescan|clock_refresh`, `clock/station_sync|settings_get`,
  `schedules/*` (קריאה, preview, plan, operations), `profiles/settings_preview|apply|update|versions*`, `guest_templates/*`,
  `visits/*`, `users/temporary_cancel|lifecycle|duplicate_check`, `workflows/get|submit|decide|apply|withdraw|renew_*`,
  `conflicts/*`, `sync/station|all|diagnostics`, `events/report|export|print|support`, `health/history|refresh`,
  `fleet/alerts_action`, `whatsapp/*`.
- **P3 (כלי מנהל; כנראה יישארו במסך WisKey עצמו):** `platform/*` (35), `backups/*`, `jobs/*`, `users/csv_*`, `users/bulk_*`,
  `users/access_review*|access_compare*|access_scenario|data_quality|group_suggestions|adopt|archive|unarchive|ignore|
  delete_unmanaged`, `authorization/settings_*|preview`, `media/settings_update|provider_*`, `clock/settings_update|host_*`,
  `appearance/settings_update`, `audit/*`, `investigations/query`, `operations/query`, `upgrade/readiness`, `support/bundle`,
  `acceptance/*`, `events/history_inspect|trace_*`, `renewal/*`, `workflows/inventory_*|transfer_*|template_*|settings_update|
  reminder_action`, `stations/inventory|permission_audit`, `fleet/inventory_export`. ל‑P3 מספיקים סכמה, שגיאות ושורת מטרה.

### 2.2 סקירה וגילוי (overview, overview/summary, authorization/session, search/query, sync/status, appearance/settings_get)
- סכמת `overview` המלאה: `version`, `api`, `access`, `stations[]` (כל שדה: `online`, `call_state` וערכיו, `sync_state`,
  `last_seen`, `last_access`, `entities`, `integrated_locks[]`, `capabilities`, `event_status`, `clock`, `model`, `firmware`),
  `users` (מתי ריק), `users_complete`, `user_count`, `media_settings`, `profile_settings`, `appearance_settings`,
  `default_zone`, `sync_operations`, `tombstones`, `revocations`. אילו שדות תחנה נמחקים למי שאין לו `stations`.
- `overview/summary` מול `overview`: מה חסר, ומה המחיר (זמן, גודל) של כל אחד ב‑12 תחנות ו‑2,000 אנשים.
- `search/query`: ערכי `kind`, תוצאה לכל סוג, התנהגות תחת field restriction.

### 2.3 תחנות ודלתות (`stations/*` 18, `clock/station_sync`, `acceptance/*`)
- `integrated_locks[]`: `physical_index`, שם, האם מנוהל, מתי Relay 2 מוצג. תוצאות `stations/test_unlock`: `release_in_progress`,
  `release_unconfirmed`, `connection_closed`, `lock_not_managed`, `station_offline`, `unmanaged_lock`, `invalid_lock`.
  מה בדיוק אומרת תשובת הצלחה (הבקשה התקבלה? הממסר דיווח?), והאם יש readback או אירוע שמאשר פתיחה.
- `stations/technical_get|update|relays`: כל הגדרה, יכולות לפי דגם וקושחה, ומה דורש preview.
- `stations/rescan`, `stations/clock_refresh`, `clock/station_sync`: תופעות על העמדה, משך, התנהגות באי־זמינות.

### 2.4 אנשים (`users/*` 35)
- מודל האדם המלא (ראו 7), `users/query` עם כל ה‑`filters` האפשריים, `sort`, saved views (האם בצד שרת).
- `users/create|update`: מבנה `data` המלא (assignments, `allowed_locks`, `group_ids`, `permission_overrides`, `profile`,
  `valid_from|until`, `access_timing_policy` / `access_timing_draft`, `access_category`, `responsible_person`,
  `access_purpose`, photo), `sync_now` (ברירת מחדל true), והשדות שאסור לשלוח תחת field restriction.
- `users/delete` מול `users/archive` מול `users/set_active` מול `users/temporary_cancel`: מה קורה בעמדות בכל אחד,
  `delete_not_verified`, `access_removal_pending`, tombstones.
- `users/photo_get`: פורמט, גודל, cache, ומתי מותר.

### 2.5 כרטיסים ו‑PIN (`cards/*` 7, `users/pin_check|pin_generate`)
- `pin_generate`: אורך, ייחודיות גלובלית, האם ה‑PIN נשמר מיד או רק ב‑`users/update` הבא, ואיפה הוא מופיע פעם אחת.
- מחזור `cards/capture_start → capture_status → capture_confirm | capture_cancel`: מצבים, timeouts, קורא USB מול קורא
  עמדה (`reader_capabilities`), `capture_station_busy`, `capture_limit`, קשירה לשחקן (איך זה עובד בסשן מואצל), ומה
  קורה ב‑revision חדש של האדם באמצע. האם `capture_status` נשאל או נדחף.
- `cards/add|remove`: פורמט מספר כרטיס, `card_type`, `masked_number`, `duplicate_card`, `card_owned_elsewhere`,
  `card_capacity`, `card_removal_pending`.

### 2.6 קבוצות ופרופילים (`profiles/*` 6, `permissions/directory`)
- מבנה `profile_settings` המלא: שדות מותאמים (טיפוסים, ייחודיות), קבוצות (`station_ids`, relays), תבניות.
- `settings_preview → settings_apply`: מה ה‑impact מכיל (אנשים מושפעים, עמדות לא מקוונות), `operation_id`, `group_policy_changed`,
  `profile_review_required`; `versions` ו‑`versions_compare`.
- `permissions/directory`: פלט "זכויות אפקטיביות" לאדם, כולל מקור (קבוצה / override).

### 2.7 תוכניות דלת ולוחות זמנים (`stations/technical_program_*`, `technical_hold_*`, `schedules/*` 28)
- ההבדל המדויק בין: לוח זמנים של אדם (`access_timing_policy`, `mode: ha|native`), תוכנית פתיחה של עמדה, hold-open
  מנוהל HA, ספריית `schedules`, `plan`, `operations`, `baseline`. תרשים מצבים לכל אחד, כולל `hold_pause_before_edit`.
- `schedules/plan_preview → plan_save → operations_create → operations_check`: טוקנים, תוקף, בעלות, `claim_*`.
- אילו שגיאות `schedule_*` (כ‑70) מציגים למפעיל, ואילו פנימיות.

### 2.8 קודים ציבוריים (`stations/technical_codes_get|write`)
- slots, מיפוי דלת, `action` (ערכים), `expected`, `old_pin`, `new_pin`: כללי אימות, מה מוחזר ב‑get (אף פעם לא הקוד),
  "לא מאומת", ומה קורה כשהעמדה לא תומכת.

### 2.9 אורחים וביקורים (`visits/*`, `guest_templates/*`, `users/temporary_cancel`, `renewal/*`)
- `VISIT_OPERATIONS_API.md` טוב; חסרים: סכמת `visits/list.filters`, דוגמאות לכל מעבר מצב, התנהגות `superseded`, ו‑
  `renewal/*` (פורטל אישי): האם רלוונטי לסשן מואצל, ומה `personal_allowed` מאפשר.

### 2.10 תהליכים ואישורים (`workflows/*` 19, `jobs/*` 8, `conflicts/*` 4)
- מבנה `workflows/get` המלא, מצבי transfer (`awaiting_approval`, `awaiting_revocation`, `approved`, `cancelled`...),
  `inventory_*`, `renew_*`, `reminder_action`, `template_*`. מה מתוכם מיועד למפעיל ומה למנהל.
- `conflicts/list → review → resolve | resolve_deletion`: סוגי קונפליקט ופתרונות.

### 2.11 אירועים וחקירה (`events/*` 10, `investigations/query`, `audit/*`, `operations/query`)
- רשומת אירוע מלאה (ראו 7), כל ה‑`filters` של `events/list`, cursor, סדר, dedupe, `time_source`, portrait.
- שמירה: 5,000 אירועים או 30 יום. האם יש דרך אמינה לזהות פער (אירועים שנגזמו לפני שקראנו).
- `events/report|export|print|support`: פורמטים, גבולות.

### 2.12 בריאות וצי (`health/*`, `fleet/*`, `sync/*`, `upgrade/readiness`, `platform/*`)
- `health/get`: כל בדיקה, חומרה, ומקור (נצפה מהעמדה מול אישור אנושי). `fleet/alerts`: `kind`, snooze, maintenance.
- `sync/status|diagnostics`: מבנה המטריצה, ומה אומר כל מצב.

### 2.13 מדיה (`media/*` 6) ו‑2.14 הגדרות (`authorization/settings_*`, `appearance/*`, `clock/*`, `whatsapp/*`, `backups/*`)
- `media/settings_get`: כל שדה (`transport`, `webrtc_mode`, `hls_fallback`, `go2rtc_url`, `talk_mode`, `tts_engine_id`,
  `tts_language`, `tts_phrases`, `revision`) ומשמעותו לנגן חיצוני כמו Arx.
- `whatsapp/preview → send`: טוקן, תוקף, `whatsapp_send_uncertain`, מה ה‑provider מאשר.

## 3. אירועים ומנויים

מהקוד: `subscribe` שולח רק `{"kind":"refresh"}`, `{"kind":"access_revoked"}` או `{"kind":"screen_locked"}`, בלי נתונים,
מאוחד בחלון של 0.25 ש', ומאומת מחדש בכל שליחה. אנחנו מבקשים:
1. **רשימה מלאה של כל `send_event` בקוד**, לכל מנוי: `subscribe`, `audio/start` (`ready` + `token`, `closed`...),
   `tts/start` (`generating`, `speaking` + `packet_count`, `completed`, `closed`), ו‑capture / trace / jobs אם יש.
   לכל אירוע: payload מלא, סדר מובטח או לא, איחוד, והאם אחרי `closed` יכול להגיע עוד משהו.
2. **מה גורם ל‑`SIGNAL_ACCESS_CHANGED`**: רשימת כל המקורות (אירוע גישה, צלצול, שינוי מצב עמדה, שמירת אדם, סנכרון,
   הרשאות, הגדרות). כך נדע מה לרענן בכל `refresh`.
3. **הצעה תוספתית (לא שוברת):** `{"kind":"refresh","topics":["stations","users","events","sync","permissions","media"],
   "station_ids":[...]}` כדי שנרענן רק מה שהשתנה. לקוח ישן מתעלם מהשדות. אם לא, תסבירו מה הדרך היעילה.
4. **צלצול:** איך דפדפן יודע שעמדה מצלצלת (`call_state` ב‑overview אחרי `refresh`? אירוע HA `event.*`?), ומה ה‑latency.
5. **Reconnect:** מה חייב להתבצע מחדש, מה נשמר בצד השרת (אם בכלל), ואיך יודעים שהחמצנו אירועים בזמן הניתוק.

## 4. מדיה (וידאו)

1. **MSE/RTC:** פרוטוקול מלא של `/api/hikvision_intercom/mse/{station_id}` ו‑`/rtc/{station_id}`: `auth/sign_path` (תוקף,
   קשירה ל‑refresh token), ה‑greeting (`codecs` / `offer`), הודעות שרת (`mse`, `error` + כל `code`), חלונות timeout,
   `watch_owner` (כל 0.5 ש', מה סוגר את הזרם), `HTTPConflict` כשהמצב לא תואם, 404, 403, 429.
2. **תקרות:** 12 MSE ו‑12 RTC גלובלית למופע HA, ורק מצב אחד פעיל. האם תשקלו תקרה לכל משתמש, או להחריג זרמים שלא
   עוברים דרככם? מה המגבלה בפועל בעמדות Hikvision: כמה סשני RTSP במקביל לכל עמדה (לפי דגם/קושחה), ומה קורה מעבר.
3. **`stream_source`:** האם `IntercomCamera.stream_source()` הוא חוזה יציב שמותר לנו לצרוך (דרך הגשר, בשרת בלבד)? היום
   הוא מחזיר `rtsp://<user>:<pass>@<host>:<port>/Streaming/Channels/101` (הערוץ הראשי). אצלנו WebRTC מפענח רק את
   הפרופיל המשני; האם תוסיפו דרך לקבל ערוץ 102 (תכונה, ישות שנייה, או פרמטר)? מה קורה כשמשנים סיסמה לעמדה (האם
   ה‑URL מתעדכן מיד), ומתי `profile.stream` false.
4. **HLS / ישות HA:** האם WisKey או HA מחזיקים RTSP פתוח ברקע (preload, stream worker), כך שכל צופה נוסף הוא סשן נוסף.
5. **סטילס:** `async_camera_image` (ISAPI snapshot): קצב מותר, cache, זמן תגובה, ומה עדיף עבורנו (`camera_proxy` או go2rtc).
6. **עמדתכם:** האם זה בסדר מבחינתכם ש‑Arx מושך את אותה עמדה ב‑go2rtc משלו (שני שמות זרם = שני סשנים), ואיך נמנע עומס.
   האם תסכימו ש‑WisKey ישתמש ב‑go2rtc של Arx כ‑`go2rtc_url`, כך שיהיה מקור אחד?

## 5. אודיו, שיחות ו‑TTS

1. **מחזור חיים:** `audio/start` (`station_id`) → result → event `ready` + `token` (32 תווים) → `send` (`sequence`, `data`
   base64 באורך 1068 בדיוק) / `receive` (אחד בכל פעם, `audio_backpressure`) / `mute` / `diagnostics` / `stop`. נבקש
   תרשים מצבים, כל אירוע `closed` וסיבותיו, ו‑timeouts (idle, max duration).
2. **קודק:** G.711 µ-law 8 kHz: גודל מסגרת, ms למנה, קצב שליחה צפוי, jitter buffer, המרת קצב דגימה בדפדפן (AudioWorklet),
   echo cancellation, half/full duplex, והתנהגות `talk_mode` (PTT / toggle).
3. **מגבלות:** עד 3 סשני אודיו+TTS גלובלית, אחד לכל עמדה, אחד לכל חיבור (`audio_busy`). בסשן מואצל: האם "חיבור" = סשן
   מואצל? האם מפעיל אחד יכול להאזין לעמדה A ולשלוח TTS לעמדה B?
4. **שיחה:** `media/call` (מה מוחזר) ו‑`media/signal` (`answer`, `reject`, `hangUp`): מעברי מצב, מה נסגר אוטומטית, ומה
   קורה כששני מפעילים עונים יחד.
5. **TTS:** `tts/engines` → `tts/start` (`station_id`, `engine_id`, `language`, `message` 1-500 תווים): שגיאות
   (`tts_generation_timeout`, `tts_audio_format`...), תחרות עם מיקרופון.
6. **דפדפן:** הרשאת מיקרופון, user gesture, iOS/Companion, רקע, יציאת שמע (`BROWSER_AUDIO_OUTPUT.md`).
7. **הוכחה:** מה נחשב אצלכם הוכחה לדיבור דו‑כיווני (לא `diagnostics` בלבד): אדם ליד העמדה, הקלטה, מספרים.

## 6. שימוש חוזר ב‑UI: חבילת web components

אם אתם מסכימים, נבקש חבילה מגורסת (`@wiskey/components` או ESM bundle בזיפ) עם `ADAPTER.md`. הרכיבים משתמשים היום
בממשק `Hass` מצומצם (`types.ts`): `language`, `themes.darkMode`, `user{id,is_admin}`, `states`, `callWS`, `callApi?`,
`connection{connected, addEventListener, subscribeMessage}`. אנחנו יכולים לספק מתאם שבו `callWS` ו‑`subscribeMessage` עוברים
לשרת Arx ומשם לסשן המואצל. מה שלא נוכל לספק: `auth/sign_path`, `camera/stream`, `callApi` כללי, ו‑`states` מלא.

**הרכיבים שאנחנו רוצים ראשונים:** (1) כרטיסי overview / מרכז כניסה (`wiskey-v4-overview` כרכיב); (2) ספריית אנשים +
פרטי אדם (`wiskey-user-details`, `hikvision-user-photo`); (3) ציר אירועים (`hikvision-intercom-events`); (4) כרטיס תחנה;
(5) אישור שחרור דלת (בחירת ממסר + אישור); (6) קליטת כרטיס (`wiskey-usb-card-input` + זרימת capture); (7) פקדי שיחה
(`hikvision-intercom-call-controls`, `hikvision-intercom-audio-controls`, `wiskey-intercom-tts`).

**חוזה המתאם שנבקש שתתעדו:**
- mount / unmount: מאפיינים, אירועי lifecycle, ומה נסגר ב‑`disconnectedCallback` (מדיה, אודיו, מנויים, טיימרים).
- routing: הרכיב לא נוגע ב‑`location`; מבקש ניווט באירוע (`wiskey-navigate` עם `{screen, station_id, user_id}`).
- CSS: Shadow DOM, רשימת CSS custom properties (tokens) שמותר לנו לדרוס, בלי סגנונות גלובליים, בהיר/כהה.
- i18n ו‑RTL: `language` ו‑`dir` כמאפיינים, בלי קריאה ל‑`hass.language` בלבד.
- אירועים יוצאים: שמות, payload, bubbles/composed (toast, busy, error, open-person, open-station, confirm-request).
- מדיה: hook `mediaProvider` (station_id → element או URL) כדי שהנגן יעבוד מול ה‑relay שלנו.
- `customElements.define` בלי התנגשות (prefix או scoped registry), גרסת `lit` כ‑peer, בלי side effects בייבוא.
- `hass.user.is_admin`: מה הרכיב מסיק ממנו, כי אנחנו נעביר את התוצאה של `authorization/session` המואצל.

## 7. מילון מודל הנתונים

לכל ישות: רשימת שדות (טיפוס, nullable, מקור, מי כותב), מזהה (פורמט, יציבות), invariants, מחזור חיים, ומה מופיע תחת
רדקציה. הישויות: **person** (כולל `employee_no`, `display_name`, `phone`, `active`, `revision`, `assignments`, `profile`,
`group_ids`, `permission_overrides`, `valid_from|until`, `access_timing_*`, `access_category`, `pin_configured`, `cards`,
`photo_configured`, archive); **credential** (PIN, card: `card_no` מול `masked_number`, `card_type`, `enabled`, `label`);
**assignment** (`enabled`, `allowed_locks`, `sync_state` וערכיו, `desired_revision`, `applied_revision`, `last_sync_at`, `last_error`);
**group / profile**; **station** (מזהה = config entry id); **door/relay** (`physical_index` 1/2, מנוהל/לא);
**schedule** (אדם / תוכנית עמדה / hold / ספרייה / plan / operation); **public code** (slot, door, מצב);
**visit request**; **workflow** (approval, transfer, renewal, inventory); **event** (מזהה, זמן, `time_source`, station, door,
identity, authentication, result, portrait). ובנוסף: כללי זמן (UTC, אזור זמן של עמדה, `default_zone`) וכללי טלפון.

## 8. אבטחה וקבלה

1. **שער D (כתיבות):** מה אתם מחשיבים הוכחה שכתיבה דרך Arx שקולה לכתיבה בפאנל: אותה רשומת אודיט (+`via`), אותו מצב
   שמור, דחייה במשתמש לא מורשה, `revision_conflict`, תשובה שאבדה, עמדה מנותקת, סנכרון חלקי. תנו רשימת בדיקות
   שתריצו אצלכם מול הסשן המואצל (בדיקות יחידה + HA אמיתי).
2. **שער E (שטח):** 10 זרמים חיים, פתיחה פיזית, אודיו דו‑כיווני, Companion: מה נחשב ראיה (זמן, דגם, קושחה, דפדפן).
3. **ייחוס:** איך תרצו לראות את Arx באודיט ובמסכים שלכם (`via`, תווית, סינון לפי via).
4. **מדיניות:** ברירות המחדל של `idle_minutes`, `reauth_sensitive`, `dual_approval`, והמלצתכם למתקן עם Arx.
5. **חשבון שירות:** האם תעדיפו שערוץ הרקע של Arx (רק `subscribe` והקרנות בלי נתוני אנשים) ירוץ כמשתמש HA ייעודי
   לא‑admin עם הרשאות מינימליות, במקום `Supervisor`? אילו הרשאות הייתם נותנים לו?

## 9. דרך העבודה ופורמט המסירה

### 9.1 איך נרצה לעבוד יחד
1. **מסמך החלטות משותף אחד** (`DECISIONS_WISKEY_ARX.md`, אצלכם או אצלנו, לבחירתכם): כל החלטה עם תאריך, מי הציע, מה
   הוחלט, וגרסה. שיטת הזהות היא ההחלטה הראשונה בו.
2. **מסירות מגורסות:** כל חבילה עם מספר גרסה, commit ו‑`CHANGES_SINCE_<previous>.md`. אנחנו עונים באותה צורה.
3. **רשימת אימות קצרה ומשותפת על המערכת החיה של בעל המוצר, קריאה בלבד קודם:** מה WisKey רואה בפועל ל‑`SUPERVISOR_TOKEN`,
   הגדרות `idle_minutes` / `reauth_sensitive` / `dual_approval` במתקן, איזה go2rtc משמש אתכם, ו‑`authorization/session`
   של מפעיל רגיל מול מנהל. כתיבות, פתיחת דלת ואודיו רק אחרי אישור מפורש של בעל המוצר, צעד אחר צעד.
4. **ערוץ קשר:** דרך בעל המוצר. שאלות פתוחות נאספות למסמך אחד ממוספר, לא בהודעות מפוזרות.

### 9.2 פורמט המסירה

ZIP אחד, מגורסת (למשל `wiskey-arx-native-contract-<version>.zip`), עם:
- `README.md`: גרסת WisKey, commit, תאריך, מה נבדק ומה לא (NOT_RUN במפורש).
- `CHANGES_SINCE_RC37.md`: כל שינוי מאז rc.37 שנוגע לפקודות, סכמות, שגיאות, מדיה או UI.
- `DELEGATION.md` (אם מאושר), `SCOPES.md` (סעיף 1.2 המעודכן), `MEDIA.md`, `AUDIO.md`, `ADAPTER.md`, `DATA_MODEL.md`.
- `schemas/<area>/<command>.request.json` + `.response.json` לכל פקודה (או `catalog.asyncapi.json` אחד), כולל
  `subscribe`, `audio/*`, `tts/*`, ו‑MSE/RTC.
- `errors/catalog.json`: `code` → פקודות, משמעות, retry בטוח, פעולת UI מומלצת, מפתח תרגום.
- `events/`: כל אירוע מנוי עם סכמה ודוגמה.
- `examples/`: לכל פקודת P1 ו‑P2 בקשה, תשובה ושגיאה אמיתיות, מנוקות (בלי IP, סיסמה, PIN, כרטיס מלא, טלפון אמיתי).
- `components/` (אם סעיף 6 מאושר): החבילה, `CHANGELOG`, וסיפור דוגמה שמרכיב כל רכיב עם מתאם מדומה.
- `ANSWERS.md`: תשובה לכל שאלה בסעיף 10 לפי המספור שלה, עם "כן / לא / ראו קובץ X".

**כלל:** אין שינוי בחוזה v1 או באחסון בלי תיאום. כל תוספת: לא שוברת, מתועדת, עם ברירת מחדל.

## 10. שאלות (נא לענות לפי המספר)

**א. זהות והאצלה**
- 1.1 **ההחלטה המשותפת:** אילו מהשיטות (a+), (b), (c) WisKey יכול לתמוך בהן, ובאיזו אתם בוחרים? (א) (a+) כפי שהוצעה;
  (ב) (a+) בשינויים (פרטו); (ג) (b) בלבד; (ד) (c): הצעה משלכם (פרטו); (ה) צריך שיחה נוספת לפני החלטה.
- 1.2 אם (a+): in-process (`delegation.async_register/async_open`) או פקודת WS חתומה? מה שורש האמון שבחרתם, ולמה?
- 1.3 האם סשן מואצל מתנהג כמו `ActiveConnection` לכל דבר (אבטחה, אודיו, capture, מנויים)? מה שונה?
- 1.4 אילו פקודות לא יהיו ניתנות להאצלה בכלל?
- 1.5 אילו שדות `via` יופיעו באודיט, ב‑`audit/list` וב‑CSV? האם גם בדחיות (`audit_denial`)?
- 1.6 נעילת idle בסשן מואצל: (א) כמו חיבור רגיל, עם `security/touch` מ‑Arx; (ב) פטור לקריאה בלבד; (ג) אחר.
- 1.7 `reauth_sensitive`: האם תספקו דף reauth באותו origin שמעלה סשן מואצל? אם לא, מה Arx אמור להציג?
- 1.8 rate limit: דלי נפרד למשתמש מואצל, או משותף עם הפאנל שלו? מה המגבלה הכוללת לכל ה‑delegates?
- 1.9 מתג הכיבוי: שם ההגדרה, איפה במסך, ומה נשלח לסשנים פתוחים כשמכבים.
- 1.10 מה קורה לסשן מואצל כשמשתמש ה‑HA מושבת, נמחק, או הופך ל‑admin / מפסיק להיות admin?
- 1.11 מה אתם צריכים מאיתנו (חתימה, צימוד, תוויות, מגבלות, דיווחים) כדי שהאודיט והאישור הכפול יישארו בעלי משמעות?
- 1.12 האם יש לכם כבר מנגנון שלא הכרנו (מיפוי מפעילים, מפתחות API, "act-as") שעדיף עליו?

**ב. scopes והרשאות**
- 2.1 טבלת ההרשאות לכל פקודה (סעיף 1.2): האם תפיקו אותה מהקוד (כמו הקטלוג) כך שתישאר מעודכנת?
- 2.2 `profile_fields` ו‑`station_groups`: המסמך מתאר קטגוריה; הקוד מאפשר שדה בודד. מה החוזה?
- 2.3 ערכי placeholder המדויקים לכל שדה מוסתר, ואיך מבדילים "מוסתר" מ"ריק".
- 2.4 איך UI מזהה זהות משותפת לפני ניסיון כתיבה?
- 2.5 רשימת כל הפעולות תחת `dual_approval`, ומי רשאי לאשר כל אחת.
- 2.6 `permissions_changed`: איך בודקים אם הכתיבה הושלמה בכל זאת?

**ג. פקודות**
- 3.1 האם תספקו JSON Schema לכל פקודה, שנוצר מהקוד ונבדק בטסטים? באיזה פורמט?
- 3.2 קטלוג שגיאות אחד עם "retry בטוח" לכל קוד: אפשרי?
- 3.3 אילו פקודות idempotent, ולאילו יש receipt עמיד (למשל `backups/apply`, `users/bulk_receipt`)?
- 3.4 `users/create|update`: מבנה `data` המלא, כולל `access_timing_policy` ו‑`assignments`.
- 3.5 `stations/test_unlock`: מה תשובת הצלחה מוכיחה, והאם יש אירוע או readback שמאשר פתיחה?
- 3.6 מצבי `sync_state` האפשריים, ואיזה מהם נחשב "אומת בשטח".
- 3.7 `overview` מול `overview/summary`: מה מומלץ לסקירה שמתרעננת כל כמה שניות ב‑12 תחנות?
- 3.8 `audio/*`, `tts/*` ו‑`subscribe` לא מופיעים ב‑`overview.api.commands`. איך לקוח יודע שהם זמינים למשתמש הזה?
- 3.9 `events/list`: כל ה‑filters, ה‑cursor, ואיך מזהים פער שמירה (5,000 / 30 יום).
- 3.10 זרימת capture בסשן מואצל: האם `capture_status` נדחף כאירוע או נשאל?

**ד. אירועים**
- 4.1 רשימת כל מקורות `refresh`, ורשימת כל אירועי המנויים (audio, tts, capture) עם payload.
- 4.2 האם תוסיפו `topics` / `station_ids` ל‑`refresh` באופן תוספתי?
- 4.3 איך מזהים צלצול בזמן אמת, ומה ה‑latency?

**ה. מדיה**
- 5.1 האם צריכת `stream_source` של ישות המצלמה דרך הגשר שלנו (בשרת בלבד) נתמכת ויציבה?
- 5.2 האם תספקו גם זרם משני (ערוץ 102) לצריכה חיצונית?
- 5.3 כמה סשני RTSP במקביל עמדות Hikvision שלכם מחזיקות, לפי דגם, ומה קורה מעבר?
- 5.4 האם WisKey יכול להשתמש ב‑go2rtc של Arx כ‑`go2rtc_url`, כדי שיהיה מושך אחד לכל עמדה?
- 5.5 האם התקרה של 12 תישאר גלובלית, ומה עמדתכם לגבי קיר ב‑Arx שלא עובר דרככם?
- 5.6 קצב snapshot מותר לעמדה.

**ו. אודיו ושיחות**
- 6.1 תרשים מצבים מלא של `audio/*` ו‑`tts/*`, כולל timeouts וסיבות `closed`.
- 6.2 פרטי מסגרת G.711 (בייטים, ms, קצב), full/half duplex, ואיך PTT ממומש.
- 6.3 שני מפעילים עונים לאותה שיחה: מה קורה?
- 6.4 מה הוכחה מקובלת אצלכם לדיבור דו‑כיווני?

**ז. UI**
- 7.1 האם תספקו חבילת web components מגורסת עם `ADAPTER.md`? מתי?
- 7.2 אילו מבין 7 הרכיבים בסעיף 6 אפשריים בלי `auth/sign_path` ו‑`camera/stream`?
- 7.3 האם תוסיפו hook `mediaProvider` ואירוע `wiskey-navigate`?
- 7.4 רשימת ה‑CSS tokens שמותר לנו לדרוס.

**ח. קבלה ומסירה**
- 8.1 רשימת הבדיקות שתריצו מול סשן מואצל, ומה לא תוכלו לבדוק בלי ציוד.
- 8.2 חשבון שירות לא‑admin לערוץ הרקע: כן או לא, ואילו הרשאות.
- 8.3 הגרסה והתאריך המשוערים של חבילת המסירה, ומה ייכנס בה ומה יידחה.
- 8.4 מה עוד חסר לנו כדי לממש, לדעתכם, שלא שאלנו?
