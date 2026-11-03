// node edit1.js <path> <name> : opens the row's edit dialog, renames it to "<name> edited", saves, prints non-GET API calls.
const { chromium } = require('playwright-core');
(async()=>{const [path,name]=process.argv.slice(2);const b=await chromium.launch({executablePath:process.env.HOME+'/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const c=await b.newContext({viewport:{width:1500,height:900},storageState:__dirname+'/local.json'});const p=await c.newPage();
p.on('request',r=>{if(r.method()!=='GET'&&r.url().includes('/api/'))console.log(r.method(),r.url().replace('http://localhost:3000',''),(r.postData()||'').slice(0,200))});
p.on('response',async r=>{if(r.request().method()!=='GET'&&r.url().includes('/api/'))console.log('->',r.status(),(await r.text()).slice(0,200))});
await p.goto('http://localhost:3000'+path);await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
const s=p.locator('main input[placeholder*="Поиск"]').first(); if(await s.count()){await s.fill(name);await p.waitForTimeout(1200);}
const cell=p.getByText(name,{exact:true}).first();await cell.hover();await p.waitForTimeout(400);
const row=cell.locator('xpath=ancestor::*[.//button][1]');await row.locator('button').first().click();await p.waitForTimeout(900);
const dlg=p.locator('[role=dialog], .fixed.inset-0').last();
const inp=dlg.locator('input:visible').filter({hasNot: p.locator('[type=checkbox]')});
const n=await inp.count(); let target=null;
for(let i=0;i<n;i++){ if((await inp.nth(i).inputValue().catch(()=>''))===name){target=inp.nth(i);break;} }
console.log('inputs',n,'found name input',!!target);
if(target){await target.fill(name+' edited');}
await dlg.getByRole('button',{name:/сохран/i}).last().click();await p.waitForTimeout(2000);
await p.screenshot({path:__dirname+'/crud/edit1-'+path.split('/').pop()+'.png'});await b.close()})()
