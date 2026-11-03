const { chromium } = require('playwright-core');
const cfg = JSON.parse(process.argv[2]); // [[path, [dropdown labels]]]
(async()=>{const b=await chromium.launch({executablePath:process.env.HOME+'/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'});const c=await b.newContext({viewport:{width:1500,height:900},storageState:'local.json'});
for (const [path, drops] of cfg) { const p=await c.newPage(); const api=[];
p.on('response',async r=>{if(r.request().method()!=='GET'&&r.url().includes('/api/'))api.push(r.request().method()+' '+r.status()+' '+r.url().replace('http://localhost:3000','')+' '+(r.status()>=400?(await r.text()).slice(0,120):''))});
const name='QA test '+Date.now().toString().slice(-6);
await p.goto('http://localhost:3000'+path);await p.waitForTimeout(3000);
await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
await p.locator('main').getByText(/добав/i).first().click();await p.waitForTimeout(900);
const dlg=p.locator('[role=dialog], .fixed.inset-0').last();
const inputs=dlg.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible');const n=await inputs.count();
for(let i=0;i<n;i++){const el=inputs.nth(i); if(await el.isEditable().catch(()=>false)) await el.fill(i===0?name:'QA').catch(()=>{});}
for(const d of drops){ {const lab=dlg.locator('span.pointer-events-none', {hasText: new RegExp('^'+d)}).first(); await lab.locator('xpath=..').locator('button').first().click({timeout:3000}).catch(async e=>{const l=dlg.getByText(new RegExp('^'+d)).first();const bb=await l.boundingBox();if(bb){await p.mouse.click(bb.x+150,bb.y+bb.height/2)}else console.log('no dd',d)});} await p.waitForTimeout(600);
  const opt=p.locator('.max-h-64 button:visible, button.block.w-full:visible').filter({hasNotText:/^[-.\s]*$/}).nth(1); if(await opt.count()) await opt.click({timeout:3000}).catch(()=>console.log('opt click fail',d)); else console.log('no option',d); await p.waitForTimeout(400); }
await p.screenshot({path:'crud/c2-'+path.split('/').pop()+'.png'});
await dlg.getByRole('button',{name:/сохран/i}).last().click({timeout:5000}).catch(e=>console.log('save blocked'));await p.waitForTimeout(1800);
console.log(path, name, JSON.stringify(api)); await p.close();}
await b.close()})()
