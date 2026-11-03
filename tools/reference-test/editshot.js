const { chromium } = require('playwright-core');
(async()=>{const b=await chromium.launch({executablePath:process.env.HOME+'/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const c=await b.newContext({viewport:{width:1500,height:900},storageState:'local.json'});
for (const [path,name] of JSON.parse(process.argv[2])) { const p=await c.newPage();
await p.goto('http://localhost:3000'+path);await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
const s=p.locator('main input[placeholder*="Поиск"]').first(); if(await s.count()){await s.fill(name);await p.waitForTimeout(1200);}
const cell=p.getByText(name,{exact:true}).first();await cell.hover();await p.waitForTimeout(400);
const row=cell.locator('xpath=ancestor::*[.//button][1]');const n=await row.locator('button').count();
const html=await row.evaluate(e=>[...e.querySelectorAll('button')].map(b=>(b.title||b.getAttribute('aria-label')||b.innerText||b.innerHTML.slice(0,60))).join(' || '));
console.log(path,n,html);
await row.locator('button').first().click();await p.waitForTimeout(500); if(n===1){await p.getByText(/^(Изменить|Редактировать)$/).first().click();} await p.waitForTimeout(900);await p.screenshot({path:'crud/edit-'+path.split('/').pop()+'.png'}); await p.close();}
await b.close()})()
