const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json' });
  const p = await c.newPage();
  await p.goto('http://localhost:3000/', { timeout: 120000 }); await p.waitForTimeout(5000);
  await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
  const vis = () => p.evaluate(() => [...document.querySelectorAll('a[href]')].filter(a => { const r = a.getBoundingClientRect(); return r.height > 0 && r.top > 45 && getComputedStyle(a).visibility !== 'hidden' }).map(a => [a.innerText.trim(), a.getAttribute('href')]));
  const base = new Set((await vis()).map(x => x[1]));
  const out = [];
  for (const m of ['Аналитика','Клиенты','Продажи','Персонал','Склад','Финансы','Производство']) {
    await p.getByText(m, { exact: true }).first().hover(); await p.waitForTimeout(1000);
    for (const [label, href] of await vis()) if (!base.has(href) && label) out.push({ menu: m, label, href });
    await p.mouse.move(750, 880); await p.waitForTimeout(600);
  }
  // settings gear: find button with Settings icon near top
  const gear = p.locator('header svg.lucide-settings').first();
  if (await gear.count()) { await gear.hover(); await p.waitForTimeout(800); await gear.click().catch(()=>{}); await p.waitForTimeout(1000);
    for (const [label, href] of await vis()) if (!base.has(href) && label && !out.find(o => o.href === href)) out.push({ menu: 'SETTINGS', label, href }); }
  require('fs').writeFileSync(__dirname + '/localmenu.json', JSON.stringify(out, null, 1));
  const cnt = {}; out.forEach(o => cnt[o.menu] = (cnt[o.menu] || 0) + 1); console.log(cnt);
  await b.close();
})();
