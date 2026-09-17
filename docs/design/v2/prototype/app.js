// Standalone, local design prototype; deliberately disconnected from Home Assistant.
const params=new URLSearchParams(location.search);
let screen=location.hash.slice(1)||params.get('screen')||'overview';
let theme=params.get('theme')||'light';
const navItems=[['overview','סקירה','overview'],['people','אנשים','users'],['doors','דלתות','door'],['activity','פעילות','events'],['management','ניהול','settings']];
function sectionFor(id){
 const entry=SCREENS.find(s=>s.id===id);
 if(id==='overview'||id==='restricted')return 'overview';
 if(entry?.group==='אנשים והרשאות')return 'people';
 if(entry?.group==='בקרת כניסה')return 'doors';
 if(entry?.group==='פעילות')return 'activity';
 return 'management';
}
function render(){
 if(!VIEWS[screen])screen='overview';
 document.documentElement.dataset.theme=theme;
 const current=SCREENS.find(s=>s.id===screen);
 document.title=`WisKey · ${current?.title||screen} · הדמיה`;
 const active=sectionFor(screen);
 const restricted=screen==='restricted';
 const nav=navItems.filter(([id])=>!restricted||['overview','activity'].includes(id));
 document.querySelector('#app').innerHTML=`<header class="topbar"><a class="brand" href="#overview" data-go="overview"><span class="brand-mark">${H.icon('key')}</span><span><span class="brand-word" dir="ltr">WisKey</span><small>ACCESS MANAGEMENT</small></span></a><nav class="primary-nav" aria-label="ניווט ראשי">${nav.map(([id,label,ic])=>`<a data-go="${id}" href="#${id}" class="${active===id?'active':''}">${H.icon(ic)}${label}</a>`).join('')}</nav><div class="account"><span class="account-copy">מרכז קהילתי לדוגמה<small>${restricted?'צפייה בלבד':'מנהל מערכת'}</small></span><span class="round">${restricted?'צל':'מד'}</span></div></header><main class="workspace ${screen==='call'?'call-workspace':''} ${screen==='camera-wall'?'camera-wall-workspace':''}">${VIEWS[screen]()}<footer class="footer-label"><span>WisKey Access · הצעת עיצוב לאישור · נתונים להמחשה בלבד</span><span>V2 / ${String(current?.index||1).padStart(2,'0')}</span></footer></main><nav class="mobile-nav" aria-label="ניווט ראשי בנייד">${nav.map(([id,label,ic])=>`<a href="#${id}" data-go="${id}" class="${active===id?'active':''}">${H.icon(ic)}${label}</a>`).join('')}</nav>`;
 document.querySelectorAll('table').forEach(table=>{const labels=[...table.querySelectorAll('thead th')].map(th=>th.textContent.trim());table.querySelectorAll('tbody tr').forEach(row=>[...row.children].forEach((td,i)=>td.dataset.label=labels[i]||''));});
 document.querySelectorAll('input:not([aria-label])').forEach(input=>{if(!input.closest('label'))input.setAttribute('aria-label',input.placeholder||'שדה בהדמיה');});
 document.querySelectorAll('select:not([aria-label])').forEach(select=>{if(!select.closest('label'))select.setAttribute('aria-label','בחירה בהדמיה');});
 const textWalker=document.createTreeWalker(document.querySelector('main'),NodeFilter.SHOW_TEXT);const timeNodes=[];while(textWalker.nextNode()){const node=textWalker.currentNode;if(!node.parentElement.closest('bdi,input,textarea,script,style')&&/\d{2}:\d{2}[–-]\d{2}:\d{2}/.test(node.textContent))timeNodes.push(node);}for(const node of timeNodes){const fragment=document.createDocumentFragment();for(const part of node.textContent.split(/(\d{2}:\d{2}[–-]\d{2}:\d{2})/)){if(/^\d{2}:\d{2}[–-]\d{2}:\d{2}$/.test(part)){const bdi=document.createElement('bdi');bdi.dir='ltr';bdi.textContent=part;fragment.append(bdi);}else fragment.append(document.createTextNode(part));}node.replaceWith(fragment);}
 if(params.get('lang')==='en')applyEnglish();
 window.scrollTo(0,0);
 parent.postMessage({wiskeyDesign:true,screen,title:current?.title},'*');
}
function go(id){screen=id;history.replaceState(null,'',`${location.pathname}${location.search}#${id}`);render();}
function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.classList.add('show');clearTimeout(window.toastTimer);window.toastTimer=setTimeout(()=>t.classList.remove('show'),3300);}
document.addEventListener('click',event=>{
 const el=event.target.closest('[data-go],[data-demo],[data-filter],[data-day]');
 if(!el)return;
 event.preventDefault();
 if(el.dataset.go){go(el.dataset.go);return;}
 if(el.hasAttribute('data-filter')){document.querySelector('.filter-panel')?.classList.toggle('open');return;}
 if(el.hasAttribute('data-day')){el.classList.toggle('on');return;}
 if(el.dataset.demo)toast(`הדמיה בלבד · ${el.dataset.demo} · לא נשלחה פעולה למערכת.`);
});
document.addEventListener('input',event=>{if(event.target.matches('[data-search]')){const val=event.target.value.trim();document.querySelectorAll('[data-person]').forEach(row=>row.hidden=!row.dataset.person.includes(val));}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('[role=dialog]'))go('people');});
window.addEventListener('hashchange',()=>{screen=location.hash.slice(1);render();});
window.addEventListener('message',event=>{if(event.data?.designControl){if(event.data.theme)theme=event.data.theme;if(event.data.screen)screen=event.data.screen;render();}});
function applyEnglish(){
 document.documentElement.dir='ltr';document.documentElement.lang='en';
 const dict={'אגף מזרח · היום 12:00–14:00 · מנוהלת דרך HA':'East wing · Today 12:00–14:00 · Managed through HA','יום חמישי, 17 בספטמבר 2026 · ':'Thursday, September 17, 2026 · ','סקירה':'Overview','אנשים':'People','דלתות':'Doors','פעילות':'Activity','ניהול':'Management','מרכז קהילתי לדוגמה':'Demo community center','מנהל מערכת':'Administrator','בקרת כניסה':'Access control','הוספת אדם':'Add person','תצוגת מצלמות':'Camera view','תחנות מחוברות':'stations online','לטיפול':'need attention','נושאים דורשים תשומת לב':'items need attention','הדלתות שלך':'Your doors','כל הדלתות':'All doors','מחובר':'Online','שיחה נכנסת':'Incoming call','פתיחת דלת':'Unlock','פתיחת שיחה':'Open call','מצלמה':'Camera','כניסה ראשית':'Main entrance','אגף מזרח':'East wing','כניסת עובדים':'Staff entrance','חצר':'Courtyard','אולם מרכזי':'Main hall','מחסן':'Storage','חניה':'Parking','אגף מערב':'West wing','ממסר 1 · מצב פיזי לא מדווח':'Relay 1 · physical state unavailable','תוכנית פתיחה · HA':'Opening program · HA','מצלצל עכשיו':'Ringing now','פעילות אחרונה':'Recent activity','לכל הפעילות':'All activity','קוד אישי':'Personal PIN','כרטיס':'Card','גישה אושרה':'Access granted','תוכנית הפתיחה הבאה':'Next opening program','ניהול תוכניות':'Manage programs','מפת הרשאות':'Permission directory','הרשאות במקום אחד':'Access in one place','אגף מערב אינו זמין':'West wing unavailable','השינויים יישלחו כשיחזור הקשר':'Changes will sync when connected','נועה לוי':'Noa Levi','איתי רז':'Itai Raz','מיה הדר':'Maya Hadar','אדם שחר':'Adam Shahar','קבוצות':'Groups','דלתות מנוהלות':'managed doors','לבדיקה':'Review','תחנה אחת אינה זמינה · הרשאה אחת דורשת טיפול':'One station offline · one access assignment needs attention','למי יש גישה, מאיזו קבוצה ומהן ההחרגות האישיות.':'See who has access, inherited groups and personal overrides.','WisKey Access · הצעת עיצוב לאישור · נתונים להמחשה בלבד':'WisKey Access · Design proposal · Synthetic demo data only'};
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const node of nodes){let s=node.textContent;for(const [he,en] of Object.entries(dict).sort((a,b)=>b[0].length-a[0].length))s=s.replaceAll(he,en);node.textContent=s;}
}
render();
if(!params.has('freeze'))setInterval(()=>{document.querySelectorAll('.time-now b').forEach(el=>el.textContent=new Date().toLocaleTimeString('he-IL',{hour12:false,timeZone:'Asia/Jerusalem'}));},1000);
