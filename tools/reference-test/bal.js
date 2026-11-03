const { chromium } = require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:process.env.HOME+'/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const c=await b.newContext({viewport:{width:1500,height:900},storageState:'local.json'});
const out={};
for (const u of process.argv.slice(2)){const p=await c.newPage();await p.goto('http://localhost:3000'+u);await p.waitForTimeout(6000);
 out[u]=(await p.evaluate(()=>document.querySelector('main').innerText)).slice(0,700).replace(/\n+/g,' | ');await p.close();}
console.log(JSON.stringify(out,null,1));await b.close()})()
