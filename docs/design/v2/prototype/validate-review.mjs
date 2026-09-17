import {chromium} from '../../../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:960},deviceScaleFactor:1});
const errors=[];page.on('pageerror',error=>errors.push(String(error)));
await page.goto(new URL('app.html?freeze=1',import.meta.url).href);
const screens=await page.evaluate(()=>SCREENS);
const invalidTargets=[];
for(const {id} of screens){
 await page.goto(new URL(`app.html?freeze=1#${id}`,import.meta.url).href);
 invalidTargets.push(...await page.evaluate(()=>[...document.querySelectorAll('[data-go]')].filter(e=>!VIEWS[e.dataset.go]).map(e=>({screen:location.hash,target:e.dataset.go}))));
}
const extraViewports=[];
for(const [width,height] of [[1920,1080],[1440,900],[1024,768],[768,1024],[360,800]]){
 await page.setViewportSize({width,height});
 for(const id of ['overview','people','person-access','person-timing','door-detail','door-programs','call','sync']){
  await page.goto(new URL(`app.html?freeze=1#${id}`,import.meta.url).href);
  extraViewports.push(await page.evaluate(({id,width,height})=>({id,width,height,rootOverflow:document.documentElement.scrollWidth>width+1}),{id,width,height}));
 }
}
await page.setViewportSize({width:1440,height:960});
await page.goto(new URL('index.html',import.meta.url).href);
await page.waitForTimeout(200);
const gallery=await page.evaluate(()=>({options:document.querySelector('#screenChoice').options.length,rootOverflow:document.documentElement.scrollWidth>innerWidth,frameFits:document.querySelector('iframe').getBoundingClientRect().width<=document.querySelector('.frame-wrap').clientWidth}));
await page.getByRole('button',{name:'נייד',exact:true}).click();
await page.waitForTimeout(150);
gallery.mobileFrameWidth=await page.frames()[1].evaluate(()=>innerWidth);
await page.goto(new URL('app.html?freeze=1#call',import.meta.url).href);
await page.screenshot({path:path.join(process.env.TEMP,'wiskey-call-review.jpg'),type:'jpeg',quality:65,fullPage:true});
await page.setViewportSize({width:1600,height:1200});
await page.goto(new URL('review-board.html',import.meta.url).href);
await page.screenshot({path:path.join(root,'../images/design-board.png'),fullPage:true});
const report={generatedAt:new Date().toISOString(),invalidTargets,errors,extraViewports,gallery};
await fs.writeFile(path.join(root,'../REVIEW_VALIDATION.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,extraViewports:extraViewports.filter(v=>v.rootOverflow)},null,2));
await browser.close();
if(errors.length||invalidTargets.length||extraViewports.some(v=>v.rootOverflow)||gallery.options!==51||gallery.rootOverflow||!gallery.frameFits||gallery.mobileFrameWidth!==390)process.exitCode=1;
