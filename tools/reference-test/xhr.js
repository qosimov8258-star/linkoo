const { chromium } = require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:process.env.HOME+'/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const c=await b.newContext({storageState:'ref.json'});const p=await c.newPage();
p.on('response',async r=>{if(r.url().includes('/api/')&&r.request().resourceType().match(/xhr|fetch/)){try{const j=await r.json();const rs=j.results||j.data||j;if(Array.isArray(rs)&&rs.length>3){console.log(r.url().slice(0,220));console.log('  ',JSON.stringify(rs.slice(0,4).map(x=>Object.fromEntries(Object.entries(x).slice(0,6)))).slice(0,500))}}catch(e){}}});
await p.goto(process.argv[2]);await p.waitForTimeout(9000);await b.close()})()
