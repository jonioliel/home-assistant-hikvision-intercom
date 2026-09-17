// Design-only helpers. No HA client, storage, device or network mutations.
window.VIEWS = {};
window.DEMO = {
 doors:['כניסה ראשית','אגף מזרח','כניסת עובדים','חצר','אולם מרכזי','מחסן','חניה','אגף מערב'],
 people:[
  ['נועה לוי','נל','1001','050-000-0001','הנהלה','מנהלת','הנהלה','קוד + כרטיס','8 דלתות','ללא הגבלה','מסונכרן'],
  ['איתי רז','אר','1002','052-000-0002','אחזקה','אחראי צוות','אחזקה','כרטיס','6 דלתות','א׳–ה׳ · 08:00–17:00','מסונכרן'],
  ['מיה הדר','מה','1003','054-000-0003','הדרכה','מדריכה','צוות הדרכה','קוד','4 דלתות','ב׳, ה׳ · 12:00–18:00','ממתין בתחנה אחת'],
  ['אדם שחר','אש','1004','053-000-0004','קבלנים','טכנאי','ספקים','כרטיס','דלת אחת','24.09 · 09:00–13:00','מסונכרן'],
  ['יעל ברק','יב','1005','058-000-0005','הנהלה','רכזת','הנהלה','קוד + כרטיס','8 דלתות','ללא הגבלה','מסונכרן'],
  ['רון שלו','רש','1006','050-000-0006','אחזקה','עובד','אחזקה','קוד','6 דלתות','א׳–ה׳ · כל היום','נדרש טיפול']
 ]
};
const iconPaths={
 phone:'M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4c0 2-2 3-4 2C9 19 5 15 3 7c-1-2 0-4 2-4Z',
 hangup:'M3 15v-4c5-5 13-5 18 0v4h-5v-3a13 13 0 0 0-8 0v3Z',
 microphone:'M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0ZM5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8',
 speaker:'M3 9h4l5-5v16l-5-5H3ZM16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14',
 fullscreen:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
 settings:'M4 7h16M4 17h16M9 4v6m6 4v6',
 tools:'M14 6l4-3 3 3-3 4-4 1-8 10-3-3 10-8ZM5 3l4 4M3 5l4 4',
 appearance:'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.4-3.4 1 1 0 0 1 .7-1.7H17a4 4 0 0 0 4-4A9 9 0 0 0 12 3ZM7 10h.01M10 6h.01M15 6h.01M18 10h.01',
 overview:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
 users:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
 devices:'M6 3h12v18H6ZM9 7h6M9 11h6M11 17h2',
 events:'M5 3h14v18H5ZM8 7h8M8 11h5M8 15h7',
 sync:'M20 7a8 8 0 0 0-14-2L3 8m0-5v5h5M4 17a8 8 0 0 0 14 2l3-3m0 5v-5h-5',
 clock:'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
 health:'M2 12h5l3-8 4 16 3-8h5',
 calendar:'M4 5h16v16H4ZM4 10h16M8 3v4m8-4v4',
 lock:'M6 10h12v11H6ZM8 10V7a4 4 0 0 1 8 0M12 14v3',
 camera:'M3 6h12v12H3ZM15 10l6-4v12l-6-4',
 menu:'M4 6h16M4 12h16M4 18h16',
 arrow:'M7 17 17 7M7 7h10v10',
 search:'M16 16l5 5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z',
 check:'M5 12l4 4L19 6',plus:'M12 5v14M5 12h14',close:'M6 6l12 12M18 6 6 18',chevron:'M9 5l7 7-7 7',more:'M5 12h.01M12 12h.01M19 12h.01',
 key:'M14 8a5 5 0 1 0-3 4l7 7h3v-3l-7-7Z',shield:'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z',alert:'M12 3l10 18H2ZM12 9v5M12 17h.01',
 door:'M4 21V3h16v18M8 21V6l9-2v17M12 12h.01M2 21h20',card:'M3 5h18v14H3ZM3 9h18M6 15h4',edit:'M4 16 16 4l4 4L8 20H4ZM14 6l4 4',
 chat:'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM7 10h10M7 14h6',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
 trash:'M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M9 10v7M15 10v7',image:'M3 3h18v18H3ZM3 17l6-6 4 4 3-3 5 5M16 7h.01',mail:'M3 5h18v14H3ZM3 5l9 7 9-7'
};
Object.assign(iconPaths,{mic:iconPaths.microphone,volume:iconPaths.speaker,'phone-off':iconPaths.hangup,refresh:iconPaths.sync,server:iconPaths.devices,wifi:iconPaths.health,bell:iconPaths.phone,filter:iconPaths.settings,whatsapp:iconPaths.chat,groups:iconPaths.users,audit:iconPaths.events});
Object.assign(iconPaths,{activity:iconPaths.health,message:iconPaths.chat,document:iconPaths.events,palette:iconPaths.appearance,upload:iconPaths.download});
window.H={
 icon:n=>`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${iconPaths[n]||iconPaths.devices}"></path></svg>`,
 btn:(label,target='',kind='',ic='')=> target?`<a class="btn ${kind}" href="#${target}" data-go="${target}">${ic?H.icon(ic):''}${label}</a>`:`<button class="btn ${kind}" data-demo="${label}">${ic?H.icon(ic):''}${label}</button>`,
 badge:(s,k='good')=>`<span class="pill ${k}"><span class="dot"></span>${s}</span>`,
 head:(title,sub='',actions='')=>`<div class="page-head"><div><h1>${title}</h1>${sub?`<p>${sub}</p>`:''}</div><div class="actions">${actions}</div></div>`,
 tabs:(items,active)=>`<nav class="tabs">${items.map(([id,label])=>`<a href="#${id}" data-go="${id}" class="${active===id?'active':''}">${label}</a>`).join('')}</nav>`,
 card:(title,body,action='')=>`<section class="card"><div class="card-head"><h2>${title}</h2>${action}</div><div class="pad">${body}</div></section>`,
 field:(label,value='',o={})=>`<label class="field ${o.full?'full':''}">${label}${o.type==='textarea'?`<textarea ${o.dir?`dir="${o.dir}"`:''}>${value}</textarea>`:`<input value="${String(value).replaceAll('"','&quot;')}" type="${o.type||'text'}" ${o.dir?`dir="${o.dir}"`:''}>`}${o.hint?`<small>${o.hint}</small>`:''}</label>`,
 select:(label,options,index=0)=>`<label class="field">${label}<select>${options.map((x,i)=>`<option ${i===index?'selected':''}>${x}</option>`).join('')}</select></label>`,
 note:(t,k='')=>`<div class="notice ${k}">${H.icon(k==='warn'||k==='bad'?'alert':k==='good'?'check':'shield')}<div>${t}</div></div>`,
 table:(heads,rows,c='')=>`<div class="table-wrap"><table class="${c}"><thead><tr>${heads.map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(x=>`<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
 person:(name,initials,sub='')=>`<div class="person"><span class="avatar ${initials==='אר'?'b':initials==='מה'?'c':''}">${initials==="נל"?'<img src="../assets/person-demo.png" alt="">':initials}</span><div><strong>${name}</strong>${sub?`<span class="sub">${sub}</span>`:''}</div></div>`,
 camera:(label='כניסה ראשית')=>`<div class="mini-camera"><div class="overlay"></div><span class="pill live">${H.icon('camera')} המחשת מצלמה</span><span class="camera-label">${label}</span><a data-go="call" href="#call" class="btn square view-control" aria-label="פתיחת מצלמה">${H.icon('fullscreen')}</a></div>`,
 summary:()=>`<div class="summary-strip"><span><strong>7 / 8</strong>תחנות מחוברות</span><i class="divider"></i><span><strong>6</strong>אנשים</span><i class="divider"></i><span><strong>2</strong>לטיפול</span><span class="spacer"></span><span class="time-now">יום חמישי, 17 בספטמבר 2026 · <b class="num">10:42:08</b></span></div>`,
 footer:(p='שמירה',target='',s='ביטול')=>`<div class="form-footer"><small>השינויים נשמרים רק לאחר אישור.</small>${H.btn(s,target,'')}${H.btn(p,'','primary','check')}</div>`,
 crumb:items=>`<div class="breadcrumb">${items.map((s,i)=>i?`<span>‹</span><span>${s}</span>`:`<a data-go="${({אנשים:'people',דלתות:'doors',פעילות:'activity'})[s]||'management'}" href="#${({אנשים:'people',דלתות:'doors',פעילות:'activity'})[s]||'management'}">${s}</a>`).join('')}</div>`,
 check:(label,checked=true)=>`<label class="check-item ${checked?'active':''}"><input class="checkbox" type="checkbox" ${checked?'checked':''}>${label}</label>`,
 escape:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
};


H.timeText = value => String(value).replace(/\d{2}:\d{2}[–-]\d{2}:\d{2}/g, value=>`<bdi>${value}</bdi>`);
Object.assign(iconPaths,{copy:'M8 8h12v13H8ZM4 16H2V2h13v3',pause:'M7 4v16M17 4v16'});
