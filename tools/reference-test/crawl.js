const { chromium } = require('playwright-core');
const fs = require('fs');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const routes = fs.readFileSync(__dirname + '/routes.txt', 'utf8').split('\n').filter(Boolean);
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json' });
  const res = [];
  for (const r of routes) {
    const p = await c.newPage();
    const errs = [], bad = [];
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)) });
    p.on('response', resp => { const u = resp.url(); if (resp.status() >= 400 && u.includes('localhost')) bad.push(resp.status() + ' ' + u.replace('http://localhost:3000', '').slice(0, 120)) });
    let status = 0;
    try { const resp = await p.goto('http://localhost:3000' + r, { timeout: 120000 }); status = resp.status(); await p.waitForTimeout(3500); } catch (e) { errs.push('NAV ' + e.message.slice(0, 100)) }
    const txt = await p.evaluate(() => document.body.innerText).catch(() => '');
    const flag = /Application error|Unhandled Runtime Error|This page could not be found|Internal Server Error|404/.test(txt.slice(0, 3000));
    const row = { r, status, final: p.url().replace('http://localhost:3000', ''), flag, bad: [...new Set(bad)], errs: [...new Set(errs)].slice(0, 5) };
    res.push(row);
    if (status >= 400 || flag || bad.length || errs.length) console.log(JSON.stringify(row));
    await p.close();
  }
  fs.writeFileSync(__dirname + '/crawl.json', JSON.stringify(res, null, 1));
  console.log('done', res.length);
  await b.close();
})();
