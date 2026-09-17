import {chromium} from '../../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
await page.goto(new URL('index.html?freeze=1',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
const screens=await page.evaluate(()=>SCREENS);
const results=[];
for(const [device,width,height] of [['desktop',1440,900],['tablet',1024,900],['mobile',390,844]]){
 await page.setViewportSize({width,height});
 for(const theme of ['light','dark']){
  await fs.mkdir(path.join(root,'images',`${device}-${theme}`),{recursive:true});
  for(const [id] of screens){
   await page.goto(new URL(`index.html?freeze=1&theme=${theme}#${id}`,import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
   await page.screenshot({path:path.join(root,'images',`${device}-${theme}`,`${id}.png`),fullPage:device!=='mobile'});
   results.push(await page.evaluate(({id,device,theme,width,height})=>({id,device,theme,rootOverflow:document.documentElement.scrollWidth>width+1,firstRowY:document.querySelector('.people-table tbody tr')?.getBoundingClientRect().top??null,visiblePeople:[...document.querySelectorAll(device==='mobile'?'.mobile-person':'.people-table tbody tr')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.bottom<height-(device==='mobile'?60:0)}).length,visibleDoors:[...document.querySelectorAll('.door-card')].filter(e=>e.getBoundingClientRect().bottom<height-(device==='mobile'?60:0)).length}),{id,device,theme,width,height}));
  }
  console.log(`${device} ${theme}: ${screens.length} exported`);
 }
}
await page.setViewportSize({width:1440,height:900});
await page.goto(new URL('index.html?freeze=1#people',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
await page.locator('tr[data-person-row="1"]').click();
const selectedPerson=(await page.locator('.inspector').innerText()).includes('איתי רז');
await page.locator('[data-search]').fill('0540000003');
const filteredRows=await page.locator('tr[data-person-row]:visible').count();
await page.locator('[data-search]').fill('zzz-no-match');
const emptyVisible=await page.locator('.no-results').isVisible();
await page.goto(new URL('index.html?freeze=1#access',import.meta.url).href);
await page.locator('[data-timing="dates"]').click();const dates=await page.locator('input[type="date"]').count();
await page.locator('[data-timing="always"]').click();const always=(await page.locator('.time-summary').innerText()).includes('בכל יום');
await page.goto(new URL('index.html?freeze=1#door',import.meta.url).href);
await page.locator('[data-door-tab="codes"]').click();const codes=await page.locator('.code-slot').count();
await page.goto(new URL('index.html?freeze=1#whatsapp',import.meta.url).href);
await page.locator('[data-message]').fill('הודעת בדיקה בהדמיה');const messagePreview=(await page.locator('[data-message-preview]').innerText())==='הודעת בדיקה בהדמיה';
await page.getByRole('button',{name:'אישור ושליחה',exact:true}).click();const safeAction=(await page.locator('#toast').innerText()).includes('לא נשלחה');
await page.getByRole('button',{name:'מעבר לעיצוב כהה'}).click();const themeSwitch=await page.locator('html').getAttribute('data-theme')==='dark';
const checks={selectedPerson,filteredRows,emptyVisible,dates,always,codes,messagePreview,safeAction,themeSwitch};
const report={generatedAt:new Date().toISOString(),screens:screens.length,images:screens.length*6,errors,checks,results};
await fs.writeFile(path.join(root,'VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({errors,checks,overflow:results.filter(r=>r.rootOverflow),density:results.filter(r=>['overview','people'].includes(r.id))},null,2));
await browser.close();
if(errors.length||results.some(r=>r.rootOverflow)||!selectedPerson||filteredRows!==1||!emptyVisible||dates!==2||!always||codes!==4||!messagePreview||!safeAction||!themeSwitch)process.exitCode=1;
