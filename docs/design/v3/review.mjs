import {chromium} from '../../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(String(e)));
const open=async(id,theme='light')=>{await page.goto(new URL(`index.html?freeze=1&theme=${theme}#${id}`,import.meta.url).href);await page.evaluate(()=>document.fonts.ready);};
await open('overview');await page.locator('[data-door="2"] [data-go="call"]').first().click();
const correctDoor=(await page.locator('.call-label').innerText()).includes('כניסת עובדים');
await open('overview');await page.locator('[data-select-door="7"]').click();
const offlineDisabled=await page.getByRole('button',{name:'פתיחת דלת',exact:true}).isDisabled();
const offlineCopy=(await page.locator('.detail-workspace').innerText()).includes('התחנה מנותקת');
await open('people');await page.locator('tr[data-person-row="3"]').click();
const singleDoor=await page.locator('.inspector .mini-door').count()===1;
await page.getByRole('button',{name:'שליחת פרטי גישה',exact:true}).click();
const scopedMessage=(await page.locator('[data-message-preview]').innerText()).includes('1. כניסה ראשית')&&!(await page.locator('[data-message-preview]').innerText()).includes('2. אגף מזרח');
await open('access');await page.locator('[data-allday]').click();
const allDay=await page.locator('[data-time]').count()===0&&(await page.locator('.time-summary').innerText()).includes('כל היום');
await page.setViewportSize({width:390,height:844});await open('access','dark');
const mobileSave=await page.getByRole('button',{name:'שמירה וסנכרון',exact:true}).evaluate(e=>{const r=e.getBoundingClientRect();return r.top>0&&r.bottom<=innerHeight-60;});
await open('people','dark');await page.locator('.mobile-person[data-person-row="2"]').click();
const mobilePerson=(await page.locator('.inspector').innerText()).includes('מיה הדר');
await page.locator('[data-close-inspector]').click();const closeMobile=await page.locator('.inspector').count()===0;
const overflow=[];
for(const [width,height] of [[1280,720],[768,1024],[360,800]]){
 await page.setViewportSize({width,height});for(const id of ['overview','people','access','door','call','appearance']){await open(id);const found=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1);if(found)overflow.push({id,width,height});}
}
await page.setViewportSize({width:1440,height:900});await page.goto(new URL('gallery.html',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
const galleryScreens=await page.locator('.screen-card').count();
await page.selectOption('#theme','dark');await page.selectOption('#device','mobile');
const gallerySwitch=(await page.locator('.screen-card img').first().getAttribute('src'))==='images/mobile-dark/overview.png';
await page.setViewportSize({width:1800,height:1200});await page.goto(new URL('comparison.html',import.meta.url).href);await page.evaluate(()=>document.fonts.ready);
await page.screenshot({path:path.join(root,'images/comparison.png'),fullPage:true});
const checks={correctDoor,offlineDisabled,offlineCopy,singleDoor,scopedMessage,allDay,mobileSave,mobilePerson,closeMobile,galleryScreens,gallerySwitch};
await fs.writeFile(path.join(root,'REVIEW_VALIDATION.json'),JSON.stringify({generatedAt:new Date().toISOString(),errors,overflow,checks},null,2)+'\n');
console.log(JSON.stringify({errors,overflow,checks},null,2));await browser.close();
if(errors.length||overflow.length||galleryScreens!==12||Object.entries(checks).some(([k,v])=>k!=='galleryScreens'&&!v))process.exitCode=1;
