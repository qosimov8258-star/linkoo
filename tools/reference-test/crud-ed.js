const { chromium } = require('playwright-core');
const fs = require('fs');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const pages = process.argv.slice(2);
const clean = p => p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json' });
  for (const spec of pages) { const [path, given] = spec.split('|');
    const p = await c.newPage();
    const log = []; const errs = [];
    p.on('pageerror', e => errs.push(e.message.slice(0, 150)));
    p.on('response', r => { if (r.url().includes('/api/') && r.request().method() !== 'GET') log.push(r.request().method() + ' ' + r.status() + ' ' + r.url().replace('http://localhost:3000', '').slice(0, 80)) });
    p.on('dialog', d => d.accept());
    const name = given || ('QA test ' + Date.now().toString().slice(-6));
    const tag = path.split('/').pop();
    const res = { path, name };
    try {
      await p.goto('http://localhost:3000' + path); await p.waitForTimeout(3000); await clean(p);
      await p.goto('http://localhost:3000' + path); await p.waitForTimeout(3000); await clean(p);
      const search = p.locator('main input[placeholder*="Поиск"]').first();
      if (await search.count()) { await search.fill(name); await p.waitForTimeout(1200); }
      res.created = await p.getByText(name, { exact: true }).count() > 0;
      // EDIT
      const cell = p.getByText(name, { exact: true }).first();
      await cell.hover(); await p.waitForTimeout(400);
      const row = cell.locator('xpath=ancestor::*[.//button][1]');
      res.rowButtons = await row.locator('button').count();
      await row.locator('button').first().click();
      // Single kebab button: the row actions are in its menu.
      if (res.rowButtons === 1) { await p.waitForTimeout(400); await p.getByText(/^(Изменить|Редактировать)$/).first().click(); }
      await p.waitForTimeout(900);
      const dlg2 = p.locator('[role=dialog], .fixed.inset-0').last();
      const inp2 = dlg2.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible').first();
      await inp2.fill(name + ' edited');
      await dlg2.getByRole('button', { name: /сохран|изменить|обновить/i }).last().click(); await p.waitForTimeout(1500);
      await p.goto('http://localhost:3000' + path); await p.waitForTimeout(2500); await clean(p);
      if (await search.count()) { await search.fill(name); await p.waitForTimeout(1200); }
      res.edited = await p.getByText(name + ' edited', { exact: true }).count() > 0;
      // DELETE
      const cell2 = p.getByText(name + ' edited', { exact: true }).first();
      await cell2.hover(); await p.waitForTimeout(400);
      const row2 = cell2.locator('xpath=ancestor::*[.//button][1]');
      const kebab = (await row2.locator('button').count()) === 1;
      await row2.locator('button').last().click(); await p.waitForTimeout(800);
      if (kebab) { await p.getByText(/^Удалить$/).first().click(); await p.waitForTimeout(800); }
      await p.screenshot({ path: `${__dirname}/crud/${tag}-3del.png` });
      const confirm = p.getByRole('button', { name: /^(да|удалить|подтвердить|ok)$/i }).last();
      if (await confirm.count()) { await confirm.click(); await p.waitForTimeout(1500); }
      await p.goto('http://localhost:3000' + path); await p.waitForTimeout(2500); await clean(p);
      if (await search.count()) { await search.fill(name); await p.waitForTimeout(1200); }
      res.deleted = await p.getByText(name, { exact: false }).count() === 0;
    } catch (e) { res.err = e.message.split('\n')[0].slice(0, 160); await p.screenshot({ path: `${__dirname}/crud/${tag}-err.png` }).catch(() => {}) }
    res.api = log; res.errs = errs;
    console.log(JSON.stringify(res));
    await p.close();
  }
  await b.close();
})();
