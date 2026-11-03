// Opens every local top-menu item (localmenu.json) in both apps: the reference through its own menu (hover + click,
// read-only), the local app by URL. Saves viewport screenshots (pages/NNN-ref.png / NNN-loc.png, filter panel open:
// NNN-reff.png / NNN-locf.png) and compare.json with: buttons/headers/tabs only in one app, record counts ("1 - 25 из N"),
// money totals, data-token similarity and filter-panel labels only in one app.
// START=NNN resumes from that item (earlier rows in compare.json are kept). A crashed tab is reopened and the item retried.
const { chromium } = require('playwright-core');
const fs = require('fs');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const items = JSON.parse(fs.readFileSync(__dirname + '/localmenu.json'));
const START = Number(process.env.START || 1);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(Number)) : null;

const sig = () => {
  const seen = new Set();
  const add = (t) => { t = (t || '').replace(/\s+/g, ' ').trim(); if (t && t.length < 50 && !/^\d[\d\s.,%-]*$/.test(t)) seen.add(t.toLowerCase()); };
  document.querySelectorAll('button, th, [role=tab], [role=columnheader], label, h1, h2, h3, h4, .ant-tabs-tab, .MuiTab-root').forEach(e => {
    const r = e.getBoundingClientRect(); if (r.top < 55 || r.height === 0) return;
    if (e.closest('header, nav')) return;
    add(e.innerText);
  });
  document.querySelectorAll('input[placeholder]').forEach(e => { const r = e.getBoundingClientRect(); if (r.top > 55 && r.height) add('ph:' + e.placeholder) });
  return [...seen];
};
// Page text below the top bar, split into cells; record count and money totals pulled out of it.
const dataSig = () => {
  const els = [...document.body.querySelectorAll('*')].filter(e => e.children.length === 0 && e.getBoundingClientRect().top > 55 && e.getBoundingClientRect().height > 0 && getComputedStyle(e).visibility !== 'hidden');
  const toks = [...new Set(els.map(e => (e.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase()).filter(t => t && t.length < 60))].slice(0, 800);
  const text = document.body.innerText.replace(/ /g, ' ');
  const m = /(\d[\d\s]*)\s*-\s*(\d[\d\s]*)\s+из\s+(\d[\d\s]*)/.exec(text);
  const count = m ? Number(m[3].replace(/\s/g, '')) : null;
  const money = [...new Set((text.match(/-?\d{1,3}(?:[  ]\d{3})+(?:,\d+)?\s?(?:SUM|USD|Euro|EURO)/g) || []).map(s => s.replace(/[\s ]+/g, ' ')))].slice(0, 30);
  return { toks, count, money };
};
const openFilter = async (p) => {
  const cands = p.locator('button:visible, a:visible, span:visible, div:visible').filter({ hasText: /^\s*(показать фильтр|фильтр(\s*\/\s*\d+)?)\s*[⌄▾]?\s*$/i });
  const n = Math.min(await cands.count(), 12); let btn = null;
  for (let k = 0; k < n; k++) { const el = cands.nth(k); const box = await el.boundingBox().catch(() => null); if (box && box.y > 55 && box.height < 50) { btn = el; break; } }
  if (!btn) return null;
  const leaves = () => p.evaluate(() => [...document.querySelectorAll('label, span, div, p')].filter(e => e.children.length === 0 && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().top > 55).map(e => e.innerText.trim()));
  const before = new Set(await leaves());
  await btn.click({ timeout: 3000 }).catch(() => {}); await p.waitForTimeout(1500);
  const after = await leaves();
  return [...new Set(after.filter(t => t && t.length < 40 && !before.has(t) && !/^\d[\d\s.,%-]*$/.test(t)))].map(t => t.toLowerCase());
};
const dropPasswordModal = (p) => p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() }));

(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const rc = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/ref.json' });
  const lc = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json' });
  let rp, lp;
  const openRef = async () => { if (rp) await rp.close().catch(() => {}); rp = await rc.newPage(); await rp.goto('https://app.linko.uz/#/?beginDate=2026-10-30&endDate=2026-10-30'); await rp.waitForTimeout(6000); };
  const openLoc = async () => { if (lp) await lp.close().catch(() => {}); lp = await lc.newPage(); };
  await openRef(); await openLoc();
  const prev = START > 1 && fs.existsSync(__dirname + '/compare.json') ? JSON.parse(fs.readFileSync(__dirname + '/compare.json')) : [];
  const res = prev.filter(r => Number(r.key) < START || (ONLY && !ONLY.has(Number(r.key))));
  let i = 0;
  for (const it of items) {
    i++;
    if (i < START || (ONLY && !ONLY.has(i))) continue;
    const key = String(i).padStart(3, '0');
    let row;
    for (let attempt = 0; attempt < 2; attempt++) {
      row = { key, ...it };
      try {
        // A filter drawer or dialog left open can cover the menu: go back to the dashboard and try again.
        const hoverMenu = async () => { await rp.mouse.move(750, 880); await rp.waitForTimeout(300); await rp.getByText(it.menu, { exact: true }).first().hover({ timeout: 8000 }); await rp.waitForTimeout(900); };
        await hoverMenu().catch(async () => { await openRef(); await hoverMenu(); });
        const cand = rp.getByText(it.label, { exact: true });
        const n = await cand.count(); let clicked = false;
        for (let k = 0; k < n; k++) { const el = cand.nth(k); if (await el.isVisible()) { await el.click({ timeout: 3000 }); clicked = true; break; } }
        if (!clicked) row.refMissing = true;
        else {
          await rp.waitForTimeout(9000); row.refUrl = rp.url(); row.ref = await rp.evaluate(sig); row.refData = await rp.evaluate(dataSig);
          await rp.screenshot({ path: `${__dirname}/pages/${key}-ref.png` });
          row.refFilter = await openFilter(rp); if (row.refFilter) await rp.screenshot({ path: `${__dirname}/pages/${key}-reff.png` });
          await rp.keyboard.press('Escape');
        }
      } catch (e) { row.refErr = e.message.slice(0, 100); }
      try {
        await lp.goto('http://localhost:3000' + it.href, { timeout: 60000 }); await lp.waitForTimeout(4000); await dropPasswordModal(lp);
        row.loc = await lp.evaluate(sig); row.locData = await lp.evaluate(dataSig); await lp.screenshot({ path: `${__dirname}/pages/${key}-loc.png` });
        row.locFilter = await openFilter(lp); if (row.locFilter) await lp.screenshot({ path: `${__dirname}/pages/${key}-locf.png` });
      } catch (e) { row.locErr = e.message.slice(0, 100); }
      const crashed = /closed|crash/i.test((row.refErr || '') + (row.locErr || ''));
      if (!crashed) break;
      if (/closed|crash/i.test(row.refErr || '')) await openRef();
      if (/closed|crash/i.test(row.locErr || '')) await openLoc();
    }
    if (row.ref && row.loc) {
      const L = new Set(row.loc), R = new Set(row.ref); row.onlyRef = row.ref.filter(x => !L.has(x)); row.onlyLoc = row.loc.filter(x => !R.has(x));
      const LD = new Set(row.locData.toks); const inter = row.refData.toks.filter(x => LD.has(x)).length;
      row.dataSim = Math.round(100 * inter / Math.max(1, new Set([...row.refData.toks, ...row.locData.toks]).size));
      row.countRef = row.refData.count; row.countLoc = row.locData.count;
      const LM = new Set(row.locData.money); row.moneyOnlyRef = row.refData.money.filter(x => !LM.has(x));
      if (row.refFilter && row.locFilter) { const LF = new Set(row.locFilter), RF = new Set(row.refFilter); row.filterOnlyRef = row.refFilter.filter(x => !LF.has(x)); row.filterOnlyLoc = row.locFilter.filter(x => !RF.has(x)); }
    }
    res.push(row);
    res.sort((a, c) => Number(a.key) - Number(c.key));
    const filt = row.refFilter && row.locFilter ? `${row.filterOnlyRef.length}/${row.filterOnlyLoc.length}` : row.refFilter ? 'ref-only' : row.locFilter ? 'loc-only' : '-';
    console.log(key, it.menu, '|', it.label, row.refMissing ? 'REF MISSING' : '',
      row.onlyRef ? `ui:-${row.onlyRef.length}/+${row.onlyLoc.length} data:${row.dataSim}% count:${row.countRef}/${row.countLoc} money-diff:${row.moneyOnlyRef.length} filter:${filt}` : (row.refErr || row.locErr || ''));
    fs.writeFileSync(__dirname + '/compare.json', JSON.stringify(res, null, 1));
  }
  await b.close();
})();
