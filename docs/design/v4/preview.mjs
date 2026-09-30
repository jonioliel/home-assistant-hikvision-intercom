import {chromium} from '../../../frontend/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const p=await b.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
const errors=[];p.on('pageerror',e=>errors.push(String(e)));
for(const [id,theme,w,h] of [['overview','light',1440,900],['people','light',1440,900],['person','light',1440,900],['call','light',1440,900],['overview-12','dark',1440,900],['call','light',390,844],['person','dark',390,844]]){await p.setViewportSize({width:w,height:h});await p.goto(new URL(`index.html?theme=${theme}&freeze=1#${id}`,import.meta.url).href);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:path.join(root,'qa',`${id}-${theme}-${w}.png`),fullPage:true});console.log(JSON.stringify(await p.evaluate(({id,w,h})=>({id,w,h,overflow:document.documentElement.scrollWidth>w,height:document.documentElement.scrollHeight,title:document.querySelector('h1')?.textContent,grants:[...document.querySelectorAll('.grant')].map(e=>e.getBoundingClientRect().bottom),tts:document.querySelector('.tts')?.getBoundingClientRect().bottom}),{id,w,h})));}
console.log(JSON.stringify({errors}));await b.close();
