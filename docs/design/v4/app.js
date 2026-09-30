/* WisKey V4 approval prototype. Synthetic data. No device/HA/WhatsApp calls. */
const SCREENS = [
  ["overview", "מרכז הכניסה", "תפעול"],
  ["overview-12", "תצוגת 12 תחנות", "תפעול"],
  ["people", "אנשים", "אנשים"],
  ["person", "כרטיס אדם", "אנשים"],
  ["person-edit", "עריכת פרטים", "אנשים"],
  ["person-access", "הרשאות לדלתות", "אנשים"],
  ["person-timing", "ימים ושעות", "אנשים"],
  ["person-dates", "תאריכים מסוימים", "אנשים"],
  ["credentials", "קוד וכרטיסים", "אנשים"],
  ["pin", "יצירת קוד ייחודי", "אנשים"],
  ["card", "קריאת כרטיס מתחנה", "אנשים"],
  ["photo", "צילום משתמש", "אנשים"],
  ["groups", "קבוצות הרשאה", "אנשים"],
  ["group-edit", "עריכת קבוצה והשפעה", "אנשים"],
  ["whatsapp", "הכנת הודעת גישה", "תקשורת"],
  ["chat", "שיחת WhatsApp", "תקשורת"],
  ["doors", "דלתות ותחנות", "תחנות"],
  ["station", "פרטי תחנה", "תחנות"],
  ["programs", "תוכניות פתיחה", "תחנות"],
  ["program-edit", "עריכת תוכנית פתיחה", "תחנות"],
  ["codes", "קודים ציבוריים", "תחנות"],
  ["technical", "הגדרות תחנה", "תחנות"],
  ["call", "מצלמה והודעה קולית", "תקשורת"],
  ["call-active", "שיחה נכנסת", "תקשורת"],
  ["activity", "יומן אירועים", "פעילות"],
  ["event", "פרטי אירוע", "פעילות"],
  ["reports", "דוח פעילות", "פעילות"],
  ["sync", "מצב סנכרון", "תפעול"],
  ["sync-detail", "טיפול בכשל סנכרון", "תפעול"],
  ["operations", "פעולות ברקע", "תפעול"],
  ["imports", "ייבוא ובדיקת נתונים", "אנשים"],
  ["lifecycle", "תוקף ואיכות נתונים", "אנשים"],
  ["management", "מרכז הניהול", "ניהול"],
  ["fields", "שדות ותבניות אדם", "ניהול"],
  ["templates", "תבניות WhatsApp", "ניהול"],
  ["media", "וידאו ושמע", "ניהול"],
  ["clocks", "שעונים ו־NTP", "ניהול"],
  ["permissions", "הרשאות משתמשי HA", "ניהול"],
  ["health", "תקינות ואבחון", "ניהול"],
  ["audit", "יומן ניהולי", "ניהול"],
  ["schedules", "ספריית לוחות", "ניהול"],
  ["deployment", "פריסה לתחנה", "ניהול"],
  ["recovery", "בדיקת הבדלים", "ניהול"],
  ["appearance", "עיצוב לכל המשתמשים", "ניהול"],
  ["states", "ריק, מוגבל ושגיאה", "ניהול"],
];
const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  people:
    "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 3a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  door: "M5 21V3l12-1v19 M3 21h18 M13 11v2 M17 5h4v16",
  activity: "M3 4h18v16H3z M7 8h10 M7 12h7 M7 16h5",
  settings: "M4 7h16 M4 17h16 M9 4v6 M15 14v6",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  plus: "M12 5v14 M5 12h14",
  arrow: "M9 5l7 7-7 7",
  down: "M6 9l6 6 6-6",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  refresh:
    "M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-1l2 3 M4 15l2 3a7 7 0 0 0 12-1",
  check: "M5 12l4 4L19 6",
  clock: "M12 8v5l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  calendar: "M3 5h18v16H3z M7 3v4 M17 3v4 M3 10h18",
  key: "M8 13a5 5 0 1 1 3-8 5 5 0 0 1-3 8z M11 10l10 10 M16 15l3-3 M18 17l3-3",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3",
  unlock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8-1 M12 14v3",
  camera: "M3 5h12v14H3z M15 9l6-3v12l-6-3",
  phone: "M5 3l4 1 1 5-3 2a13 13 0 0 0 6 6l2-3 5 1 1 4c-1 5-10 1-14-3S1 4 5 3z",
  hangup: "M3 16v-5q9-8 18 0v5l-5 1-1-5H9l-1 5z",
  mic: "M9 3h6v10a3 3 0 0 1-6 0z M5 10v3a7 7 0 0 0 14 0v-3 M12 20v2",
  volume: "M3 9h4l5-4v14l-5-4H3z M16 8a6 6 0 0 1 0 8 M19 5a10 10 0 0 1 0 14",
  mute: "M3 9h4l5-4v14l-5-4H3z M17 9l5 6 M22 9l-5 6",
  expand: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M16 21h5v-5",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4",
  moon: "M20 15a9 9 0 0 1-11-11 9 9 0 1 0 11 11",
  sun: "M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M19 5l-2 2 M7 17l-2 2 M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  edit: "M15 5l4 4 M4 20l4-1L21 6l-4-4L4 15z",
  trash: "M3 6h18 M5 6l1 15h12l1-15 M9 3h6 M10 10v7 M14 10v7",
  download: "M12 3v12 M7 10l5 5 5-5 M3 17v4h18v-4",
  upload: "M12 16V4 M7 9l5-5 5 5 M3 17v4h18v-4",
  filter: "M3 4h18l-7 8v7l-4 2v-9z",
  card: "M3 5h18v14H3z M3 9h18 M7 15h3",
  info: "M12 11v6 M12 7h.01 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  shield: "M12 2l9 4v6c0 5-9 10-9 10S3 17 3 12V6z M8 12l3 3 5-6",
  chat: "M4 4h16v13H8l-4 4z M8 8h8 M8 12h5",
  send: "M22 2L9 15 M22 2l-8 20-5-7-7-5z",
  close: "M6 6l12 12 M6 18L18 6",
  warning: "M12 3l10 18H2z M12 9v5 M12 17v.01",
  building: "M4 21V3h16v18 M8 7h2 M14 7h2 M8 11h2 M14 11h2 M10 21v-6h4v6",
  chart: "M4 20V4 M4 20h17 M9 16v-4 M14 16V8 M19 16V5",
  copy: "M8 8h13v13H8z M16 8V3H3v13h5",
  wifi: "M2 8a16 16 0 0 1 20 0 M5 12a11 11 0 0 1 14 0 M8 16a6 6 0 0 1 8 0 M12 20h.01",
  stop: "M6 6h12v12H6z",
};
function icon(n) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n] || paths.grid}"/></svg>`;
}
function badge(t, kind = "") {
  return `<span class="badge ${kind}">${kind === "good" ? '<i class="dot"></i>' : ""}${t}</span>`;
}
function btn(t, i = "", kind = "", dest = "", attrs = "") {
  return dest
    ? `<a class="btn ${kind}" href="#${dest}" ${attrs}>${i ? icon(i) : ""}${t}</a>`
    : `<button class="btn ${kind}" ${attrs || "data-demo"}>${i ? icon(i) : ""}${t}</button>`;
}
function avatar(n = "נועה לביא", photo = false, cl = "") {
  return `<span class="avatar ${cl}">${
    photo
      ? '<img src="assets/person-demo.png" alt="דיוקן סינתטי של אדם לדוגמה">'
      : n
          .split(" ")
          .map((x) => x[0])
          .slice(0, 2)
          .join("")
  }</span>`;
}
function head(title, desc = "", actions = "", crumb = "") {
  return `<header class="page-head"><div>${crumb ? `<div class="crumb">${crumb}</div>` : ""}<h1>${title}</h1>${desc ? `<p>${desc}</p>` : ""}</div><div class="inline">${actions}</div></header>`;
}
function panel(title, body, action = "", cls = "") {
  return `<section class="panel ${cls}">${title ? `<div class="panel-head"><h2>${title}</h2>${action}</div>` : ""}${body}</section>`;
}
function notice(text, kind = "info") {
  return `<div class="notice ${kind}">${icon(kind === "warning" ? "warning" : kind === "good" ? "check" : "info")}<div class="grow">${text}</div></div>`;
}
function field(label, val = "", type = "text", extra = "") {
  return `<label class="field ${extra}"><span>${label}</span><input type="${type}" value="${val}" ${type === "tel" ? 'dir="ltr"' : ""}></label>`;
}
function select(label, options, extra = "") {
  return `<label class="field ${extra}"><span>${label}</span><select>${options.map((x) => `<option>${x}</option>`).join("")}</select></label>`;
}
function tabs(list, active) {
  return `<div class="tabs">${list.map(([id, t]) => `<a href="#${id}" class="${id === active ? "active" : ""}">${t}</a>`).join("")}</div>`;
}
function table(headers, rows, cls = "") {
  return `<div class="table-wrap"><table class="${cls}"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
function search(text = "חיפוש לפי שם…") {
  return `<label class="search">${icon("search")}<input aria-label="${text}" placeholder="${text}" data-search></label>`;
}
function pills(items, active = 0) {
  return `<div class="pills">${items.map((t, i) => `<button class="${i === active ? "active" : ""}" data-pill>${t}</button>`).join("")}</div>`;
}
const doors = [
  "כניסה ראשית",
  "לובי מזרח",
  "כניסת עובדים",
  "אולם אירועים",
  "חדר כושר",
  "סטודיו",
  "כניסה לחצר",
  "משרדים",
  "שער שירות",
  "אולם ספורט",
  "מחסן מרכזי",
  "אגף מערב",
];
const names = [
  "נועה לביא",
  "איתי רז",
  "מיה הדר",
  "אדם שחר",
  "יעל ברק",
  "רון שלו",
  "תמר גולן",
  "יואב אלון",
  "מאיה שקד",
  "אורן לביא",
  "דנה נבו",
  "רועי סלע",
];
const personTabs = [
  ["person", "סקירה"],
  ["person-edit", "פרטים"],
  ["person-access", "דלתות מורשות"],
  ["person-timing", "ימים ושעות"],
  ["credentials", "קוד וכרטיסים"],
];
const stationTabs = [
  ["station", "סקירה"],
  ["programs", "תוכניות פתיחה"],
  ["codes", "קודים ציבוריים"],
  ["technical", "הגדרות"],
];
let screen = "overview";
let theme = new URLSearchParams(location.search).get("theme") || "light";
function shell(content) {
  const group = SCREENS.find((x) => x[0] === screen)?.[2];
  let nav =
    group === "אנשים" || (group === "תקשורת" && !screen.startsWith("call"))
      ? "people"
      : group === "תחנות"
        ? "doors"
        : group === "פעילות"
          ? "activity"
          : group === "ניהול"
            ? "management"
            : "overview";
  const links = [
    ["overview", "מרכז הכניסה", "grid"],
    ["people", "אנשים", "people"],
    ["doors", "דלתות", "door"],
    ["activity", "פעילות", "activity"],
    ["management", "ניהול", "settings"],
  ];
  document.documentElement.dataset.theme = theme;
  document.body.className = screen.startsWith("call") ? "call-page" : "";
  document.body.dataset.screen = screen;
  return `<header class="topbar"><a class="brand" href="#overview"><span>WisKey</span><svg class="brandmark" viewBox="0 0 32 34" fill="none"><path d="M3 29V5l12-3v25l14-3V5" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 16h3M23 16h4" stroke="currentColor" stroke-width="3"/></svg></a><nav aria-label="ניווט ראשי">${links.map(([id, t, i]) => `<a class="navitem ${nav === id ? "active" : ""}" href="#${id}">${icon(i)}${t}</a>`).join("")}</nav><div class="topend"><span class="org"><b>מרכז קהילתי · הדגמה</b><small>ניהול בקרת כניסה</small></span>${btn("", "moon", "ghost icon-only", "", 'data-theme-toggle aria-label="החלפת מצב בהיר וכהה"')}${btn("", "refresh", "ghost icon-only", "operations", 'aria-label="פעולות ברקע"')}${avatar("מנהל מערכת", false, "blue")}</div></header><main class="workspace">${content}<footer class="page-footer"><span>WisKey · הצעת עיצוב 04 · נתוני הדגמה</span><a href="gallery.html">גלריית המסכים ↗</a></footer></main><nav class="mobile-nav" aria-label="ניווט לנייד">${links.map(([id, t, i]) => `<a href="#${id}" class="${nav === id ? "active" : ""}">${icon(i)}${id === "overview" ? "כניסה" : t}</a>`).join("")}</nav>`;
}
function pager(count = "12", total = "148") {
  return `<div class="panel-foot"><span><b>${count}</b> מתוך ${total} אנשים</span><div class="inline"><span>25 לעמוד</span>${btn("", "arrow", "small icon-only", "", 'data-demo aria-label="עמוד קודם"')}<b>1</b>${btn("2", "", "ghost small")}${btn("3", "", "ghost small")}</div></div>`;
}
function feeds(count = 5) {
  return names
    .slice(0, count)
    .map(
      (n, i) =>
        `<a class="feedrow" href="#event">${i === 2 ? `<div class="feed-icon bad">${icon("close")}</div>` : avatar(n, i === 0, ["", "blue", "sand", "rose"][i % 4])}<div class="grow"><p>${n}</p><small>${doors[i]} · ${i === 2 ? "כניסה נדחתה" : i === 0 ? "קוד אישי" : "כרטיס"}</small></div><time>${["14:32", "14:28", "14:24", "14:19", "14:12", "14:08"][i]}</time></a>`,
    )
    .join("");
}
function doorTile(n, i) {
  const off = i === 7,
    ring = i === 0 && screen === "overview";
  return `<article class="door-tile ${off ? "offline" : ""} ${ring ? "ring-tile" : ""}"><div class="door-image"><img src="assets/entrance.png" alt="תמונת כניסה סינתטית" style="filter:${off ? "grayscale(1)" : `brightness(${1 - (i % 4) * 0.06})`}">${ring ? '<span class="ringing">שיחה נכנסת</span>' : ""}<a href="#call" class="cam">${icon("camera")}<span>מצלמה</span></a></div><div class="door-info"><div class="inline spread"><h3><a href="#station">${n}</a></h3>${badge(off ? "מנותק" : "מחובר", off ? "" : "good")}</div><span class="sub">${off ? "קשר אחרון לפני 6 דקות" : "ממסר 1 · " + (i === 1 ? "תוכנית פתיחה ב־HA" : "גישה לפי הרשאות")}</span></div><div class="door-action">${btn(ring ? "מענה לשיחה" : "פתח דלת", ring ? "phone" : "unlock", ring ? "primary grow" : "soft grow", ring ? "call-active" : "", off ? "disabled" : ring ? "" : "data-unlock")}${btn("", "more", "icon-only", "station", 'aria-label="פרטי התחנה"')}</div></article>`;
}
function overview(twelve = false) {
  const count = twelve ? 12 : 8;
  return (
    head(
      "מרכז הכניסה",
      "דלתות, אנשים ופעולות שדורשות תשומת לב",
      btn("תצוגת מצלמות", "camera", "", twelve ? "overview" : "overview-12") +
        btn("הוסף אדם", "plus", "primary", "person-edit"),
    ) +
    `<div class="stats"><div class="stat"><strong dir="ltr">${count - 1} <span>/ ${count}</span></strong><span>תחנות מחוברות</span></div><div class="stat"><strong>148</strong><span>אנשים</span></div><div class="stat"><strong>${twelve ? "0" : "1"}</strong><span>שיחות נכנסות</span></div><a href="#sync" class="stat"><strong>2</strong><span>לסנכרון</span></a><div class="clock"><bdi>24.09.2026</bdi> · <bdi data-live-clock>14:32:08</bdi> · ירושלים</div></div><div class="${twelve ? "" : "overview-layout"}"><section><div class="toolbar">${search("חיפוש דלת או תחנה…")}${pills(["כל הדלתות", "מחוברות", "דורשות טיפול"])}<span class="grow"></span>${btn(twelve ? "12 תחנות" : "8 תחנות", "grid", "small", twelve ? "overview" : "overview-12")}</div><div class="door-grid">${doors.slice(0, count).map(doorTile).join("")}</div><div class="footer-note"><span>תמונות מקדימות · פתיחת מצלמה מתחילה וידאו</span><span>עמוד 1 מתוך 1</span></div></section>${twelve ? "" : `<aside class="overview-side stack">${panel("פעילות אחרונה", `<div class="pad" style="padding-top:3px;padding-bottom:3px">${feeds()}</div>`, btn("הכול", "arrow", "ghost small", "activity"))}${panel("לטיפול שלך", `<div class="pad"><a href="#sync-detail" class="inline"><div class="feed-icon">${icon("refresh")}</div><div><h3>2 הרשאות ממתינות</h3><small>פעולת הסנכרון ממשיכה</small></div></a><a href="#lifecycle" class="mini-task">${icon("calendar")}<span>3 הרשאות מסתיימות השבוע</span>${icon("arrow")}</a></div>`)}</aside>`}</div>`
  );
}
function people() {
  return (
    head(
      "אנשים",
      "ניהול הרשאות ואמצעי כניסה",
      btn("פעולות", "down", "", "imports") +
        btn("הוסף אדם", "plus", "primary", "person-edit"),
    ) +
    `<div class="toolbar">${search("שם, טלפון או מזהה עובד…")}${pills(["כל האנשים 148", "פעילים 142", "מוגבלים בזמן 12"])}<span class="grow"></span>${btn("קבוצות", "people", "", "groups")}${btn("מסננים", "filter", "", "", "data-filter")}${btn("תצוגות", "down", "", "", "data-demo")}</div><div class="filter-summary hidden" id="filters">${select("מחלקה", ["כל המחלקות", "הנהלה", "אחזקה"])}${select("קבוצה", ["כל הקבוצות", "צוות ניהול", "ספקים"])}${btn("אפס מסננים", "", "ghost", "", "data-filter")}</div><section class="panel"><div class="table-wrap people-table"><table><thead><tr><th class="select"><input type="checkbox" aria-label="בחירת כל האנשים"></th>${["שם", "טלפון נייד", "מחלקה / תפקיד", "קבוצות", "גישה", "אמצעי כניסה", "מצב", ""].map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${names
      .slice(0, 10)
      .map(
        (n, i) =>
          `<tr data-person-row data-name="${n} 05000000${String(i + 1).padStart(2, "0")}"><td class="select"><input type="checkbox" aria-label="בחירת ${n}"></td><td><a href="#person" class="inline">${avatar(n, i === 0, ["", "blue", "sand", "rose"][i % 4])}<span><span class="name">${n}</span><span class="sub">מזהה עובד ${1001 + i}</span></span></a></td><td class="phone"><bdi>050-000-${String(i + 1).padStart(4, "0")}</bdi></td><td>${["הנהלה", "אחזקה", "הדרכה", "ספקים"][i % 4]}<span class="sub">${["מנהלת", "ראש צוות", "מדריכה", "טכנאי"][i % 4]}</span></td><td><span class="chip">${["צוות ניהול", "אחזקה", "הדרכה", "ספקים"][i % 4]}</span></td><td><strong>${[8, 6, 4, 1][i % 4]} דלתות</strong><span class="sub">${i % 3 ? "ימים ושעות" : "ללא הגבלת שעות"}</span></td><td>${icon(i % 2 ? "card" : "key")} <span class="table-pin">${i % 2 ? "כרטיס" : "קוד + כרטיס"}</span></td><td>${i === 5 ? badge("ממתין לסנכרון", "warn") : i === 8 ? badge("מושבת", "") : badge("פעיל", "good")}</td><td><div class="row-actions">${btn("עריכה", "edit", "ghost small", "person-edit")}${btn("", "refresh", "ghost icon-only", "", 'data-demo aria-label="סנכרון אדם"')}</div></td></tr>`,
      )
      .join("")}</tbody></table></div><div class="mobile-list">${names
      .slice(0, 8)
      .map(
        (n, i) =>
          `<a class="person-card" data-person-row data-name="${n}" href="#person">${avatar(n, i === 0, "mid")}<div class="grow"><div class="name">${n}</div><div class="sub">${["הנהלה · מנהלת", "אחזקה · ראש צוות", "הדרכה · מדריכה"][i % 3]}</div><bdi class="phone">050-000-${String(i + 1).padStart(4, "0")}</bdi></div><div class="align-end">${badge(i === 5 ? "ממתין" : "פעיל", i === 5 ? "warn" : "good")}<div class="sub">${[8, 6, 4, 1][i % 4]} דלתות</div></div>${icon("arrow")}</a>`,
      )
      .join(
        "",
      )}</div><div class="empty hidden" id="no-results">${icon("search")}<h3>לא נמצאו אנשים</h3><p>נסה שם אחר או נקה את המסננים.</p></div>${pager("10")}</section>`
  );
}
function personHero() {
  return `<div class="crumb"><a href="#people">אנשים</a> ${icon("arrow")} נועה לביא</div><div class="person-hero">${avatar("נועה לביא", true, "large")}<div><div class="inline"><h1>נועה לביא</h1>${badge("פעילה", "good")}</div><div class="person-summary"><span>הנהלה · מנהלת קהילה</span><span>מזהה עובד <bdi>1001</bdi></span><bdi>050-000-0001</bdi></div></div><div class="hero-actions">${btn("שלח פרטי גישה", "chat", "soft", "whatsapp")}${btn("עריכת פרטים", "edit", "", "person-edit")}${btn("", "refresh", "icon-only", "", 'data-demo aria-label="סנכרון אדם"')}</div></div>`;
}
function grants() {
  return `<div class="grant-grid">${doors
    .slice(0, 8)
    .map(
      (d, i) =>
        `<div class="grant">${icon("door")}<div class="grow"><strong>${d}</strong><small>${i === 6 ? "הרשאה אישית" : "מקבוצת צוות ניהול"} · ממסר 1</small></div><span class="check">✓</span></div>`,
    )
    .join("")}</div>`;
}
function person() {
  return (
    personHero() +
    `<div class="person-main"><div class="stack">${panel(
      "פרטים ואמצעי כניסה",
      `<div class="pad profile-facts">${[
        ["מחלקה", "הנהלה"],
        ["תפקיד", "מנהלת קהילה"],
        ["קבוצה", "צוות ניהול"],
        ["קוד אישי", badge("מוגדר", "good")],
        ["כרטיסים", "כרטיס פעיל אחד"],
        ["תוקף", "ללא תאריך סיום"],
      ]
        .map(
          ([k, v]) =>
            `<div class="fact"><span>${k}</span><span>${v}</span></div>`,
        )
        .join(
          "",
        )}<div class="mt">${btn("ניהול קוד וכרטיסים", "key", "soft", "credentials")}</div></div>`,
    )}${panel("", `<div class="pad"><div class="inline mb">${icon("clock")}<h3>מתי מותר להיכנס?</h3></div><h2 style="font-size:16px">בכל יום, בכל שעה</h2><p class="sub mt" style="margin-top:5px">ללא הגבלת ימים ושעות</p><div class="mt">${btn("עריכת זמני כניסה", "edit", "ghost small", "person-timing")}</div></div>`)}</div><div class="stack">${panel("8 דלתות מורשות", `<div class="pad">${grants()}<div class="mt">${notice("ההרשאות התקבלו בתחנות. ממסר נוסף נבחר רק מתוך הרשאות האדם.", "good")}</div></div>`, btn("עריכת הרשאות", "edit", "ghost small", "person-access"))}${panel("פעילות אחרונה", `<div class="pad" style="padding-block:3px">${[0, 1].map((n) => `<a class="feedrow" href="#event">${avatar("נועה לביא", true)}<div class="grow"><p>נועה לביא</p><small>${doors[n]} · קוד אישי</small></div><time>${n ? "12:08" : "14:32"}</time></a>`).join("")}</div>`, btn("ליומן האדם", "arrow", "ghost small", "activity"))}</div></div>`
  );
}
function editor(content, active = "person-edit") {
  return (
    head(
      "עריכת נועה לביא",
      "שינוי נשמר רק לאחר לחיצה על שמירה",
      btn("חזרה לכרטיס", "arrow", "", "person"),
      "אנשים / נועה לביא",
    ) +
    `<section class="panel">${tabs(personTabs, active)}${content}<div class="editor-footer"><span class="sub">נתוני הדגמה · טרם נשמרו שינויים</span><div class="inline">${btn("ביטול", "", "", "person")}${btn("שמור וסנכרן", "check", "primary", "", "data-save")}</div></div></section>`
  );
}
function personEdit() {
  return editor(
    `<div class="two-col pad"><div class="stack"><div class="photo-inline">${avatar("נועה לביא", true, "large")}<div><h3>תמונת משתמש</h3><small>תמונה ביומן ובכרטיס האדם</small><div class="mt" style="margin-top:8px">${btn("החלפת תמונה", "camera", "small", "photo")}</div></div></div><div class="form-grid">${field("שם מלא", "נועה לביא")}${field("מזהה עובד", "1001")}${field("טלפון נייד", "050-000-0001", "tel")}${select("מצב המשתמש", ["פעילה", "מושבתת"])}${select("מחלקה", ["הנהלה", "אחזקה", "הדרכה"])}${field("תפקיד", "מנהלת קהילה")}</div></div><div class="stack"><div class="panel pad" style="background:var(--wash)"><h3>קבוצות הרשאה</h3><p class="sub mt" style="margin-top:5px">הקבוצות מעניקות גישה. חריגים אישיים נשמרים.</p><div class="inline mt"><span class="chip">✓ צוות ניהול</span>${btn("שיוך קבוצה", "plus", "small", "", "data-demo")}</div></div><div class="form-grid">${field("בתוקף מתאריך", "2026-01-01", "date")}${field("בתוקף עד", "", "date")}</div>${notice("לימים ושעות קבועים או לתאריכים מסוימים, עבור ללשונית ימים ושעות.")}<div class="inline wrap">${btn("השעיית משתמש", "stop", "ghost")}${btn("מחיקת משתמש", "trash", "danger")}${btn("יומן שינויים", "activity", "ghost small", "audit")}</div></div></div>`,
  );
}
function personAccess() {
  return editor(
    `<div class="pad">${notice("מקור ההרשאה מוצג לכל דלת. אפשר לקבל מהקבוצה, להוסיף גישה אישית או לחסום אישית.")}<div class="mt">${table(
      ["תחנה", "מקור ההרשאה", "הרשאה אישית", "ממסרים מותרים", "סנכרון"],
      doors
        .slice(0, 8)
        .map((d, i) => [
          `${icon("door")} <b>${d}</b>`,
          i === 6 ? "הוספה אישית" : "צוות ניהול",
          `<select aria-label="הרשאה ל${d}" style="padding:5px;border:1px solid var(--line);border-radius:5px;background:var(--surface)"><option>${i === 6 ? "אישור אישי" : "לפי הקבוצה"}</option><option>חסימה אישית</option><option>אישור אישי</option></select>`,
          `<label><input type="checkbox" checked> דלת 1</label> <label class="muted"><input type="checkbox"> דלת 2</label>`,
          badge("מסונכרן", "good"),
        ]),
    )}</div></div>`,
    "person-access",
  );
}
function weekGrid() {
  return `<div class="schedule-grid"><div></div>${["06:00", "09:00", "12:00", "15:00", "18:00", "21:00"].map((t) => `<div>${t}</div>`).join("")}${["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"].map((d, i) => `<div>${d}</div>${Array.from({ length: 6 }, (_, n) => `<div><span class="timebar ${[1, 3, 4].includes(i) && n >= 1 && n <= 3 ? "" : "blank"}"></span></div>`).join("")}`).join("")}</div>`;
}
function timing(dates = false) {
  return editor(
    `<div class="two-col pad"><div class="stack"><div><h3 class="mb">מתי מותר להיכנס?</h3><div class="pills"><a href="#person-always">תמיד</a><a href="#person-timing" class="${dates ? "" : "active"}">ימי שבוע</a><a href="#person-dates" class="${dates ? "active" : ""}">תאריכים מסוימים</a></div></div>${dates ? `<div class="form-grid">${field("מתאריך", "2026-10-01", "date")}${field("עד תאריך", "2026-10-02", "date")}</div>` : `<div><div class="section-label">ימים מורשים</div><div class="week">${["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((d, i) => `<button class="day ${[1, 3, 4].includes(i) ? "active" : ""}" data-day>${d}</button>`).join("")}</div></div>`}<label class="inline"><input type="checkbox" data-all-day> כל היום בימים שנבחרו</label><div class="form-grid" id="time-fields">${field("משעה", "09:00", "time")}${field("עד שעה", "17:00", "time")}</div>${select("מנגנון אכיפה", ["Home Assistant", "מקומי בתחנה — כפוף לתמיכה"])}${select("אזור זמן", ["Asia/Jerusalem"])}${notice("במסלול Home Assistant, שינוי ההרשאה בשעת המעבר תלוי בזמינות השרת והתחנה.", "warning")}</div><div class="stack"><div class="panel pad" style="background:var(--wash)"><h3 class="mb">תצוגה מקדימה</h3>${dates ? `<div class="inline gap24"><div class="feed-icon">${icon("calendar")}</div><div><h2>1–2 באוקטובר</h2><p class="sub">09:00–17:00 · ירושלים</p></div></div>` : weekGrid()}<div class="mt">${badge("טרם נשמר", "warn")}</div><p class="sub mt">${dates ? "שני התאריכים שנבחרו" : "שני, רביעי וחמישי"} · <bdi>09:00–17:00</bdi><br>חל על הדלתות המורשות בכרטיס האדם.</p></div>${notice("לאחר השמירה מוצג מצב הסנכרון בכל תחנה. ״נשמר״ לבדו אינו מעיד שההגבלה כבר נאכפת.")}<a class="link" href="#sync">צפייה במצב הסנכרון ←</a></div></div>`,
    "person-timing",
  );
}
function credentials() {
  return editor(
    `<div class="two-equal pad"><div class="panel pad"><div class="inline spread"><h3>${icon("key")} קוד אישי</h3>${badge("מוגדר", "good")}</div><div class="code-dots">••••••</div><p class="sub">הקוד מוסתר. ניתן להחליף או להסיר אותו.</p><div class="inline mt">${btn("שינוי קוד", "edit", "primary", "pin")}${btn("הסרת קוד", "trash", "ghost")}</div></div><div class="panel pad"><div class="inline spread"><h3>${icon("card")} כרטיסי כניסה</h3>${badge("כרטיס אחד")}</div><div class="relay mt">${icon("card")}<div class="grow"><b>כרטיס עובד</b><div class="sub"><bdi>•••• 1048</bdi> · פעיל</div></div>${btn("", "trash", "ghost icon-only", "", 'data-demo aria-label="הסרת כרטיס"')}</div>${btn("קרא כרטיס מהאינטרקום", "wifi", "primary", "card")}<div class="mt">${btn("הוספה מקורא USB", "plus", "ghost small", "card")}</div></div></div>`,
    "credentials",
  );
}
function pin() {
  return (
    head(
      "החלפת קוד אישי",
      "נועה לביא",
      btn("סגירה", "close", "ghost", "credentials"),
      "אנשים / אמצעי כניסה",
    ) +
    `<div class="drawer-demo">${panel("קוד ייחודי למשתמש", `<div class="pad stack">${notice("קוד שכבר משויך למשתמש אחר לא ניתן לשימוש, גם כאשר הסרתו מתחנה עדיין ממתינה.")}<div class="form-grid">${field("קוד חדש", "482951", "password")}${field("אימות הקוד", "482951", "password")}</div><div class="inline spread">${badge("הקוד זמין לשימוש", "good")}${btn("צור קוד ייחודי", "refresh", "", "", "data-generate-pin")}</div><p class="sub">הקוד המוצג בהדמיה בדוי. הייחודיות נקבעת בשרת בעת בדיקה ושמירה.</p></div><div class="editor-footer">${btn("ביטול", "", "", "credentials")}${btn("עדכן קוד וסנכרן", "check", "primary", "", "data-save")}</div>`)}</div>`
  );
}
function card() {
  return (
    head(
      "הוספת כרטיס",
      "שיוך כרטיס לנועה לביא",
      btn("חזרה", "arrow", "", "credentials"),
      "אנשים / אמצעי כניסה",
    ) +
    `<div class="drawer-demo">${panel("", `<div class="pad"><div class="steps"><span class="step active"><span class="bubble">1</span>בחירת תחנה</span><span class="step"><span class="bubble">2</span>הצמדת כרטיס</span><span class="step"><span class="bubble">3</span>אישור השיוך</span></div><div class="two-equal"><div class="stack">${select("תחנה לקריאת הכרטיס", ["כניסה ראשית · מחוברת", "לובי מזרח", "כניסת עובדים"])}${select("קורא", ["קורא 1"])}${btn("התחל קריאת כרטיס", "wifi", "primary", "", "data-capture")}</div><div class="panel pad" style="background:var(--wash);text-align:center"><div class="feed-icon" style="width:58px;height:58px;margin:15px auto">${icon("card")}</div><h3 id="capture-status">בחר תחנה והתחל קריאה</h3><p class="sub mt">לאחר מכן הצמד את הכרטיס לקורא.<br>השיוך יבוצע רק לאחר אישור.</p></div></div><div class="mt">${notice("יש קורא USB במחשב? אפשר להשתמש בו באותו מסלול אישור.")}</div></div><div class="editor-footer">${btn("ביטול", "", "", "credentials")}${btn("אישור שיוך הכרטיס", "check", "primary", "", "data-demo")}</div>`)}</div>`
  );
}
function photo() {
  return (
    head(
      "תמונת המשתמש",
      "נועה לביא",
      btn("חזרה", "arrow", "", "person-edit"),
      "אנשים / תמונה",
    ) +
    `<div class="drawer-demo">${panel("", `<div class="pad two-equal"><div class="capture"><img src="assets/person-demo.png" alt="תמונת הדגמה סינתטית"><div class="capture-frame"></div></div><div class="stack"><h2>התמונה מוכנה</h2><p class="muted">בדוק שהפנים ברורות וממוקמות במרכז.</p>${btn("השתמש בתמונה", "check", "primary", "", "data-save")}${btn("צילום מחדש", "camera", "", "", "data-demo")}<small>בהדמיה לא נפתחת מצלמה. במוצר נדרשת הרשאת מצלמה מפורשת.</small></div></div>`)}</div>`
  );
}
function groups(edit = false) {
  if (edit)
    return (
      head(
        "קבוצת צוות ניהול",
        "עדכון קבוצה עם תצוגת השפעה לפני החלה",
        btn("חזרה לקבוצות", "arrow", "", "groups"),
        "אנשים / קבוצות",
      ) +
      `<div class="two-equal">${panel(
        "הגדרת הקבוצה",
        `<div class="pad stack">${field("שם הקבוצה", "צוות ניהול")}<div class="inline spread"><h3>קבוצה פעילה</h3><span class="switch"></span></div><h3>תחנות מורשות</h3>${doors
          .slice(0, 8)
          .map(
            (d, i) =>
              `<label class="inline"><input type="checkbox" ${i < 7 ? "checked" : ""}>${d}</label>`,
          )
          .join("")}</div>`,
      )}${panel(
        "השפעת השינוי",
        `<div class="pad stack">${notice("לפני שמחילים, בדוק מי יקבל או יאבד הרשאה.", "warning")}<div class="inline gap24"><div class="small-stat"><strong>12</strong><small>אנשים יושפעו</small></div><div class="small-stat"><strong>1</strong><small>תחנה נוספה</small></div><div class="small-stat"><strong>0</strong><small>הרשאות הוסרו</small></div></div>${table(
          ["אדם", "שינוי"],
          names
            .slice(0, 4)
            .map((n) => [n, `גישה לכניסה לחצר ${badge("נוסף", "good")}`]),
        )}<p class="sub">חסימות והרשאות אישיות נשמרות. שינוי זה אינו משנה בחירת ממסר אישית.</p>${btn("אשר והחל על הקבוצה", "check", "primary", "", "data-save")}</div>`,
      )}</div>`
    );
  return (
    head(
      "קבוצות הרשאה",
      "שיוך אנשים והרשאות לפי צוות או תפקיד",
      btn("הוסף קבוצה", "plus", "primary", "group-edit"),
      "אנשים / קבוצות",
    ) +
    `<div class="toolbar">${search("חיפוש קבוצה…")}${btn("לכל האנשים", "people", "ghost", "people")}${btn("ספריית הרשאות", "shield", "ghost", "directory")}</div><div class="three-col">${["צוות ניהול", "אחזקה", "הדרכה", "ספקים", "מזכירות", "ניקיון"].map((n, i) => panel("", `<a class="menu-card" href="#group-edit"><div class="feed-icon">${icon("people")}</div><div class="grow"><h2>${n}</h2><p>${[12, 18, 32, 9, 8, 11][i]} אנשים · ${[8, 6, 4, 1, 4, 3][i]} תחנות מורשות</p><div class="mt">${badge("פעילה", "good")}</div></div>${icon("arrow")}</a>`)).join("")}</div>`
  );
}
function whatsapp(chat = false) {
  return (
    head(
      chat ? "שיחה עם נועה לביא" : "שליחת פרטי גישה",
      "WhatsApp · 050-000-0001",
      btn(
        chat ? "פרטי גישה" : "צפייה בשיחה",
        chat ? "send" : "chat",
        "",
        chat ? "whatsapp" : "chat",
      ) + btn("כרטיס אדם", "arrow", "", "person"),
      "אנשים / נועה לביא",
    ) +
    (chat
      ? panel(
          "",
          `<div class="chat-layout"><aside class="chat-side"><div class="inline mb">${avatar("נועה לביא", true, "mid")}<div><h3>נועה לביא</h3><small>מנהלת קהילה</small></div></div><div class="fact"><span>נייד</span><bdi>050-000-0001</bdi></div><div class="fact"><span>WhatsApp</span><bdi>+972500000001</bdi></div><div class="fact"><span>חשבון שולח</span><span>מזכירות</span></div><div class="mt">${btn("הכנת פרטי גישה", "key", "soft", "whatsapp")}</div><p class="sub mt">מדיה מוצגת כאשר היא זמינה דרך האינטגרציה.</p></aside><div class="chat-area"><span class="badge" style="align-self:center">היום · 24 בספטמבר</span><div class="message out">שלום נועה 👋<br>🔐 מרכז קהילתי — פרטי הגישה שלך מוכנים.<br>הכניסה מותרת לדלתות המשויכות לך.<time>14:05 · התקבל בשירות</time></div><div class="message">תודה! מאיזו כניסה להגיע?<time>14:07</time></div><div class="message out"><img src="assets/entrance.png" alt="תמונת כניסה לדוגמה"><br>הכניסה הראשית, ליד המבואה.<time>14:08</time></div><div class="message">מעולה, תודה רבה.<time>14:09</time></div><div class="notice" style="align-self:stretch;margin-top:auto">${icon("info")}הדמיית היסטוריה ומדיה · שליחת פרטי גישה נפתחת לתצוגה מקדימה.</div></div></div>`,
        )
      : `<div class="two-equal">${panel(
          "עריכת ההודעה",
          `<div class="pad stack"><div class="form-grid">${select("חשבון שולח", ["מזכירות · מחובר"])}${field("נמען ב־WhatsApp", "+972500000001", "tel")}</div><label class="field"><span>טקסט ההודעה</span><textarea id="message-text" style="min-height:285px">שלום נועה 👋

🏫 מרכז קהילתי
הרשאת הכניסה שלך ב־WisKey מוכנה 🔐

💳 אמצעי הכניסה שלך הוא כרטיס אישי.

🚪 דלתות מורשות:
כניסה ראשית, לובי מזרח וכניסת עובדים.

📆 שני, רביעי וחמישי
⌚ 09:00–17:00

🔒 אמצעי הכניסה אישי. אין להעבירו לאחרים.</textarea></label><p class="sub">אפשר לערוך את ההודעה לפני השליחה. קוד אישי נכלל רק אם קיים ונבחר בתצוגה המקדימה.</p></div>`,
        )}${panel("כך תיראה ההודעה", `<div class="chat-area" style="min-height:410px"><div class="message out" id="message-preview" style="max-width:100%;white-space:pre-line"></div><span class="sub">תצוגה מקדימה · ההודעה טרם נשלחה</span></div><div class="editor-footer">${btn("ביטול", "", "", "person")}${btn("אישור ושליחה", "send", "primary", "", "data-send")}</div>`)}</div>`)
  );
}
function doorsPage() {
  return (
    head(
      "דלתות ותחנות",
      "מצב חיבור, הרשאות ותוכניות לכל תחנה",
      btn("סנכרון שעונים", "clock", "", "clocks") +
        btn("סנכרן הכול", "refresh", "primary", "", "data-demo"),
    ) +
    `<div class="toolbar">${search("חיפוש לפי שם או כתובת…")}${pills(["כל התחנות 8", "מחוברות 7", "מנותקות 1"])}</div>${panel(
      "",
      table(
        ["תחנה", "חיבור", "ממסרים", "אנשים", "תוכנית פתיחה", "סנכרון", ""],
        doors
          .slice(0, 8)
          .map((d, i) => [
            `<a class="inline" href="#station"><div class="feed-icon">${icon("door")}</div><span><b>${d}</b><span class="sub">DS-KV6124-E1</span></span></a>`,
            badge(i === 7 ? "מנותקת" : "מחוברת", i === 7 ? "" : "good"),
            i === 1 ? "דלת 1 + שער" : "דלת 1",
            [86, 45, 62, 120, 74, 31, 22, 12][i],
            i < 2 ? badge("שעות קבלה · HA", "info") : "—",
            i === 5
              ? badge("דורש טיפול", "warn")
              : i === 7
                ? badge("ממתין לחיבור")
                : badge("מעודכן", "good"),
            btn("ניהול", "arrow", "ghost small", "station"),
          ]),
      ) +
        `<div class="panel-foot"><span>8 תחנות · יכולות נבדקות לכל תחנה בנפרד</span>${btn("ייצוא מלאי", "download", "ghost small")}</div>`,
    )}`
  );
}
function stationFrame(body, active = "station") {
  return (
    head(
      "כניסה ראשית",
      `DS-KV6124-E1 · ${active === "station" ? "תחנה וממסרים" : "ניהול התחנה"}`,
      btn("מצלמה ושיחה", "camera", "", "call") +
        btn("סנכרן תחנה", "refresh", "primary", "", "data-demo"),
      "דלתות / כניסה ראשית",
    ) + `<section class="panel">${tabs(stationTabs, active)}${body}</section>`
  );
}
function station() {
  return stationFrame(
    `<div class="two-equal pad"><div class="stack"><div class="panel"><div class="station-profile"><div class="station-glyph">${icon("camera")}</div><div class="grow"><div class="inline spread"><h2>פרטי התחנה</h2>${badge("מחוברת", "good")}</div><div class="fact"><span>דגם</span><bdi>DS-KV6124-E1</bdi></div><div class="fact"><span>קושחה</span><bdi>V3.9.0</bdi></div><div class="fact"><span>כתובת לדוגמה</span><bdi>192.0.2.151</bdi></div></div></div><div class="panel-foot"><span>קשר אחרון 14:32 · 41ms</span>${btn("בדיקת חיבור", "refresh", "ghost small")}</div></div><div class="inline gap24 pad"><div class="small-stat"><strong>86</strong><small>אנשים מורשים</small></div><div class="small-stat"><strong>0</strong><small>ממתינים</small></div><div class="small-stat"><strong>1</strong><small>ממסר מנוהל</small></div></div></div><div><h3 class="mb">ממסרים מנוהלים</h3><div class="relay"><div class="feed-icon">${icon("door")}</div><div class="grow"><h3>דלת ראשית</h3><small>ממסר 1 · API 1</small></div>${btn("פתח דלת", "unlock", "primary", "", "data-unlock")}</div><div class="relay"><div class="feed-icon">${icon("door")}</div><div class="grow"><h3>ממסר 2</h3><small>לא הוגדר לניהול</small></div>${btn("הגדרה", "settings", "ghost small", "technical")}</div>${notice("אישור פקודת פתיחה אינו קריאה של חיישן מצב הדלת.")}<div class="mt">${btn("הגדרות טכניות", "settings", "", "technical")}${btn("שעון התחנה", "clock", "ghost", "clocks")}</div></div></div><div class="two-equal pad" style="padding-top:0"><div class="panel pad"><div class="subhead"><h3>תוכנית פתיחה</h3>${btn("ניהול", "arrow", "ghost small", "programs")}</div><div class="inline spread"><div><b>שעות קבלה</b><div class="sub">א׳–ה׳ · 08:00–17:00 · Home Assistant</div></div>${badge("פעילה", "good")}</div></div><div class="panel pad"><div class="subhead"><h3>קודים ציבוריים</h3>${btn("ניהול", "arrow", "ghost small", "codes")}</div><div class="inline spread"><span>תא קוד אחד מוגדר</span>${badge("ללא חשיפת קוד")}</div></div></div>`,
  );
}
function programs() {
  return stationFrame(
    `<div class="pad"><div class="subhead"><div><h2>תוכניות פתיחה קבועה</h2><p class="sub">באילו שעות להשאיר את הדלת פתוחה</p></div>${btn("הוסף תוכנית", "plus", "primary", "program-edit")}</div>${notice("התוכניות במסך זה מנוהלות ב־Home Assistant. פתיחה וחזרה למצב רגיל תלויות בחיבור לתחנה.", "warning")}</div>${[
      ["שעות קבלה", "א׳–ה׳ · 08:00–17:00", "פעילה", "good"],
      ["אירוע קהילה", "01.10.2026 · 17:00–21:00", "מושהית", ""],
      ["פתיחת בוקר", "ב׳ · 07:30–08:00", "בהסרה", "warn"],
    ]
      .map(
        ([n, t, s, k]) =>
          `<div class="program-row"><div class="feed-icon">${icon("calendar")}</div><div class="grow"><h3>${n}</h3><small>${t} · דלת 1</small></div>${badge(s, k)}<span class="chip">Home Assistant</span><div class="row-actions">${btn("עריכה", "edit", "small", "program-edit")}${btn("השהיה", "stop", "ghost small")}${btn("הסרה", "trash", "ghost small")}</div></div>`,
      )
      .join(
        "",
      )}<div class="panel-foot"><span>הביצוע האחרון: היום ב־08:00 · פקודה אושרה</span><span>אזור זמן: ירושלים</span></div>`,
    "programs",
  );
}
function programEdit() {
  return (
    head(
      "שעות קבלה",
      "תוכנית פתיחה קבועה · כניסה ראשית",
      btn("חזרה לתוכניות", "arrow", "", "programs"),
      "דלתות / תוכניות פתיחה",
    ) +
    `<section class="panel"><div class="two-col pad"><div class="stack"><div class="form-grid">${field("שם התוכנית", "שעות קבלה")}${select("דלת", ["דלת ראשית · ממסר 1"])}</div><div class="pills"><button class="active" data-pill>ימי שבוע</button><button data-pill>תאריך חד־פעמי</button></div><div class="week">${["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"].map((d, i) => `<button class="day ${i < 5 ? "active" : ""}" data-day>${d}</button>`).join("")}</div><div class="form-grid">${field("שעת פתיחה", "08:00", "time")}${field("חזרה למצב רגיל", "17:00", "time")}</div>${select("אזור זמן", ["Asia/Jerusalem"])}<label class="inline"><input type="checkbox" checked> הפעל את התוכנית לאחר השמירה</label></div><div class="stack"><div class="panel pad" style="background:var(--wash)"><div class="section-label">סיכום התוכנית</div><h2>דלת ראשית פתוחה בשעות קבלה</h2><div class="fact"><span>ימים</span><b>ראשון–חמישי</b></div><div class="fact"><span>שעות</span><bdi>08:00–17:00</bdi></div><div class="fact"><span>מופעלת באמצעות</span><b>Home Assistant</b></div></div>${notice("בסיום החלון נשלחת פקודה לחזרה למצב רגיל. יש לשמור על זמינות HA והרשת.", "warning")}<p class="sub">תוכנית פתיחה שונה מהרשאת אדם: בזמן התוכנית הדלת פתוחה גם ללא קוד או כרטיס.</p></div></div><div class="editor-footer">${btn("ביטול", "", "", "programs")}${btn("שמור והפעל תוכנית", "check", "primary", "", "data-save")}</div></section>`
  );
}
function codes() {
  return stationFrame(
    `<div class="pad"><div class="subhead"><div><h2>קודים ציבוריים</h2><p class="sub">קודים כלליים בתחנה שאינם משויכים לאדם</p></div>${btn("קריאה מחדש", "refresh")}</div>${notice("מוצג מצב תאי הקודים. ערכי קודים קיימים אינם נחשפים; שינוי או מחיקה עשויים לדרוש את הקוד הישן.")}<div class="three-col mt">${["תא 1", "תא 2", "תא 3"].map((n, i) => `<div class="code-slot"><div class="inline spread"><h3>${n}</h3>${badge(i === 0 ? "מוגדר" : i === 1 ? "פנוי" : "לא אומת", i === 0 ? "good" : i === 1 ? "" : "warn")}</div><div class="code-dots">${i === 0 ? "••••••" : "—"}</div><div class="sub">דלת ראשית · ממסר 1</div><div class="inline mt">${btn(i === 0 ? "החלף קוד" : i === 1 ? "הוסף קוד" : "בדוק מצב", i === 0 ? "edit" : i === 1 ? "plus" : "refresh", i === 1 ? "primary" : "", i === 2 ? "sync-detail" : "code-edit")}${i === 0 ? btn("מחיקה", "trash", "ghost small") : ""}</div></div>`).join("")}</div><div class="mt">${notice("בתחנה שאינה תומכת בניהול קודים דרך ISAPI, פעולות הכתיבה יושבתו ותוצג הסיבה.", "warning")}</div></div>`,
    "codes",
  );
}
function technical() {
  return stationFrame(
    `<div class="two-equal pad"><div class="stack">${panel("ממסרים ושמות", `<div class="pad stack">${field("שם התחנה", "כניסה ראשית")}<div class="form-grid">${field("שם ממסר 1", "דלת ראשית")}${field("מזהה API", "1")}</div><label class="inline"><input type="checkbox" checked> ניהול ממסר 1</label><div class="form-grid">${field("שם ממסר 2", "שער שירות")}${field("מזהה API", "2")}</div><label class="inline"><input type="checkbox"> ניהול ממסר 2</label><small>הפעלת ממסר לניהול אינה מעניקה אליו גישה לכל המשתמשים.</small></div>`)}<div class="inline">${btn("שמור הגדרות", "check", "primary", "", "data-save")}${btn("סריקת יכולות", "refresh")}</div></div><div class="stack">${panel("הגדרות דלת שהתחנה מפרסמת", `<div class="pad stack"><div class="form-grid">${field("משך פעולת ממסר בשניות", "5", "number")}${select("דלת", ["ממסר 1"])}</div>${notice("עריכה זמינה רק לאחר קריאת יכולות והגדרות תקפה.")}<div class="fact"><span>קודים ציבוריים</span>${badge("נתמך", "good")}</div><div class="fact"><span>לוח פתיחה מקומי</span>${badge("לא נתמך")}</div><div class="fact"><span>תוכניות דרך HA</span>${badge("זמין", "good")}</div></div>`)}${panel("שעון ותחזוקה", `<div class="pad"><div class="fact"><span>אזור זמן</span><bdi>Asia/Jerusalem</bdi></div><div class="fact"><span>שרת NTP</span><bdi>time.google.com</bdi></div><div class="inline mt">${btn("סנכרן שעון", "clock")}${btn("אבחון תחנה", "activity", "", "health")}</div></div>`)}</div></div>`,
    "technical",
  );
}
function call(active = false) {
  return (
    head(
      "כניסה ראשית",
      active ? "שיחה נכנסת · ממתינה למענה" : "מצלמה ושמע",
      badge("מחוברת", "good") + btn("סגירה", "close", "ghost", "overview"),
      "מרכז הכניסה / שיחה",
    ) +
    `<div class="call-layout"><section><div class="call-stage"><img src="assets/entrance.png" alt="כניסה סינתטית להמחשת פריסת הווידאו"><div class="call-overlay"><span class="badge">${icon("camera")} ${active ? "שיחה נכנסת" : "מצלמה"} · MSE</span><span class="badge">14:32:08</span></div></div><div class="call-strip">${active ? `<button class="call-control" data-demo><span class="round green">${icon("phone")}</span>מענה</button><button class="call-control" data-demo><span class="round red">${icon("hangup")}</span>דחייה</button>` : `<button class="call-control" data-listen><span class="round">${icon("volume")}</span><span data-listen-label>הפעל האזנה</span></button><button class="call-control" data-mic><span class="round">${icon("mic")}</span><span data-mic-label>פתח דיבור</span></button>`}<span style="height:38px;border-inline-start:1px solid var(--line)"></span><button class="call-control" data-unlock><span class="round green">${icon("unlock")}</span>פתח דלת</button><button class="call-control" data-fullscreen><span class="round">${icon("expand")}</span>מסך מלא</button>${btn("", "refresh", "ghost icon-only", "", 'data-demo aria-label="רענון חיבור המצלמה"')}</div><div class="statusline mt" style="text-align:center;margin-top:10px" id="audio-status">${active ? "הפקדים זמינים בהתאם ליכולות השיחה בתחנה." : "האזנה כבויה · המיקרופון כבוי"}<span class="call-listen-text"> · שמע מופעל בלחיצה שלך</span></div></section><aside class="stack" style="align-content:start">${panel("הודעה קולית", `<div class="pad stack gap8"><p class="sub">הקלד טקסט להשמעה ברמקול התחנה.</p><label class="field"><textarea id="tts-text" maxlength="500" placeholder="מה תרצה לומר?">שלום, אפשר להיכנס דרך הדלת הראשית.</textarea></label><div class="inline spread"><small id="tts-count">39 / 500</small>${badge("עברית · Google TTS")}</div>${btn("השמע בתחנה", "volume", "primary", "", "data-tts")}<div class="settings-mini mt">${select("מנוע קול", ["Google Translate · עברית"])}<p class="sub mt">ניתן לבחור מנוע ושפה מהיכולות הזמינות ב־HA.</p></div><p class="sub" id="tts-status">ההודעה תישלח רק לאחר לחיצה.</p></div>`, "", "tts")}${panel("כלי שמע", `<div class="pad"><div class="setting-row" style="padding-top:0"><div><h3>מיקרופון</h3><p>פתיחה וסגירה בלחיצה</p></div>${icon("mic")}</div><div class="inline mt">${btn("בדיקת קלט", "mic", "small")}${btn("אבחון", "activity", "small", "health")}</div><div class="mt">${notice("סגירת החלון או מעבר לרקע מפסיקים את השמע.")}</div></div>`, "", "call-details")}</aside></div>`
  );
}
function activity(event = false) {
  return (
    head(
      "פעילות",
      "אירועי כניסה, קוד וכרטיס ומצב התחנות",
      btn("דוחות", "chart", "", "reports") + btn("ייצוא", "download"),
      "",
    ) +
    `<div class="toolbar">${search("חיפוש אדם או אירוע…")}${pills(["כל האירועים", "כניסה אושרה", "נדחה", "צלצול"])}${btn("היום", "calendar")}${btn("מסננים", "filter")}</div><div class="activity-layout">${panel(
      "",
      table(
        ["זמן", "אדם", "דלת", "אמצעי כניסה", "תוצאה"],
        names
          .slice(0, 10)
          .map((n, i) => [
            `<bdi>14:${String(32 - i * 2).padStart(2, "0")}:08</bdi>`,
            `<a href="#event" class="inline">${avatar(n, i === 0)}<span><b>${n}</b><span class="sub">אירוע ${i === 8 ? "היסטורי" : "חי"}</span></span></a>`,
            doors[i % 8],
            i === 2 ? "כרטיס לא משויך" : i % 2 ? "כרטיס" : "קוד אישי",
            badge(i === 2 ? "נדחה" : "אושר", i === 2 ? "bad" : "good"),
          ]),
      ) +
        `<div class="panel-foot"><span>מציג 10 מתוך 86 אירועי היום</span><span>24.09.2026 · ירושלים</span></div>`,
    )}<aside class="activity-aside">${panel(
      event ? "פרטי האירוע" : "אירוע נבחר",
      `<div class="pad"><div class="inline mb">${avatar("נועה לביא", true, "mid")}<div><h2>נועה לביא</h2><small>כניסה ראשית</small></div></div>${badge("גישה אושרה", "good")}<div class="mt">${[
        ["זמן האירוע", "14:32:08"],
        ["אמצעי כניסה", "קוד אישי"],
        ["מקור", "אירוע חי"],
        ["זיהוי", "מזהה עובד תואם"],
        ["אזור זמן", "Asia/Jerusalem"],
      ]
        .map(
          ([k, v]) =>
            `<div class="fact"><span>${k}</span><span>${v}</span></div>`,
        )
        .join(
          "",
        )}</div><div class="mt">${btn("כרטיס אדם", "people", "soft", "person")}</div><p class="sub mt">התמונה היא תמונת המשתמש הנוכחית. היא אינה צילום מהאירוע.</p><div class="mt">${btn("פרטי מקור ואבחון", "activity", "ghost small")}</div></div>`,
    )}</aside></div>`
  );
}
function reports() {
  return (
    head(
      "דוחות פעילות",
      "סיכום אירועים לפי טווח ומסננים",
      btn("תצוגת הדפסה", "activity") + btn("ייצוא CSV", "download", "primary"),
      "פעילות / דוחות",
    ) +
    `<div class="toolbar">${btn("1–24 בספטמבר", "calendar")}${btn("כל התחנות", "down")}${btn("כל האנשים", "down")}${btn("תצוגה שמורה", "down")}</div><div class="stats"><div class="stat"><strong>1,248</strong><span>אירועים בטווח</span></div><div class="stat"><strong>1,196</strong><span>כניסות אושרו</span></div><div class="stat"><strong>52</strong><span>כניסות נדחו</span></div><div class="stat"><strong>8</strong><span>תחנות</span></div></div>${panel(
      "סיכום לפי תחנה",
      table(
        ["תחנה", "כל האירועים", "אושר", "נדחה"],
        doors
          .slice(0, 8)
          .map((d, i) => [
            d,
            [288, 196, 174, 164, 136, 112, 96, 82][i],
            [280, 188, 168, 156, 130, 108, 88, 78][i],
            [8, 8, 6, 8, 6, 4, 8, 4][i],
          ]),
      ),
    )}<div class="mt">${notice("סינון לפי קבוצה או שדה משתמש מבוסס על הנתונים הנוכחיים, ולא על החברות בקבוצה בזמן האירוע.")}</div>`
  );
}
function sync(detail = false) {
  if (detail)
    return (
      head(
        "בדיקת סנכרון",
        "מיה הדר · לובי מזרח",
        btn("חזרה לסנכרון", "arrow", "", "sync"),
        "ניהול / סנכרון",
      ) +
      `<div class="two-equal">${panel("מה דורש טיפול?", `<div class="pad stack">${notice("אימות ההרשאה בתחנה לא הושלם. הסנכרון של אנשים אחרים ממשיך.", "warning")}<div class="fact"><span>שלב</span><b>קריאה חוזרת לאחר כתיבה</b></div><div class="fact"><span>מצב התוצאה</span>${badge("לא ידוע", "warn")}</div><div class="fact"><span>ניסיון אחרון</span><bdi>14:28:12</bdi></div><div class="fact"><span>תחנה</span><b>לובי מזרח</b></div><p class="sub">יש לברר את המצב בפועל לפני שליחת שינוי חוזר.</p>${btn("בדוק מצב בתחנה", "refresh", "primary")}${btn("הורדת אבחון מוסווה", "download", "ghost")}</div>`)}${panel("התקדמות הפעולה", `<div class="pad"><div class="feedrow"><div class="feed-icon">${icon("check")}</div><div><h3>הנתונים נשמרו ב־WisKey</h3><small>14:28:02</small></div></div><div class="feedrow"><div class="feed-icon">${icon("check")}</div><div><h3>בקשה נשלחה לתחנה</h3><small>14:28:03</small></div></div><div class="feedrow"><div class="feed-icon">${icon("clock")}</div><div><h3>ממתין לאימות</h3><small>מועד הקריאה פג</small></div></div><div class="mt">${notice("מצב האדם נשאר פעיל. תקלה בתחנה אינה משנה את מצב המשתמש.")}</div></div>`)}</div>`
    );
  return (
    head(
      "מצב סנכרון",
      "כל הרשאה, בכל תחנה — עם מצב נפרד וברור",
      btn("פעולות ברקע", "activity", "", "operations") +
        btn("סנכרן הכול", "refresh", "primary"),
    ) +
    `<div class="toolbar">${search("חיפוש אדם…")}${pills(["הכול", "דורש טיפול 2", "ממתינים 1"])}${btn("בחירת תחנות", "down")}</div>${panel(
      "",
      `<div class="table-wrap"><table class="sync-table"><thead><tr><th>אדם</th>${doors
        .slice(0, 8)
        .map((d) => `<th>${d}</th>`)
        .join("")}</tr></thead><tbody>${names
        .slice(0, 7)
        .map(
          (n, i) =>
            `<tr><td><a href="#person" class="inline">${avatar(n, i === 0)}<b>${n}</b></a></td>${doors
              .slice(0, 8)
              .map(
                (d, j) =>
                  `<td>${i === 2 && j === 1 ? `<a href="#sync-detail">${badge("לבדיקה", "warn")}</a>` : j === 7 && i < 2 ? badge("ממתין") : i === 3 && j > 3 ? '<span class="muted">—</span>' : `<span class="color-good">${icon("check")}<span class="mobile-hide"> מסונכרן</span></span>`}</td>`,
              )
              .join("")}</tr>`,
        )
        .join(
          "",
        )}</tbody></table></div><div class="panel-foot"><span>שמות תחנות קריאים · מזהים טכניים מופיעים רק באבחון</span><span>7 אנשים בתצוגה</span></div>`,
    )}<div class="mt">${notice("תחנה מנותקת: ההרשאות שלה ממתינות. יתר התחנות והמשתמשים ממשיכים להסתנכרן.")}</div>`
  );
}
function operations() {
  return (
    head(
      "פעולות ברקע",
      "סנכרון, ייבוא ועדכונים מרובים",
      btn("מצב הרשאות", "refresh", "", "sync"),
      "ניהול / פעולות",
    ) +
    `<div class="toolbar">${pills(["הכול", "בתהליך 1", "דורש טיפול 1", "הושלם"])}${search("חיפוש פעולה…")}</div>${panel(
      "",
      [
        ["סנכרון הרשאות", "בתהליך", "info", "64 מתוך 72 פעולות", 89],
        ["ייבוא אנשים מקובץ CSV", "הושלם", "good", "18 אנשים עודכנו", 100],
        [
          "עדכון קבוצת אחזקה",
          "דורש טיפול",
          "warn",
          "11 הצליחו · תחנה אחת ממתינה",
          92,
        ],
      ]
        .map(
          ([n, s, k, t, p], i) =>
            `<article class="job"><div class="inline spread"><div class="inline"><div class="feed-icon">${icon(i === 1 ? "upload" : "refresh")}</div><div><h3>${n}</h3><small>היום · ${["14:28", "13:42", "12:08"][i]}</small></div></div>${badge(s, k)}</div><div class="progress"><span style="width:${p}%"></span></div><div class="inline spread"><span class="sub">${t}</span>${btn("פירוט", "arrow", "ghost small", i === 1 ? "imports" : "sync-detail")}</div></article>`,
        )
        .join(""),
    )}<div class="mt">${notice("פעולות שנשלחו ממשיכות גם לאחר מעבר מסך. פעולה אחת שנכשלה אינה עוצרת את היתר.")}</div>`
  );
}
function imports() {
  return (
    head(
      "ייבוא אנשים",
      "בדיקת שורות ותצוגת השפעה לפני החלה",
      btn("ייבוא מהתחנה", "door", "", "recovery"),
      "אנשים / ייבוא",
    ) +
    `<div class="steps"><span class="step"><span class="bubble">✓</span>בחירת קובץ</span><span class="step active"><span class="bubble">2</span>בדיקת נתונים</span><span class="step"><span class="bubble">3</span>אישור וייבוא</span></div><div class="stats"><div class="stat"><strong>18</strong><span>אנשים חדשים</span></div><div class="stat"><strong>6</strong><span>עדכונים</span></div><div class="stat"><strong>2</strong><span>שורות לתיקון</span></div><span class="clock">people-september.csv</span></div>${panel(
      "תצוגה מקדימה",
      table(
        ["שורה", "שם", "טלפון", "קבוצה", "פעולה", "בדיקה"],
        names
          .slice(0, 6)
          .map((n, i) => [
            i + 2,
            n,
            `<bdi>050-000-${String(i + 1).padStart(4, "0")}</bdi>`,
            i % 2 ? "אחזקה" : "צוות ניהול",
            i > 3 ? "עדכון" : "יצירה",
            i === 2
              ? badge("מזהה עובד כפול", "bad")
              : i === 5
                ? badge("מספר נייד לא תקין", "bad")
                : badge("תקין", "good"),
          ]),
      ) +
        `<div class="editor-footer"><span class="sub">תקן את שתי השורות המסומנות לפני הייבוא.</span>${btn("החלפת קובץ", "upload")}${btn("ייבוא הנתונים", "check", "primary", "", "disabled")}</div>`,
    )}<div class="two-equal mt">${notice("מספרי נייד מנורמלים. שדות מותאמים וקבוצות נשמרים לפי המיפוי שנבחר.")}${notice("קיבולת התחנות נבדקת לפני הייבוא. קיבולת לא ידועה מוצגת במפורש.", "warning")}</div>`
  );
}
function lifecycle() {
  return (
    head(
      "תוקף ואיכות נתונים",
      "ריכוז הרשאות מסתיימות, כפילויות ואמצעי כניסה חסרים",
      btn("ייצוא דוח", "download"),
      "אנשים / בקרה",
    ) +
    `<div class="toolbar">${pills(["מסתיימות בקרוב 3", "פגו 2", "חשד לכפילות 2", "ללא אמצעי כניסה 4"])}${btn("7 ימים קרובים", "calendar")}</div>${panel(
      "הרשאות שמסתיימות השבוע",
      table(
        ["אדם", "תוקף עד", "זמן שנותר", "דלתות", ""],
        names
          .slice(0, 3)
          .map((n, i) => [
            `<div class="inline">${avatar(n)}<b>${n}</b></div>`,
            `<bdi>${25 + i}.09.2026 · 18:00</bdi>`,
            badge(`${i + 1} ימים`, "warn"),
            [4, 6, 1][i],
            btn("בדיקת פרטים", "arrow", "ghost small", "person"),
          ]),
      ),
    )}<div class="mt">${notice("זהו דוח לבדיקה. לא נשלחות תזכורות ולא מתבצע מיזוג משתמשים אוטומטי.")}</div>`
  );
}
const settingsLinks = [
  ["management", "מרכז הניהול", "grid"],
  ["fields", "אנשים וקבוצות", "people"],
  ["permissions", "הרשאות מנהלים", "shield"],
  ["media", "וידאו ושמע", "camera"],
  ["clocks", "זמן ו־NTP", "clock"],
  ["templates", "תבניות הודעות", "chat"],
  ["appearance", "עיצוב הממשק", "sun"],
  ["health", "תקינות ואבחון", "activity"],
  ["schedules", "תזמון מתקדם", "calendar"],
  ["audit", "יומן ניהולי", "activity"],
];
function settingsFrame(title, desc, body, active, actions = "") {
  return (
    head(title, desc, actions, "ניהול / " + title) +
    `<div class="settings-layout"><nav class="panel settings-menu" aria-label="כלי ניהול">${settingsLinks.map(([id, t, i]) => `<a href="#${id}" class="${active === id ? "active" : ""}">${icon(i)}${t}</a>`).join("")}</nav><section class="stack">${body}</section></div>`
  );
}
function management() {
  const tiles = [
    [
      "fields",
      "אנשים ופרופילים",
      "שדות מותאמים, קבוצות ותבניות קליטה",
      "people",
    ],
    [
      "permissions",
      "הרשאות למשתמשי HA",
      "מי יכול לצפות, לנהל ולבצע פעולות",
      "shield",
    ],
    ["media", "וידאו ושמע", "ספק וידאו, MSE / RTC ומצב מיקרופון", "camera"],
    ["clocks", "זמן ו־NTP", "מקור זמן משותף וסנכרון תחנות", "clock"],
    ["templates", "תבניות WhatsApp", "טקסטים מוכנים עם תצוגה מקדימה", "chat"],
    ["appearance", "מראה המערכת", "עיצוב בהיר או כהה וברירת מחדל", "sun"],
    ["sync", "סנכרון והרשאות", "סטטוס לפי אדם ולפי תחנה", "refresh"],
    ["health", "תקינות ותמיכה", "אבחון ציוד, דוחות ובדיקות שדה", "activity"],
    ["schedules", "תזמון מתקדם", "ספריית לוחות ופריסה מקומית", "calendar"],
    ["operations", "פעולות ברקע", "התקדמות ייבוא, סנכרון ושינויים", "grid"],
    ["audit", "יומן ניהולי", "מי שינה, מה ומתי", "activity"],
    ["lifecycle", "איכות נתונים", "תוקף, כפילויות ואמצעי כניסה", "people"],
  ];
  return (
    head(
      "ניהול",
      "הגדרות, כלי עבודה ותקינות המערכת",
      badge("מנהל Home Assistant", "info"),
    ) +
    `<div class="three-col cards">${tiles.map(([id, t, desc, i]) => `<a class="panel menu-card" href="#${id}"><div class="feed-icon">${icon(i)}</div><div class="grow"><h3>${t}</h3><p>${desc}</p></div>${icon("arrow")}</a>`).join("")}</div><div class="mt">${notice("כל משתמש רואה רק מסכים ופעולות שהורשו עבורו. הרשאות מפעילי HA מנוהלות בידי מנהל HA.")}</div>`
  );
}
function fields() {
  return settingsFrame(
    "אנשים ופרופילים",
    "התאמת פרטי האדם לארגון",
    panel(
      "שדות מותאמים",
      table(
        ["תווית", "סוג", "חובה", "בטבלה", ""],
        [
          ["מחלקה", "רשימת בחירה", "כן", "כן"],
          ["תפקיד", "טקסט", "לא", "כן"],
          ["מספר בניין", "טקסט", "לא", "לא"],
        ].map((r) => [...r, btn("עריכה", "edit", "ghost small")]),
      ) +
        `<div class="panel-foot">${btn("הוסף שדה", "plus", "soft")}<span>שם ונייד הם שדות בסיס</span></div>`,
    ) +
      panel(
        "קליטת אנשים",
        `<div class="pad"><div class="setting-row"><div><h3>תמונת משתמש</h3><p>מאפשר צילום במצלמת המחשב והצגת תמונה בכרטיס וביומן.</p></div><span class="switch"></span></div><div class="setting-row"><div><h3>תבניות קליטה</h3><p>ערכי שדות וקבוצות מוכנים מראש לאדם חדש.</p></div>${btn("ניהול תבניות", "edit", "small")}</div><div class="setting-row"><div><h3>קבוצות והרשאות</h3><p>תחנות מורשות שיורשים חברי הקבוצה.</p></div>${btn("ניהול קבוצות", "people", "small", "groups")}</div></div>`,
      ),
    "fields",
    btn("סקירת השינוי", "check", "primary", "group-edit"),
  );
}
function templates() {
  return settingsFrame(
    "תבניות WhatsApp",
    "התאמת ההודעה לפני שליחה לאדם",
    panel(
      "",
      `<div class="two-equal pad"><div class="stack">${field("שם הארגון", "מרכז קהילתי")}<label class="field"><span>תבנית פרטי גישה</span><textarea style="min-height:270px">שלום {{name}} 👋

🏫 {{organization}}
הרשאת הגישה שלך ב־WisKey 🔐

{{credentials}}

🚪 {{doors}}

{{schedule}}

🔒 אמצעי הכניסה אישי. אין להעבירו לאחרים.</textarea></label><div class="inline wrap">${["שם", "ארגון", "אמצעי כניסה", "דלתות", "זמנים"].map((t) => `<span class="chip">${t}</span>`).join("")}</div></div><div class="stack"><h3>תצוגה מקדימה · כרטיס בלבד</h3><div class="message out" style="max-width:100%">שלום נועה 👋<br><br>🏫 מרכז קהילתי<br>הרשאת הגישה שלך ב־WisKey 🔐<br><br>💳 הכניסה באמצעות הכרטיס האישי שלך.<br><br>🚪 כניסה ראשית, לובי מזרח<br><br>📆 שני וחמישי<br>⌚ 09:00–17:00<br><br>🔒 אמצעי הכניסה אישי. אין להעבירו לאחרים.</div><p class="sub">אין שורת קוד כאשר לא הוגדר PIN. הגבלות ימים ושעות מוצגות רק כשהן קיימות.</p></div></div>`,
    ),
    "templates",
    btn("שמור תבנית", "check", "primary", "", "data-save"),
  );
}
function media() {
  return settingsFrame(
    "וידאו ושמע",
    "הגדרות ברירת מחדל לכל התחנות",
    panel(
      "וידאו",
      `<div class="pad"><div class="setting-row"><div><h3>מסלול וידאו</h3><p>הספק הקיים בשרת Home Assistant</p></div><select><option>go2rtc / WebRTC</option><option>HLS</option></select></div><div class="setting-row"><div><h3>אופן ניגון</h3><p>MSE מתאים גם לרשתות שבהן RTC מוגבל.</p></div><select><option>MSE</option><option>RTC</option></select></div><div class="setting-row"><div><h3>מעבר ל־HLS כשצריך</h3><p>חלופה כאשר מסלול הווידאו שנבחר אינו זמין.</p></div><span class="switch"></span></div><div class="setting-row"><div><h3>ספק go2rtc</h3><p>הרחבה קיימת · זוהתה אוטומטית</p></div>${badge("מחובר", "good")}</div><div class="inline mt">${btn("בדיקת ספק", "refresh")}${btn("גילוי מחדש", "search", "ghost")}</div></div>`,
    ) +
      panel(
        "מיקרופון והאזנה",
        `<div class="pad"><div class="setting-row"><div><h3>אופן פתיחת מיקרופון</h3><p>בחירה גורפת למחשב ולנייד</p></div><select><option>פתיחה / סגירה בלחיצה</option><option>לחיצה ממושכת — PTT</option></select></div><div class="mt">${notice("וידאו והאזנה מתחילים במיוט. שמע ודיבור נפתחים בפעולת המשתמש ונסגרים ביציאה.")}</div></div>`,
      ),
    "media",
    btn("שמור הגדרות", "check", "primary", "", "data-save"),
  );
}
function clocks() {
  return settingsFrame(
    "זמן ו־NTP",
    "מקור זמן משותף, אזורי זמן וסטיית שעונים",
    panel(
      "שרת הזמן",
      `<div class="pad"><div class="form-grid">${field("שרת NTP", "time.google.com")}${field("פורט", "123", "number")}${field("מרווח סנכרון בדקות", "60", "number")}${select("הצגת זמנים", ["לפי הגדרות התחנה", "אזור זמן ידני"])}</div><div class="inline mt">${btn("שמירת הגדרות", "check", "primary", "", "data-save")}${btn("סנכרן את כל התחנות", "refresh")}</div></div>`,
    ) +
      panel(
        "מצב התחנות",
        table(
          ["תחנה", "זמן מקומי", "סטייה", "מקור", ""],
          doors
            .slice(0, 5)
            .map((d, i) => [
              d,
              `<bdi>14:32:${String(8 + i).padStart(2, "0")}</bdi>`,
              i === 3 ? badge("+8 שניות", "warn") : badge("<2 שניות", "good"),
              "NTP",
              btn("סנכרן", "refresh", "small"),
            ]),
        ),
      ) +
      notice(
        "זמן מארח Home Assistant מנוהל בנפרד. שינוי NTP של המארח זמין רק כאשר הסביבה תומכת בו.",
      ),
    "clocks",
  );
}
function permissions() {
  return settingsFrame(
    "הרשאות משתמשי HA",
    "בחירה מי יראה את WisKey ומה יוכל לבצע",
    panel(
      "",
      `<div class="pad"><div class="inline spread mb"><div class="inline">${avatar("רוני מנהל", false, "mid")}<div><h2>רוני כהן</h2><small>משתמש Home Assistant</small></div></div>${badge("גישה מופעלת", "good")}</div>${notice("ניהול הרשאות מפעילים זמין למנהל HA בלבד. הרשאות כניסה פיזיות מנוהלות בכרטיס האדם.")}<div class="mt">${table(
        ["אזור", "ללא גישה", "צפייה", "ניהול"],
        [
          ["סקירה, מצלמות ושיחה", 2],
          ["אנשים והרשאות", 1],
          ["פעילות ודוחות", 1],
          ["תחנות", 0],
          ["כלי ניהול", 0],
        ].map(([n, a], idx) => [
          n,
          ...[0, 1, 2].map(
            (i) =>
              `<input type="radio" name="area-${idx}" ${i === a ? "checked" : ""} aria-label="${n} — ${["ללא", "צפייה", "ניהול"][i]}">`,
          ),
        ]),
        "matrix",
      )}</div><div class="mt">${notice("הרשאת ניהול בסקירה כוללת פתיחת דלת ושמע לפי הרשאת השרת. הסתרת כפתור לבדה אינה בקרת הרשאה.", "warning")}</div></div><div class="editor-footer"><span class="sub">שינויים נשמרים עם בדיקת גרסה למניעת דריסה.</span>${btn("שמור הרשאות", "shield", "primary", "", "data-save")}</div>`,
    ),
    "permissions",
  );
}
function health() {
  return settingsFrame(
    "תקינות ואבחון",
    "נתונים טכניים, מוכנות ומסמכי תמיכה",
    panel(
      "מצב מערכת",
      `<div class="pad"><div class="inline gap24 mb"><div class="small-stat"><strong>7 / 8</strong><small>מחוברות</small></div><div class="small-stat"><strong>2</strong><small>ממתינים לסנכרון</small></div><div class="small-stat"><strong>0</strong><small>שגיאות זרם אירועים</small></div></div>${notice("משרדים לא הגיבה. החיבור לשאר התחנות תקין.", "warning")}</div>`,
    ) +
      panel(
        "תחנות",
        table(
          ["שם", "אירועים", "קשר אחרון", "שעון", ""],
          doors
            .slice(0, 5)
            .map((d) => [
              d,
              badge("פעיל", "good"),
              "לפני 8 שניות",
              badge("תקין", "good"),
              btn("פרטים", "arrow", "ghost small", "technical"),
            ]),
        ),
      ) +
      panel(
        "בדיקות ותמיכה",
        `<div class="pad inline wrap">${btn("חבילת תמיכה מוסווית", "download")}${btn("רישום בדיקות שדה", "check")}${btn("אבחון שמע", "mic")}${btn("מוכנות גרסה", "shield")}</div>`,
      ),
    "health",
    btn("רענן בדיקה", "refresh", "primary"),
  );
}
function audit() {
  return settingsFrame(
    "יומן ניהולי",
    "פעולות מנהלים ושינויים בהרשאות",
    panel(
      "",
      `<div class="pad toolbar" style="margin-bottom:0">${search("חיפוש פעולה או אדם…")}${btn("היום", "calendar")}${btn("ייצוא", "download")}</div>${table(
        ["זמן", "מבצע", "פעולה", "מטרה", "תוצאה"],
        [
          ["14:28", "מנהל מערכת", "עדכון הרשאות", "מיה הדר", "ממתין לסנכרון"],
          ["13:42", "מנהל מערכת", "ייבוא CSV", "18 אנשים", "הושלם"],
          ["12:08", "רוני כהן", "עדכון קבוצה", "אחזקה", "הושלם"],
          ["11:34", "מנהל מערכת", "שינוי קוד", "נועה לביא", "הושלם"],
          ["10:16", "מנהל מערכת", "עדכון הגדרה", "שרת NTP", "הושלם"],
        ].map((r) => [
          ...r.slice(0, 4),
          badge(r[4], r[4] === "הושלם" ? "good" : "warn"),
        ]),
      )}<div class="panel-foot"><span>קודים וסודות אינם מוצגים ביומן</span></div>`,
    ),
    "audit",
  );
}
function schedules() {
  return settingsFrame(
    "ספריית לוחות",
    "תכנון משותף וכלים מתקדמים לתחנות תומכות",
    panel(
      "",
      `<div class="pad inline spread"><div><h2>לוחות שמורים</h2><p class="sub">שמירה בספרייה אינה מפעילה לוח בתחנה.</p></div>${btn("לוח חדש", "plus", "primary", "person-timing")}</div>${table(
        ["שם", "ימים ושעות", "חריגים", "עדכון אחרון", ""],
        [
          ["שעות משרד", "א׳–ה׳ · 08:00–17:00", "2 חריגים"],
          ["צוות ניקיון", "ב׳, ה׳ · 12:00–18:00", "ללא"],
          ["אירוע ערב", "תאריך מסוים · 17:00–21:00", "ללא"],
        ].map((r) => [
          ...r,
          "היום",
          `<div class="inline">${btn("עריכה", "edit", "small", "person-timing")}${btn("בדיקת פריסה", "arrow", "ghost small", "deployment")}</div>`,
        ]),
      )}<div class="panel-foot">${btn("ייבוא לוחות", "upload", "small")}${btn("ייצוא", "download", "small")}</div>`,
    ) +
      notice(
        "לוח הרשאת אדם מגדיר מתי אדם רשאי להיכנס. תוכנית פתיחה קבועה משאירה דלת פתוחה ונמצאת בניהול התחנה.",
      ),
    "schedules",
  );
}
function deployment() {
  return settingsFrame(
    "פריסה מקומית לתחנה",
    "בדיקת יכולות ותלויות לפני כתיבה",
    panel(
      "שעות משרד → כניסה ראשית",
      `<div class="pad stack"><div class="steps"><span class="step active"><span class="bubble">1</span>מוכנות</span><span class="step"><span class="bubble">2</span>השפעה</span><span class="step"><span class="bubble">3</span>כתיבה ואימות</span></div>${notice("התחנה בדוגמה אינה תומכת בממשק הדרוש לפריסה מקומית. לא תתבצע כתיבה.", "warning")}${table(
        ["בדיקה", "תוצאה"],
        [
          ["חיבור לתחנה", badge("תקין", "good")],
          ["תוכנית שבועית", badge("לא נתמך")],
          ["משאב חופשי", "לא ניתן לבדוק"],
          ["כתיבה מקומית", badge("אינה זמינה", "warn")],
        ],
      )}<p class="sub">בדיקת דגם זהה בתחנה אחרת אינה הוכחה לתמיכה. היכולת נקראת בנפרד מכל תחנה.</p><div class="inline">${btn("סריקה מחדש", "refresh")}${btn("פריסת הלוח", "check", "primary", "", "disabled")}</div></div>`,
    ) +
      panel(
        "היסטוריית פריסה ושחזור",
        `<div class="pad"><p class="sub">פעולות פריסה, תביעות משאבים, תמונות בסיס ותוצאות אימות נשמרות במסלול המתקדם הקיים.</p><div class="inline mt">${btn("פעולות פריסה", "activity")}${btn("תלויות ומשאבים", "grid")}${btn("בדיקת הבדלים", "refresh", "", "recovery")}</div></div>`,
      ),
    "schedules",
  );
}
function recovery() {
  return (
    head(
      "בדיקת הבדלים",
      "נועה לביא · כניסה ראשית",
      btn("חזרה לסנכרון", "arrow", "", "sync"),
      "ניהול / סנכרון",
    ) +
    `<section class="panel"><div class="pad stack">${notice("הנתונים שנקראו מהתחנה שונים מההגדרה ב־WisKey. בחר פעולה לאחר בדיקת שני הצדדים.", "warning")}<div class="review-pair"><div class="panel pad"><div class="section-label">WisKey</div><h2>הגדרה נוכחית</h2><div class="fact"><span>הרשאה</span><b>דלת 1 בלבד</b></div><div class="fact"><span>מצב</span>${badge("פעילה", "good")}</div><div class="fact"><span>כרטיסים</span><span>1</span></div></div><div class="panel pad"><div class="section-label">נתונים מהתחנה</div><h2>קריאה אחרונה</h2><div class="fact"><span>הרשאה</span><b>דלת 1 ודלת 2</b></div><div class="fact"><span>מצב</span>${badge("פעילה", "good")}</div><div class="fact"><span>כרטיסים</span><span>1</span></div></div></div><p class="sub">מוצגים נתונים מוסווים בלבד. ההחלה מבצעת קריאה חדשה כדי להימנע מדריסת שינוי נוסף.</p></div><div class="editor-footer">${btn("בדיקה מחדש", "refresh")}${btn("החל את הגדרת WisKey", "check", "primary", "", "data-save")}</div></section>`
  );
}
function appearance() {
  return settingsFrame(
    "עיצוב הממשק",
    "בחירה אישית וברירת מחדל לכל המשתמשים",
    panel(
      "בחירת עיצוב",
      `<div class="pad"><div class="two-equal">${["בהיר", "כהה"].map((t, i) => `<button class="code-slot" style="text-align:start;background:var(--surface);color:var(--ink);${theme === (i ? "dark" : "light") ? "border-color:var(--accent)" : ""}" data-choose-theme="${i ? "dark" : "light"}"><div class="mode-preview ${i ? "dark" : ""}"><div class="mini-nav"><i></i><i></i><i></i></div><div class="mini-cards">${"<i></i>".repeat(8)}</div></div><div class="inline spread"><h3>WisKey · ${t}</h3>${theme === (i ? "dark" : "light") ? badge("נבחר", "good") : ""}</div><p class="sub mt" style="margin-top:5px">עיצוב חדש · הצעה לאישור</p></button>`).join("")}</div><div class="setting-row mt"><div><h3>ברירת מחדל לכל המשתמשים</h3><p>הבחירה תחול על משתמשים שמוגדרים לעקוב אחרי ברירת המחדל.</p></div><span class="switch"></span></div><div class="setting-row"><div><h3>בחירה אישית בדפדפן הזה</h3><p>משתמש שכבר בחר עיצוב יכול לשמור את בחירתו.</p></div><select><option>לפי ברירת המחדל</option><option>בחירה אישית</option></select></div><div class="mt">${notice("העיצובים הקיימים נשארים זמינים: נוכחי, מודרני, Access בהיר ו־Access כהה.")}</div></div><div class="editor-footer"><span class="sub">שינוי עיצוב אינו סוגר עורך או חיבור שמע פעיל.</span>${btn("החל עיצוב", "check", "primary", "", "data-save")}</div>`,
    ),
    "appearance",
  );
}
function states() {
  return (
    head(
      "מצבי מערכת",
      "אותה שפה עיצובית גם כשחסר מידע",
      btn("חזרה לניהול", "arrow", "", "management"),
    ) +
    `<div class="two-equal">${panel("אין תוצאות", `<div class="empty">${icon("search")}<h3>לא נמצאו אנשים</h3><p>אפשר לשנות חיפוש או לנקות את המסננים.</p>${btn("נקה מסננים", "refresh", "soft")}</div>`)}${panel("צפייה בלבד", `<div class="pad stack">${notice("יש לך הרשאת צפייה. עריכת הרשאות ופתיחת דלת דורשות הרשאה נוספת.")}<div class="grant"><div class="grow"><h3>כניסה ראשית</h3><small>ממסר 1</small></div>${badge("מחוברת", "good")}</div>${btn("פתח דלת", "unlock", "primary", "", "disabled")}<small>הסיבה נראית גם בלי מעבר עכבר.</small></div>`)}${panel("לא הצלחנו לרענן", `<div class="pad stack">${notice("החיבור ל־Home Assistant נותק. המידע המוצג עודכן לאחרונה ב־14:28.", "warning")}<h3>הנתונים הקודמים נשמרו בתצוגה</h3><p class="sub">פעולות כתיבה מושבתות עד לחידוש החיבור.</p>${btn("נסה להתחבר מחדש", "refresh", "primary")}</div>`)}${panel("שינוי מחלון אחר", `<div class="pad stack">${notice("הנתונים עודכנו בידי מנהל אחר. השינויים שלך לא נדרסו.", "warning")}<h3>בדוק את הגרסה העדכנית לפני שמירה</h3><p class="sub">הטיוטה המקומית נשמרת להשוואה.</p>${btn("טען והשווה", "copy", "primary", "", "data-demo")}</div>`)}</div>`
  );
}
const renderers = {
  overview: () => overview(),
  "overview-12": () => overview(true),
  people,
  person,
  "person-edit": personEdit,
  "person-access": personAccess,
  "person-timing": () => timing(),
  "person-dates": () => timing(true),
  credentials,
  pin,
  card,
  photo,
  groups,
  "group-edit": () => groups(true),
  whatsapp: () => whatsapp(),
  chat: () => whatsapp(true),
  doors: doorsPage,
  station,
  programs,
  "program-edit": programEdit,
  codes,
  technical,
  call: () => call(),
  "call-active": () => call(true),
  activity: () => activity(),
  event: () => activity(true),
  reports,
  sync: () => sync(),
  "sync-detail": () => sync(true),
  operations,
  imports,
  lifecycle,
  management,
  fields,
  templates,
  media,
  clocks,
  permissions,
  health,
  audit,
  schedules,
  deployment,
  recovery,
  appearance,
  states,
};
function toast(t = "הדמיה בלבד — לא בוצעה פעולה במערכת") {
  const el = document.querySelector("#toast");
  el.textContent = t;
  el.classList.add("open");
  clearTimeout(window._toast);
  window._toast = setTimeout(() => el.classList.remove("open"), 3500);
}
function render() {
  screen = location.hash.slice(1) || "overview";
  if (!renderers[screen]) screen = "overview";
  document.title = `WisKey · ${SCREENS.find((s) => s[0] === screen)?.[1]}`;
  document.querySelector("#app").innerHTML = shell(renderers[screen]());
  const text = document.querySelector("#message-text"),
    prev = document.querySelector("#message-preview");
  if (text && prev) {
    prev.textContent = text.value;
    text.oninput = () => (prev.textContent = text.value);
  }
  const tt = document.querySelector("#tts-text"),
    tc = document.querySelector("#tts-count");
  if (tt && tc) {
    const update = () => (tc.textContent = `${tt.value.length} / 500`);
    tt.oninput = update;
    update();
  }
  window.scrollTo(0, 0);
}
window.addEventListener("hashchange", render);
document.addEventListener("click", (e) => {
  const t = e.target.closest("button,a");
  if (!t) return;
  if (t.hasAttribute("data-theme-toggle")) {
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = theme;
    return;
  }
  if (t.dataset.chooseTheme) {
    theme = t.dataset.chooseTheme;
    render();
    return;
  }
  if (t.hasAttribute("data-pill")) {
    t.parentElement
      .querySelectorAll("button,a")
      .forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    toast("בחירת מסנן להמחשה · רשומות ההדמיה קבועות");
    return;
  }
  if (t.hasAttribute("data-day")) {
    t.classList.toggle("active");
    return;
  }
  if (t.hasAttribute("data-filter")) {
    document.querySelector("#filters")?.classList.toggle("hidden");
    return;
  }
  if (t.hasAttribute("data-unlock")) {
    toast("הדמיית פתיחה בלבד — לא נשלחה פקודה לדלת");
    return;
  }
  if (t.hasAttribute("data-send")) {
    toast("הדמיה בלבד — לא נשלחה הודעת WhatsApp");
    return;
  }
  if (t.hasAttribute("data-tts")) {
    document.querySelector("#tts-status").textContent =
      "תצוגת שליחה בלבד — לא נוצר או נשלח שמע";
    toast("הדמיה בלבד — לא בוצעה השמעה");
    return;
  }
  if (t.hasAttribute("data-listen")) {
    t.classList.toggle("active");
    t.querySelector("[data-listen-label]").textContent = t.classList.contains(
      "active",
    )
      ? "סגור האזנה"
      : "הפעל האזנה";
    document.querySelector("#audio-status").textContent = t.classList.contains(
      "active",
    )
      ? "האזנה מופעלת בהדמיה · אין זרם שמע אמיתי"
      : "האזנה כבויה · המיקרופון כבוי";
    return;
  }
  if (t.hasAttribute("data-mic")) {
    t.classList.toggle("active");
    t.querySelector("[data-mic-label]").textContent = t.classList.contains(
      "active",
    )
      ? "סגור דיבור"
      : "פתח דיבור";
    toast("מצב חזותי בלבד — לא נפתח מיקרופון");
    return;
  }
  if (t.hasAttribute("data-capture")) {
    document.querySelector("#capture-status").textContent =
      "כרטיס לדוגמה נקרא · מסתיים ב־1048";
    toast("הדמיה — אין קריאה מהציוד");
    return;
  }
  if (t.hasAttribute("data-generate-pin")) {
    document
      .querySelectorAll("input[type=password]")
      .forEach((x) => (x.value = "735918"));
    toast("קוד הדגמה בדוי בלבד");
    return;
  }
  if (t.hasAttribute("data-fullscreen")) {
    document.querySelector(".call-stage")?.requestFullscreen?.();
    return;
  }
  if (t.hasAttribute("data-save")) {
    toast("הדמיה בלבד — השינוי לא נשמר במערכת");
    return;
  }
  if (t.hasAttribute("data-demo")) toast();
});
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-search]") && screen === "people") {
    const q = e.target.value.replace(/[- ]/g, "").toLowerCase();
    let found = 0;
    document.querySelectorAll("[data-person-row]").forEach((r) => {
      const hit = r.dataset.name.replace(/[- ]/g, "").toLowerCase().includes(q);
      r.classList.toggle("hidden", !hit);
      if (hit) found++;
    });
    document.querySelector("#no-results")?.classList.toggle("hidden", !!found);
  }
  if (e.target.matches("[data-all-day]"))
    document
      .querySelector("#time-fields")
      ?.classList.toggle("hidden", e.target.checked);
});
if (!new URLSearchParams(location.search).has("freeze"))
  setInterval(() => {
    const el = document.querySelector("[data-live-clock]");
    if (el)
      el.textContent = new Intl.DateTimeFormat("he-IL", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Jerusalem",
      }).format(new Date());
  }, 1000);
function publicCodeEdit() {
  return (
    head(
      "קוד ציבורי · תא 1",
      "כניסה ראשית · ממסר 1",
      btn("חזרה לקודים", "arrow", "", "codes"),
      "דלתות / קודים ציבוריים",
    ) +
    `<div class="drawer-demo">${panel("החלפת קוד ציבורי", `<div class="pad stack">${notice("הקוד הקיים אינו נקרא מהתחנה. ייתכן שהציוד ידרוש אותו לאישור ההחלפה.", "warning")}<div class="form-grid">${field("קוד קודם — אם נדרש", "", "password")}${field("קוד חדש", "", "password")}${select("דלת יעד", ["דלת ראשית · ממסר 1"])}${field("אימות קוד חדש", "", "password")}</div><p class="sub">לאחר השליחה תתבצע בדיקת תוצאה. לא נציג קוד גלוי ברשימת הקודים או ביומן.</p></div><div class="editor-footer">${btn("ביטול", "", "", "codes")}${btn("עדכן ובדוק תוצאה", "check", "primary", "", "data-save")}</div>`)}</div>`
  );
}
function alwaysTiming() {
  return editor(
    `<div class="two-equal pad"><div class="stack"><h3>מתי מותר להיכנס?</h3><div class="pills"><a href="#person-always" class="active">תמיד</a><a href="#person-timing">ימי שבוע</a><a href="#person-dates">תאריכים מסוימים</a></div>${notice("שמירה תסיר את הגבלת הימים והשעות ותסנכרן את השינוי לתחנות.")}<label class="inline"><input type="checkbox"> הסר גם תאריך תפוגה קיים</label><p class="sub">ללא בחירה זו, תוקף התקופה של האדם נשמר.</p></div><div class="panel pad" style="background:var(--wash)"><div class="feed-icon mb">${icon("clock")}</div><h2>בכל יום, בכל שעה</h2><p class="sub mt">בכפוף לתוקף האדם ולהרשאות הדלתות שלו.</p><div class="mt">${badge("ממתין לשמירה וסנכרון", "warn")}</div></div></div>`,
    "person-timing",
  );
}
function bulk() {
  return (
    head(
      "שינוי ל־12 אנשים",
      "תצוגת השפעה לפני פעולה מרובה",
      btn("חזרה לאנשים", "arrow", "", "people"),
      "אנשים / פעולה מרובה",
    ) +
    `<div class="two-equal">${panel(
      "בחירת השינוי",
      `<div class="pad stack">${select("פעולה", ["הוספה לקבוצה", "הסרה מקבוצה", "הפעלה", "השעיה", "סנכרון"])}${select("קבוצה", ["צוות ניהול", "אחזקה"])}<div class="inline wrap">${names
        .slice(0, 6)
        .map((n) => `<span class="chip">${n}</span>`)
        .join(
          "",
        )}<span class="chip">ועוד 6</span></div>${notice("נבחרו 12 אנשים. חריגים אישיים נשמרים. אין בחירה אוטומטית של כל תוצאות החיפוש.")}</div>`,
    )}${panel("סקירת השפעה", `<div class="pad stack"><div class="inline gap24"><div class="small-stat"><strong>12</strong><small>אנשים ישתנו</small></div><div class="small-stat"><strong>8</strong><small>תחנות יעד</small></div></div>${notice("תחנה אחת מנותקת. הפעולה אליה תישאר ממתינה ושאר התחנות ימשיכו.", "warning")}<p class="sub">אחרי האישור הפעולה תופיע במרכז הפעולות. ניתן לצפות בהתקדמות גם לאחר מעבר למסך אחר.</p>${btn("אישור השינוי", "check", "primary", "", "data-save")}${btn("למרכז הפעולות", "arrow", "ghost", "operations")}</div>`)}</div>`
  );
}
function directory() {
  return (
    head(
      "ספריית הרשאות",
      "בדיקה מרוכזת של הרשאות אפקטיביות ומקורותיהן",
      btn("חזרה לקבוצות", "arrow", "", "groups"),
      "אנשים / ספריית הרשאות",
    ) +
    `<div class="toolbar">${search("חיפוש אדם…")}${btn("כל הקבוצות", "down")}${btn("כל התחנות", "down")}</div>${panel(
      "",
      table(
        ["אדם", "תחנה", "מקור", "חריג אישי", "מצב"],
        names
          .slice(0, 7)
          .map((n, i) => [
            n,
            doors[i],
            i === 3 ? "אישי" : "צוות ניהול",
            i === 3 ? badge("חסימה אישית", "bad") : "ללא",
            i === 3 ? badge("לא מורשה") : badge("מורשה", "good"),
          ]),
      ),
    )}<div class="mt">${notice("הרשאה ניהולית בממשק אינה הרשאת כניסה לאדם. הנתונים במסך מתייחסים לאנשים ולתחנות.")}</div>`
  );
}
SCREENS.push(
  ["code-edit", "עריכת קוד ציבורי", "תחנות"],
  ["person-always", "הסרת הגבלת שעות", "אנשים"],
  ["bulk", "סקירת שינוי מרובה", "אנשים"],
  ["directory", "ספריית הרשאות", "אנשים"],
);
Object.assign(renderers, {
  "code-edit": publicCodeEdit,
  "person-always": alwaysTiming,
  bulk,
  directory,
});

render();
