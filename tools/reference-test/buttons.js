const { chromium } = require('playwright-core');
const fs = require('fs');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const routes = fs.readFileSync(__dirname + '/routes.txt', 'utf8').split('\n').filter(Boolean);
const BAD = /удал|сохран|отправ|подтвер|выйти|выход|перерасч|сверить|принять|закрыть|очист|сброс|импорт|загруз|архив|отмен|оплат|провест|создать|да$|ok$|начать|завершить|копир|блок|актив/i;
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json', acceptDownloads: false });
  let total = 0;
  for (const r of routes) {
    const p = await c.newPage();
    const errs = [];
    p.on('pageerror', e => errs.push('PAGEERR ' + String(e.message).slice(0, 160)));
    p.on('response', resp => { if (resp.status() >= 500) errs.push(resp.status() + ' ' + resp.url().replace('http://localhost:3000', '').slice(0, 120)) });
    p.on('dialog', d => d.dismiss().catch(() => {}));
    try {
      await p.goto('http://localhost:3000' + r, { timeout: 60000 }); await p.waitForTimeout(2500);
      await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
      const n = await p.locator('main button:visible').count();
      for (let i = 0; i < Math.min(n, 25); i++) {
        const btn = p.locator('main button:visible').nth(i);
        const t = ((await btn.innerText({ timeout: 1000 }).catch(() => '')) || '').trim();
        if (!t || BAD.test(t) || t.length > 30) continue;
        const before = p.url();
        await btn.click({ timeout: 2000 }).catch(() => {});
        total++;
        await p.waitForTimeout(700);
        await p.keyboard.press('Escape'); await p.waitForTimeout(200);
        if (p.url().split('?')[0] !== before.split('?')[0]) { await p.goto(before).catch(() => {}); await p.waitForTimeout(1500); }
        if (errs.length && !errs.at(-1).startsWith('@')) errs.push('@ after "' + t + '"');
      }
    } catch (e) { errs.push('ERR ' + e.message.slice(0, 100)) }
    if (errs.length) console.log(r, JSON.stringify([...new Set(errs)].slice(0, 8)));
    await p.close();
  }
  console.log('done clicks', total);
  await b.close();
})();
