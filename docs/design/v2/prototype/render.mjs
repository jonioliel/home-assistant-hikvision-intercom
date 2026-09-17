import {chromium} from '../../../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
await page.goto(new URL('app.html?freeze=1',import.meta.url).href);
const screens=await page.evaluate(()=>SCREENS);
const errors=[]; const results=[];
page.on('pageerror',e=>errors.push(String(e)));
for(const [name,width,height] of [['desktop',1440,960],['tablet',1024,900],['mobile',390,844]]){
 await fs.mkdir(path.join(root,'../images',name),{recursive:true});
 await page.setViewportSize({width,height});
 for(const screen of screens){
  await page.goto(new URL(`app.html?freeze=1#${screen.id}`,import.meta.url).href);
  await page.waitForFunction(()=>document.querySelector('main')?.innerText.length>50);
  await page.screenshot({path:path.join(root,'../images',name,`${screen.id}.png`),fullPage:name!=='mobile'});
  results.push(await page.evaluate(({name,screen,width})=>({screen:screen.id,viewport:name,rootOverflow:document.documentElement.scrollWidth>width+1,content:document.querySelector('main')?.innerText.length,missingView:!VIEWS[screen.id],scrollHeight:document.documentElement.scrollHeight,modalScroll:[...document.querySelectorAll('.modal,.drawer')].some(e=>e.scrollHeight>e.clientHeight+1)}),{name,screen,width}));
 }
 console.log(`${name}: ${screens.length} rendered`);
}
await fs.mkdir(path.join(root,'../images/variants'),{recursive:true});
await page.setViewportSize({width:1440,height:960});
for(const id of ['overview','people','door-detail','call','person-timing']){
 await page.goto(new URL(`app.html?freeze=1&theme=dark#${id}`,import.meta.url).href);
 await page.screenshot({path:path.join(root,'../images/variants',`${id}-dark.png`),fullPage:true});
}
await page.goto(new URL('app.html?freeze=1&lang=en#overview',import.meta.url).href);
await page.screenshot({path:path.join(root,'../images/variants/overview-en.png'),fullPage:true});
// Verify representative interactions without a production server.
await page.goto(new URL('app.html?freeze=1#people',import.meta.url).href);
await page.getByRole('button',{name:/מסננים/}).click();
const filters=await page.locator('.filter-panel').isVisible();
await page.locator('[data-search]').fill('נועה');
const filteredRows=await page.locator('tr[data-person]:visible').count();
await page.locator('.name-link').first().count();
await page.locator('.person-cell [data-go="person-details"]').first().click();
const drawer=await page.locator('.drawer').isVisible();
await page.keyboard.press('Escape');
const closed=await page.locator('.drawer').count()===0;
await page.goto(new URL('app.html?freeze=1#overview',import.meta.url).href);
await page.locator('[data-demo="פתיחת דלת"]').first().click();
const simulated=await page.locator('#toast').innerText();
const report={generatedAt:new Date().toISOString(),screenCount:screens.length,imageCount:screens.length*3+6,errors,checks:{filters,filteredRows,drawer,closed,simulated:simulated.includes('לא נשלחה')},results};
await fs.writeFile(path.join(root,'../VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({screens:screens.length,images:report.imageCount,errors,overflow:results.filter(r=>r.rootOverflow),checks:report.checks},null,2));
await browser.close();
if(errors.length||results.some(r=>r.rootOverflow||r.missingView)||!filters||filteredRows!==1||!drawer||!closed||!report.checks.simulated)process.exitCode=1;
