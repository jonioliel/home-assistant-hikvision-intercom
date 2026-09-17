/* Design-only views. Synthetic data; no API requests or persistence. */
window.VIEWS ||= {};
(() => {
  const crumb = title => H.crumb(["ניהול", title]);
  const actions = (save = "שמירת הגדרות") => H.btn("ביטול", "management") + H.btn(save, "", "primary", "check");
  const line = (title, subtitle, end = "") => `<div class="list-line"><div><strong>${title}</strong><p>${subtitle}</p></div><span class="spacer"></span>${end}</div>`;
  const detail = rows => `<dl class="detail-list">${rows.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const selectCell = value => `<select aria-label="רמת הרשאה" style="width:100%;min-width:107px;min-height:39px;border:1px solid var(--line);border-radius:7px;padding:6px;background:var(--paper);color:var(--ink)">${["ללא גישה","צפייה","ניהול"].map((v,i)=>`<option ${i===value?'selected':''}>${v}</option>`).join("")}</select>`;
  const tool = (title, description, to, ico) => `<a class="card settings-tile" href="#${to}" data-go="${to}"><span class="settings-icon">${H.icon(ico)}</span><div><h3>${title}</h3><p>${description}</p></div></a>`;
  const toolbar = label => `<div class="toolbar"><div class="search">${H.icon("search")}<input aria-label="${label}" placeholder="${label}"></div>${H.btn("סינון", "", "small", "filter")}${H.btn("ייצוא", "", "small", "download")}</div>`;
  const stat = (number,label) => `<div class="stat"><strong>${number}</strong><span>${label}</span></div>`;

  Object.assign(window.VIEWS, {
    management: () => `${H.head("ניהול", "ההגדרות והכלים שמחזיקים את בקרת הכניסה מסודרת.", H.btn("בריאות המערכת", "health", "soft", "activity"))}
      <div class="summary-strip"><span>${H.badge("המערכת זמינה")}</span><span><strong>8</strong>תחנות</span><span><strong>1</strong>פריט דורש טיפול</span><span class="spacer"></span><span>העדכון האחרון: היום, <bdi>09:42</bdi></span></div>
      <h3 class="section-label">אנשים והרשאות</h3><div class="settings-grid">
        ${tool("שדות וקבלת משתמש", "מחלקה, תפקיד, צילום ותבניות קליטה.", "fields", "users")}
        ${tool("הרשאות משתמשי HA", "מי יכול לראות ולנהל כל אזור במערכת.", "ha-permissions", "shield")}
        ${tool("תבניות WhatsApp", "מבנה הודעות הגישה ותצוגה לפני שליחה.", "templates", "message")}
      </div>
      <h3 class="section-label section-gap">תפעול ובקרה</h3><div class="settings-grid">
        ${tool("סנכרון", "מצב האנשים בכל תחנה וטיפול ממוקד בחריגות.", "sync", "refresh")}
        ${tool("בריאות המערכת", "זמינות, זמני תגובה ומצב התורים.", "health", "activity")}
        ${tool("יומן ניהול", "מי שינה הרשאה, קוד או הגדרת מערכת.", "audit", "document")}
      </div>
      <h3 class="section-label section-gap">מערכת ותצוגה</h3><div class="settings-grid">
        ${tool("מראה המערכת", "בחירת עיצוב כברירת מחדל לכל המשתמשים.", "appearance", "palette")}
        ${tool("וידאו ושמע", "ניגון מצלמות, שירות go2rtc ומיקרופון.", "media", "camera")}
        ${tool("שעונים ו־NTP", "שרת זמן משותף וסנכרון התחנות.", "clocks", "clock")}
      </div>
      <div class="section-gap">${H.card("כלים מתקדמים", `<div class="actions">${H.btn("ספריית לוחות", "schedule-library", "quiet")}${H.btn("פריסת לוח", "deployment", "quiet")}${H.btn("מפת הרשאות", "permission-directory", "quiet")}${H.btn("דוחות", "reports", "quiet")}${H.btn("יומן פעולות לוח", "operation-journal", "quiet")}</div>`)}</div>`,

    fields: () => `${crumb("שדות וקבלת משתמש")}${H.head("שדות וקבלת משתמש", "התאמת כרטיס האדם לסוג הארגון שלכם.", actions())}
      <div class="columns"><div class="stack">${H.card("שדות מותאמים", H.table(["שם השדה", "סוג", "חובה", "מצב", ""], [
        ["מחלקה", "רשימת בחירה", H.check("", true), H.badge("פעיל"), H.btn("עריכה", "", "small")],
        ["תפקיד", "טקסט", H.check("", false), H.badge("פעיל"), H.btn("עריכה", "", "small")],
        ["מספר בניין", "מספר", H.check("", false), H.badge("לא פעיל", ""), H.btn("עריכה", "", "small")]
      ]), H.btn("הוספת שדה", "", "small", "plus"))}
      ${H.card("עריכת שדה · מחלקה", `<div class="field-grid">${H.field("שם בתצוגה", "מחלקה")}${H.select("סוג השדה", ["טקסט", "רשימת בחירה", "מספר", "תאריך"], 1)}${H.field("אפשרויות לבחירה", "הנהלה, אחזקה, הדרכה, קבלנים", {full:true,hint:"ניתן לשנות את הכותרת לדירה או לבניין בהתאם לפרויקט."})}</div><div class="actions section-gap">${H.check("השדה פעיל",true)}${H.check("חובה בעת הקמה",true)}</div>`)}
      ${H.card("תבניות קליטה", line("מדריך", "קבוצת צוות הדרכה · מחלקה ותפקיד לבחירה",H.btn("עריכה","","small"))+line("ספק", "קבוצת ספקים · פרטים כלליים",H.btn("עריכה","","small")), H.btn("תבנית חדשה","","small","plus"))}</div>
      <div class="stack">${H.card("תמונה בכרטיס האדם", `<div class="person-banner"><span class="avatar large">נל</span><div><h3>נועה דגן</h3><p class="sub">דוגמה לכרטיס אדם</p></div></div><div class="list-line"><div><strong>אפשרות לצילום משתמש</strong><p>מצלמת המחשב או הנייד, עם אישור לפני שמירה.</p></div><span class="toggle on"></span></div>${H.note("התמונה משמשת לזיהוי בממשק WisKey. היא אינה מגדירה זיהוי פנים בתחנה.")}`)}
      ${H.card("שינויים שמשפיעים על אנשים", `<p class="guide-note">לפני החלת שינוי בקבוצות או בתבניות, נציג את האנשים וההרשאות שיושפעו. שינוי כותרת שדה לא מוחק את הערכים הקיימים.</p>${H.btn("סקירת השינוי","group-review","soft")}`)}</div></div>`,

    templates: () => `${crumb("תבניות הודעה")}${H.head("תבניות WhatsApp", "הודעה אישית וברורה, עם אפשרות לערוך לפני כל שליחה.", actions("שמירת תבנית"))}
      <div class="card pad"><div class="field-grid">${H.select("שפת ההודעה", ["עברית", "English"])}${H.select("סוג הנוסח", ["ללא הגבלת זמן", "עם הגבלת זמן"], 1)}</div><p class="guide-note section-gap">ארבע תבניות: עברית ואנגלית, עם הגבלת זמן או בלעדיה. פרטי הקוד או הכרטיס מתמלאים לפי אמצעי הכניסה של האדם.</p></div>
      <div class="columns equal section-gap"><div class="card"><div class="card-head"><div><h2>עברית · עם הגבלת זמן</h2><p>שדות דינמיים מתמלאים מכרטיס האדם.</p></div>${H.btn("שחזור ברירת מחדל","","quiet")}</div><div class="pad stack">
      ${H.field("שם הארגון", "מרכז קהילתי לדוגמה")}
      <label class="field">נוסח התבנית<textarea rows="12">שלום {{name}}, 👋

🏫 {{organization}}
פרטי הגישה שלך ב־WisKey 🔐

{{credential_section}}

{{doors_section}}

{{access_window_section}}

{{security_notice}}</textarea><small>יש לשמור את שם המשתמש ואת אמצעי הכניסה. בנוסח עם הגבלת זמן נדרש גם {{access_window_section}}.</small></label>
      <div class="stack"><div><span class="chip">שם · <bdi>{{name}}</bdi></span><span class="chip">ארגון · <bdi>{{organization}}</bdi></span></div><div><span class="chip">אמצעי כניסה · <bdi>{{credential_section}}</bdi></span><span class="chip">דלתות · <bdi>{{doors_section}}</bdi></span></div><div><span class="chip">זמנים · <bdi>{{access_window_section}}</bdi></span><span class="chip">שמירת סודיות · <bdi>{{security_notice}}</bdi></span></div></div></div></div>
      <div class="stack"><div class="card"><div class="card-head"><div><h2>כך זה ייראה</h2><p>איתי רז · דוגמת מילוי עם כרטיס בלבד</p></div>${H.badge("תצוגה מקדימה","blue")}</div><div class="chat"><div class="chat-date">היום</div><div class="bubble">שלום איתי רז, 👋

🏫 מרכז קהילתי לדוגמה
פרטי הגישה שלך ב־WisKey 🔐

💳 הכניסה שלך מתבצעת באמצעות כרטיס.

🚪 הדלתות המורשות שלך:
1. כניסה ראשית
2. אגף מזרח
3. כניסת עובדים
4. חצר
5. אולם מרכזי
6. מחסן

📆 ראשון עד חמישי
⌚ 08:00–17:00

הכרטיס אישי ואינו ניתן להעברה.<time>09:42</time></div></div></div>${H.note("שמירת תבנית אינה שולחת הודעות. בכל שליחה יוצגו הנמען והטקסט לאישור ולעריכה.")}</div></div>`,
    media: () => `${crumb("וידאו ושמע")}${H.head("וידאו ושמע", "הגדרות משותפות לכל התחנות והמשתמשים.", actions())}
      <div class="columns"><div class="stack">${H.card("ניגון מצלמות", `<div class="field-grid">${H.select("מסלול וידאו", ["WebRTC / go2rtc", "HLS"], 0)}${H.select("אופן הניגון ב־go2rtc", ["MSE", "RTC"], 0)}</div><div class="list-line"><div><strong>מעבר ל־HLS במקרה הצורך</strong><p>מאפשר ניסיון במסלול חלופי כשהמסלול שנבחר אינו זמין.</p></div><span class="toggle on"></span></div>${H.note("MSE מעביר את הווידאו בחיבור לדפדפן; RTC תלוי גם בתקשורת המדיה ברשת. בחירת וידאו אינה משנה את מסלול הדיבור לאינטרקום.")}`)}
      ${H.card("שירות go2rtc", `<div class="field-grid">${H.field("כתובת השירות", "http://go2rtc:1984", {full:true,dir:"ltr",hint:"כתובת לשימוש מתוך HA; פרטי הזדהות אינם נכנסים לכתובת בדפדפן."})}</div><div class="actions section-gap">${H.btn("בדיקת שירות","","soft","refresh")}${H.badge("הבדיקה האחרונה הצליחה")}</div>`)}
      ${H.card("אופן הדיבור", `<div class="stack"><div class="choice-card selected"><span class="radio"></span><div><h3>פתיחת מיקרופון בלחיצה</h3><p>לחיצה אחת לדבר, לחיצה נוספת לסגור. מתאים במיוחד לנייד.</p></div></div><div class="choice-card"><span class="radio"></span><div><h3>לחיצה ממושכת · PTT</h3><p>המיקרופון פעיל כל עוד מחזיקים את הכפתור.</p></div></div></div>`)}</div>
      <div class="stack">${H.card("מבט על מסך השיחה", `${H.camera("כניסה ראשית")}<div class="actions section-gap">${H.btn("שמע","","small","speaker")}${H.btn("פתיחת מיקרופון","","small","microphone")}</div><p class="guide-note section-gap">השמע נפתח רק בפעולה של המשתמש. היציאה מהשיחה או מעבר לרקע סוגרים אותו.</p>`, H.btn("הצגת המסך","call","small"))}${H.note("בחירת התקן המיקרופון ואבחון שמע זמינים בחלון השיחה, בלי להעמיס על פעולות המענה.")}</div></div>`,

    clocks: () => `${crumb("שעונים ו־NTP")}${H.head("שעונים ו־NTP", "שעה עקבית באירועים, בתוכניות ובכל תחנות הכניסה.", H.btn("סנכרון כל התחנות","","primary","refresh"))}
      <div class="columns"><div class="stack">${H.card("שרת זמן משותף", `<div class="field-grid">${H.field("שרת NTP", "time.google.com", {dir:"ltr"})}${H.field("פורט", "123", {dir:"ltr"})}${H.field("מרווח עדכון · דקות", "60", {dir:"ltr"})}${H.select("תצוגת אזור זמן", ["לפי הגדרת התחנה", "אזור זמן ידני"], 0)}</div><div class="actions section-gap">${H.btn("שמירת שרת","","primary")}${H.btn("החלה על התחנות","","soft")}</div><p class="guide-note section-gap">שמירת ההגדרה אינה משנה שעונים. החלה וסנכרון הם פעולות נפרדות.</p>`)}
      ${H.card("מצב התחנות", H.table(["תחנה","הפרש משעת HA","עדכון אחרון",""],[
        ["כניסה ראשית",'<bdi>+0.4 s</bdi>',"היום, 09:40",H.btn("סנכרון","","small")],
        ["כניסת עובדים",'<bdi>−0.8 s</bdi>',"היום, 09:40",H.btn("סנכרון","","small")],
        ["אגף מערב",H.badge("אין תקשורת","warn"),"אתמול, 18:10",'<button class="btn small" disabled>סנכרון</button>']
      ]))}</div><div class="stack">${H.card("שעת המערכת", `<strong class="num" style="font-size:34px">09:42:18</strong><p class="muted">17 בספטמבר 2026 · <bdi>Asia/Jerusalem</bdi></p><div class="section-gap">${detail([["מקור","Home Assistant"],["מצב מארח","נתוני מערכת זמינים"],["שעון תחנה","אזור זמן ושעון קיץ נשמרים"]])}</div>`)}${H.note("הגדרת שרת הזמן כאן מיועדת לתחנות. הגדרות הזמן של מערכת ההפעלה שמריצה את HA מנוהלות במארח.")}${H.note("שינוי שעון יכול להשפיע על שעות הרשאה ותוכניות פתיחה. בסיום תוצג תוצאה נפרדת לכל תחנה.","warn")}</div></div>`,

    appearance: () => `${crumb("מראה המערכת")}${H.head("מראה המערכת", "בחרו את העיצוב שיוצג כברירת מחדל לכל משתמשי WisKey.", actions("קביעת ברירת מחדל"))}
      <div class="card"><div class="card-head"><div><h2>שלושה עיצובים, אותה מערכת</h2><p>הנתונים, ההרשאות והפעולות נשארים כפי שהוגדרו.</p></div>${H.badge("בחירה משותפת","blue")}</div><div class="pad"><div class="theme-grid">
      ${[["current","העיצוב המקורי","הפריסה המקורית המוכרת."],["modern","העיצוב הקיים","הפריסה המעודכנת הזמינה היום."],["new","WisKey Access","בקרת כניסה ברורה, ממוקדת ונעימה."]].map(([cls,name,sub])=>`<button type="button" data-demo="תצוגה מקדימה בלבד" class="theme-card ${cls==='new'?'selected':''}" style="text-align:start;background:var(--paper);color:var(--ink)"><div class="theme-mini ${cls}"><header></header><article><i></i><i></i><i></i><i></i><i></i><i></i></article></div><h3>${name}${cls==='new'?' ✓':''}</h3><p>${sub}</p></button>`).join("")}</div><div class="actions section-gap">${H.btn("תצוגה מקדימה","overview","soft")}${H.badge("נבחר: WisKey Access")}</div></div></div>
      <div class="columns equal section-gap">${H.card("איך הבחירה תחול?", `<div class="stack">${line("ברירת מחדל אחת", "הבחירה נשמרת במערכת וחלה גם בדפדפן חדש. בחירות מקומיות ישנות אינן מחליפות אותה.")}${line("בלי להפריע לעבודה", "עורך או שיחה פעילים יסיימו לפני שהעיצוב יתעדכן.")}${line("אפשר לחזור בכל עת", "שני העיצובים הקיימים נשארים זמינים לבחירה.")}</div>`)}${H.card("נגישות ותצוגה", `<div class="field-grid">${H.select("מצב צבע", ["לפי Home Assistant", "בהיר · תצוגה מקדימה", "כהה · תצוגה מקדימה"], 0)}</div><p class="guide-note section-gap">העיצוב מותאם למחשב, טאבלט ונייד. כיוון השפה, גודל הטקסט המועדף והגדרות התנועה של המכשיר נשמרים.</p>${H.note("זו הצעת עיצוב. שמירת ברירת המחדל המרכזית היא חלק מהמימוש שיוסף לאחר האישור.")}`)}</div>`,

    "ha-permissions": () => `${crumb("הרשאות משתמשי HA")}${H.head("הרשאות משתמשי Home Assistant", "החליטו מי יכול לצפות ומי רשאי לבצע שינויים.", actions("שמירת הרשאות"))}
      ${H.note("מנהלי Home Assistant תמיד מקבלים גישה מלאה. משתמשים אחרים מקבלים רק את האזורים שבחרתם עבורם.")}
      <div class="card section-gap">${toolbar("חיפוש משתמש Home Assistant")}${H.table(["משתמש","גישה","סקירה ושליטה","אנשים","פעילות ודוחות","תחנות","כלי ניהול"],[
        [H.person("מנהל המערכת","ממ","מנהל HA"),H.badge("מנהל"),'<span class="muted">ניהול מלא</span>','<span class="muted">ניהול מלא</span>','<span class="muted">ניהול מלא</span>','<span class="muted">ניהול מלא</span>','<span class="muted">ניהול מלא</span>'],
        [H.person("נועה דגן","נל","צוות קבלה"),H.check("",true),selectCell(2),selectCell(1),selectCell(1),selectCell(0),selectCell(0)],
        [H.person("רון שלו","רש","אחראי תפעול"),H.check("",true),selectCell(2),selectCell(2),selectCell(1),selectCell(2),selectCell(1)],
        [H.person("מיה הדר","מה","משתמש HA"),H.check("",false),selectCell(0),selectCell(0),selectCell(0),selectCell(0),selectCell(0)]
      ])}<div class="status-legend"><span>ללא גישה · האזור מוסתר</span><span>צפייה · ללא שינוי נתונים</span><span>ניהול · צפייה וביצוע פעולות</span></div></div>
      <div class="columns equal section-gap">${H.card("כל פעולה נבדקת", `<p class="guide-note">ההרשאות נאכפות גם בשרת. ביטול הרשאה מפסיק גישה וזרמים פעילים. הזזת מסך בתפריט אינה נותנת הרשאה נוספת.</p>`)}${H.card("הופעה בסרגל Home Assistant", `<p class="guide-note">ייתכן שסמל WisKey יופיע גם למשתמש שלא הוגדר. הוא יקבל מסך חסום, בלי נתוני אנשים, תחנות או אירועים.</p>`,H.btn("הדמיית צפייה בלבד","restricted","small"))}</div>`,

    health: () => `${crumb("בריאות המערכת")}${H.head("בריאות המערכת", "המצב התפעולי, עם מקום ברור להתחיל ממנו כשמשהו דורש טיפול.", H.btn("בדיקה מחדש","","primary","refresh"))}
      <div class="stat-grid">${stat("7 / 8","תחנות מחוברות")}${stat("1","שינוי ממתין")}${stat("1","חריגה לטיפול")}</div>
      <div class="section-gap">${H.note("אגף מערב אינה זמינה. הפעילות בשאר התחנות נמשכת; השינויים הממתינים לה יוצגו בסנכרון.","warn")}</div>
      <div class="columns section-gap"><div class="stack">${H.card("חיבור התחנות",H.table(["תחנה","קשר","זמן תגובה","בדיקה אחרונה"],[
      ["כניסה ראשית",H.badge("מחוברת"),'<bdi>42 ms</bdi>',"09:42"],
      ["כניסת עובדים",H.badge("מחוברת"),'<bdi>37 ms</bdi>',"09:42"],
      ["אגף מזרח",H.badge("מחוברת"),'<bdi>61 ms</bdi>',"09:42"],
      ["אגף מערב",H.badge("אין תקשורת","warn"),"—","אתמול, 18:10"]
      ]),H.btn("כל הדלתות","doors","small"))}${H.card("שירותים",line("Home Assistant","החיבור למערכת פעיל",H.badge("זמין"))+line("סנכרון הרשאות","שינויים ממתינים לתחנה אחת",H.btn("לסנכרון","sync","small"))+line("ניגון מצלמות","נבחר MSE · שירות go2rtc נבדק",H.badge("בדיקה הצליחה")))}</div><div class="stack">${H.card("נדרשת תשומת לב", `<h3>אגף מערב</h3><p class="guide-note section-gap">לא התקבל מענה מהתחנה. בדקו חיבור לרשת ומתח; אין צורך לשנות את הרשאות האנשים.</p><div class="actions section-gap">${H.btn("פרטי דלת","door-detail","soft")}${H.btn("אבחון","sync-detail")}</div>`)}${H.card("מידע לתמיכה", `<p class="guide-note">דוח אבחון כולל מצב רכיבים ופעולות. סודות ופרטי הזדהות אינם נכללים.</p><div class="actions section-gap">${H.btn("הורדת אבחון","","","download")}</div>`)}</div></div>`,

    audit: () => `${crumb("יומן ניהול")}${H.head("יומן ניהול", "שינויים שבוצעו במערכת — מי, מתי ומה השתנה.", H.btn("ייצוא יומן","","","download"))}
      <div class="card">${toolbar("חיפוש אדם, פעולה או הגדרה")}${H.table(["מועד","מבצע","פעולה","פריט","תוצאה"],[
        ['<bdi>17.09 · 09:38</bdi>',"מנהל המערכת","עדכון הרשאות",'<a class="mini-link" href="#person-details" data-go="person-details">נועה דגן</a>',H.badge("נשמר")],
        ['<bdi>17.09 · 09:31</bdi>',"רון שלו","שיוך כרטיס","אדם שחר",H.badge("נשמר")],
        ['<bdi>17.09 · 09:22</bdi>',"מנהל המערכת","החלת שינוי קבוצתי","קבוצת צוות הדרכה",H.badge("נשמר")],
        ['<bdi>17.09 · 09:10</bdi>',"מנהל המערכת","שמירת תוכנית פתיחה","כניסה ראשית",H.badge("נשמר")],
        ['<bdi>17.09 · 08:55</bdi>',"רון שלו","עדכון משתמש","מיה הדר",H.badge("קונפליקט גרסה","warn")],
        ['<bdi>16.09 · 17:42</bdi>',"מנהל המערכת","עדכון הגדרות מדיה","MSE",H.badge("נשמר")]
      ])}<div class="pagination"><span>6 פעולות מוצגות</span><div class="actions">${H.btn("הקודם","","small")}${H.btn("הבא","","small")}</div></div></div>
      <div class="section-gap">${H.note("יומן הניהול מתעד שינויי מערכת. כניסות בפועל ואירועי אינטרקום מופיעים במסך הפעילות.")}</div>`,

    sync: () => `${crumb("סנכרון")}${H.head("סנכרון הרשאות", "מצב כל אדם בכל תחנה, בלי לערבב מצב משתמש עם מצב חיבור.", H.btn("סנכרון הכול","","primary","refresh"))}
      <div class="summary-strip"><span>${H.badge("31 מסונכרנים")}</span><span>${H.badge("1 ממתין","warn")}</span><span>${H.badge("1 דורש טיפול","bad")}</span><span class="spacer"></span><span>6 אנשים · 8 תחנות · עודכן עכשיו</span></div>
      <div class="card">${toolbar("חיפוש אדם או תחנה")}${H.table(["אדם",...DEMO.doors],[
      [H.person("נועה לוי","נל","הנהלה"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok")],
      [H.person("איתי רז","אר","אחזקה"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("none"),sc("none")],
      [H.person("מיה הדר","מה","צוות הדרכה"),sc("ok"),sc("ok"),sc("ok"),sc("none"),sc("none"),sc("none"),sc("none"),sc("wait")],
      [H.person("אדם שחר","אש","ספקים"),sc("ok"),sc("none"),sc("none"),sc("none"),sc("none"),sc("none"),sc("none"),sc("none")],
      [H.person("יעל ברק","יב","הנהלה"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok"),sc("ok")],
      [H.person("רון שלו","רש","אחזקה"),sc("ok"),sc("ok"),sc("fail"),sc("ok"),sc("ok"),sc("ok"),sc("none"),sc("none")]
      ],"matrix")}<div class="status-legend"><span>${H.badge("✓ מסונכרן")}</span><span>${H.badge("◷ ממתין לתחנה","warn")}</span><span>${H.badge("! נדרש טיפול","bad")}</span><span>— אין שיוך</span><span class="spacer"></span><span>לחצו על תא לפירוט</span></div></div>
      <div class="section-gap">${H.note("אגף מערב מנותק. אישורי הסנכרון הקודמים נשמרים; השינוי החדש של מיה ממתין לחיבור. חריגה אצל רון אינה מעכבת אנשים אחרים.")}</div>`,
    "sync-detail": () => `${H.crumb(["ניהול","סנכרון","רון שלו"])}${H.head("נדרש טיפול בפריט אחד", "רון שלו · כניסת עובדים", H.btn("חזרה לסנכרון","sync","","arrow"))}
      <div class="columns"><div class="stack">${H.card("מה קרה?", `<div class="actions">${H.badge("העדכון לא הושלם","bad")}${H.badge("התחנה מחוברת")}</div><h3 class="section-gap">פרטי המשתמש בתחנה השתנו</h3><p class="guide-note section-gap">נמצא הבדל בין הנתונים המרכזיים לרשומה בתחנה. בדקו את ההשוואה לפני שמחליטים איזה מידע לשמור.</p><div class="actions section-gap">${H.btn("בדיקת ההבדל","recovery","primary")}${H.btn("רענון מצב","","","refresh")}</div>`)}
      ${H.card("התקדמות הפעולה",line("1. בדיקת קשר","התחנה זמינה",H.badge("הושלם"))+line("2. קריאת הרשומה","נתוני התחנה התקבלו",H.badge("הושלם"))+line("3. עדכון המשתמש","נמצא הבדל שמצריך סקירה",H.badge("נעצר","warn"))+line("4. אימות הסנכרון","טרם בוצע",H.badge("ממתין","")))}
      <details class="card pad"><summary>פרטים טכניים לאבחון</summary><div class="section-gap">${detail([["שלב","עדכון משתמש"],["סיבה","הבדל בנתונים"],["התקבל אישור כתיבה?","לא"],["זמן בדיקה","17.09.2026 · 09:42"]])}</div></details></div>
      <div class="stack">${H.card("הקשר",detail([["אדם",'<a class="mini-link" href="#person-details" data-go="person-details">רון שלו</a>'],["דלת",'<a class="mini-link" href="#door-detail" data-go="door-detail">כניסת עובדים</a>'],["הרשאה רצויה","מותר · מקבוצת אחזקה"],["שאר התחנות","מסונכרנות או ממתינות לקשר"]]))}${H.note("הטיפול כאן מתייחס לאדם ולתחנה האלה בלבד. לא מתבצעת שליחה נוספת לפני בחירת פעולה.")}</div></div>`,

    recovery: () => `${H.crumb(["ניהול","סנכרון","יישוב הבדל"])}${H.head("יישוב הבדל מול התחנה", "רון שלו · כניסת עובדים", H.btn("חזרה","sync-detail"))}
      <div class="card"><div class="card-head"><div><h2>השוואת נתונים</h2><p>בחרו פעולה אחרי בדיקת ההבדל.</p></div>${H.badge("טרם הוחל שינוי","warn")}</div>${H.table(["פרט","ב־WisKey","בתחנה"],[
      ["שם","רון שלו","רון"],["מספר עובד",'<bdi>1006</bdi>','<bdi>1006</bdi>'],["מצב","פעיל","פעיל"],["הרשאה לכניסה","מורשה","מורשה"],["PIN","מוגדר · מוסתר","לא מוצג"],["כרטיסים","ללא כרטיס","ללא כרטיס"]
      ])}</div><div class="columns equal section-gap"><div class="choice-card selected"><span class="radio"></span><div><h3>החלת הנתונים המרכזיים</h3><p>עדכון הרשומה בתחנה לפי המידע שנשמר ב־WisKey. לפני ההחלה תוצג סקירת השינוי.</p></div></div><div class="choice-card"><span class="radio"></span><div><h3>השארה לבדיקה</h3><p>לא לשנות עכשיו. הפריט יישאר ברשימת הדברים שדורשים טיפול.</p></div></div></div><div class="section-gap">${H.note("הבחירה אינה משנה הרשאות בתחנות אחרות. אין מחיקה ויצירה מחדש של אדם כדרך אוטומטית לפתור הבדל.","warn")}</div><div class="card section-gap">${H.footer("סקירת הפעולה","sync-detail","ביטול")}</div>`,

    reports: () => `${H.crumb(["פעילות","דוחות"])}${H.head("דוחות פעילות", "סינון, סקירה וייצוא של אירועי הגישה הקיימים.", H.btn("ייצוא CSV","","primary","download"))}
      <div class="card pad"><div class="field-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">${H.field("מתאריך","2026-09-10",{type:"date"})}${H.field("עד תאריך","2026-09-17",{type:"date"})}${H.select("דלת",["כל הדלתות","כניסה ראשית","כניסת עובדים"])}${H.select("תוצאה",["כל התוצאות","גישה אושרה","גישה נדחתה"])}${H.field("אדם","כל האנשים")}${H.select("אמצעי כניסה",["כל האמצעים","PIN","כרטיס","פתיחה מרחוק"])}</div><div class="actions section-gap">${H.btn("הצגת תוצאות","","soft","search")}${H.btn("ניקוי מסננים","","quiet")}</div></div>
      <div class="summary-strip section-gap"><span><strong>126</strong>אירועים בתוצאות</span><span><strong>6</strong>אנשים מזוהים</span><span class="spacer"></span><span>שעון הדוח: <bdi>Asia/Jerusalem</bdi></span></div>
      <div class="card">${H.table(["מועד","אדם","דלת","אמצעי","תוצאה"],[
      ['<bdi>17.09 · 09:35</bdi>',H.person("נועה דגן","נל"),"כניסה ראשית","PIN",H.badge("אושרה")],
      ['<bdi>17.09 · 09:31</bdi>',H.person("מיה הדר","מה"),"אגף מזרח","כרטיס",H.badge("אושרה")],
      ['<bdi>17.09 · 09:24</bdi>',"ללא זיהוי","כניסת עובדים","כרטיס",H.badge("נדחתה","warn")],
      ['<bdi>17.09 · 09:12</bdi>',H.person("אדם שחר","אש"),"אולם מרכזי","PIN",H.badge("אושרה")]
      ])}<div class="pagination"><span>4 מתוך 126 אירועים</span><div class="actions">${H.btn("הדפסה","","small")}${H.btn("הבא","","small")}</div></div></div><p class="guide-note section-gap">דוחות מתארים אירועי גישה. הם אינם דוח נוכחות או שעות עבודה.</p>`,

    restricted: () => `${H.head("סקירה", "ברוך הבא, נועה · המידע המותר לך מרוכז כאן.", H.badge("צפייה בלבד","blue"))}
      ${H.note("ניתנה לך הרשאת צפייה. פתיחת דלת ושינוי נתונים זמינים למשתמשים עם הרשאת ניהול מתאימה.")}
      <div class="summary-strip section-gap"><span><strong>7 / 8</strong>תחנות מחוברות</span><span><strong>0</strong>שיחות ממתינות</span><span class="spacer"></span><span><bdi>09:42</bdi> · 17.09.2026</span></div>
      <div class="columns"><div class="door-grid">${["כניסה ראשית","כניסת עובדים","אגף מזרח","אולם מרכזי","מחסן","אגף מערב"].map((name,i)=>`<article class="card door-tile"><div class="tile-head"><span class="door-glyph">${H.icon("door")}</span>${H.badge(i===5?'מנותקת':'מחוברת',i===5?'warn':'good')}</div><h3>${name}</h3><p class="sub">תחנת בקרת כניסה</p><div class="tile-foot">${H.btn("פרטי דלת","door-detail","small")}</div></article>`).join("")}</div>
      ${H.card("פעילות אחרונה",line("נועה דגן","גישה אושרה · כניסה ראשית",'<time class="sub">09:35</time>')+line("מיה הדר","גישה אושרה · אגף מזרח",'<time class="sub">09:31</time>')+line("כרטיס לא מזוהה","גישה נדחתה · כניסת עובדים",'<time class="sub">09:24</time>'))}</div><p class="guide-note section-gap">בהתקנה האמיתית הניווט והנתונים יוצגו רק לפי האזורים שהוקצו. זו המחשת מצב צפייה.</p>`,

    states: () => `${H.head("מצבי מערכת", "המשתמש תמיד יודע מה המצב ומה אפשר לעשות עכשיו.")}
      <div class="columns equal"><div class="stack">${H.card("אין אנשים עדיין",`<div class="empty"><span class="settings-icon">${H.icon("users")}</span><h2>נכיר את האנשים שלכם</h2><p>הוסיפו אדם חדש או עברו על המשתמשים שכבר קיימים בתחנות.</p><div class="actions" style="justify-content:center">${H.btn("הוספת אדם","person-edit","primary","plus")}${H.btn("ייבוא מהתחנות","imports")}</div></div>`)}
      ${H.card("אין תוצאות",`<div class="empty"><span class="settings-icon">${H.icon("search")}</span><h2>לא נמצאו אנשים מתאימים</h2><p>נסו שם אחר או הסירו חלק מהמסננים.</p>${H.btn("ניקוי מסננים","people","soft")}</div>`)}
      ${H.card("טעינה ראשונה",`<div class="stack" aria-label="טוען נתונים"><div class="bar" style="height:15px;width:65%"></div><div class="bar" style="height:15px;width:85%"></div><div class="bar" style="height:15px;width:72%"></div><p class="guide-note">טוען נתונים…</p></div>`)}</div>
      <div class="stack">${H.card("החיבור למערכת אבד",`${H.note("מוצגים הנתונים האחרונים שהתקבלו. פעולות שינוי אינן זמינות עד לחיבור מחדש.","warn")}<div class="actions section-gap">${H.btn("בדיקת חיבור","","soft","refresh")}<span class="sub">עודכן לאחרונה: 09:40</span></div>`)}
      ${H.card("אין הרשאה",`<div class="empty"><span class="settings-icon">${H.icon("shield")}</span><h2>אין לך גישה לאזור הזה</h2><p>מנהל המערכת יכול להגדיר אילו מסכים ופעולות יהיו זמינים עבורך.</p>${H.btn("חזרה לאזור מורשה","restricted","soft")}</div>`)}
      ${H.card("תוצאת פעולה לא ידועה",`${H.note("לא התקבל אישור סיום. לפני ניסיון נוסף יש לבדוק את מצב הפריט.","warn")}<div class="actions section-gap">${H.btn("בדיקת מצב","sync-detail","soft")}${H.btn("פרטי הפעולה","audit","quiet")}</div>`)}
      ${H.card("מישהו עדכן את הרשומה",`<p class="guide-note">המידע השתנה מאז פתיחת העורך. השינויים שלך נשמרו בטיוטה המקומית; יש לרענן ולסקור לפני שמירה חוזרת.</p><div class="actions section-gap">${H.btn("רענון וסקירה","person-edit","soft")}</div>`)}</div></div>`
  });

  function sc(state) {
    const map = {ok:["✓","","מסונכרן"],wait:["◷","warn","ממתין לתחנה"],fail:["!","bad","נדרש טיפול"],none:["—","blank","אין שיוך"]};
    const [symbol,cls,label] = map[state];
    return state === "none" ? `<span class="cell blank" aria-label="${label}">${symbol}</span>` : `<button class="cell ${cls}" data-go="sync-detail" aria-label="${label}" title="${label}">${symbol}</button>`;
  }
})();
