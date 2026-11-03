// Compares local Баланс поставщиков (Oct 2026) with refdata/provider_balance.json (stats/provider/balance/extended);
// prints the differing rows and writes per supplier/currency deltas ({supplierId, currency, delta}) to argv[2].
const { chromium } = require('playwright-core');
(async () => {
  const ref = require('./refdata/provider_balance.json');
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const c = await b.newContext({ storageState: __dirname + '/local.json' }); const p = await c.newPage(); await p.goto('http://localhost:3000/login');
  const loc = await p.evaluate(async () => (await fetch('/api/balances/supplier?from=2026-10-01&to=2026-10-31&pageSize=0')).json());
  const byId = new Map((loc.rows || []).map((r) => [String(r.id), r]));
  const cur = (n) => (n === 'Euro' ? 'EUR' : n); const out = []; let eq = 0; let inPeriod = 0;
  for (const r of ref) {
    const l = byId.get(String(r.id)); let ok = true
    for (const x of r.currencies) {
      const k = cur(x.name); const lb = l?.currencies?.[k] || { begin_balance: 0, end_balance: 0 };
      const d = Math.round((x.begin_balance - lb.begin_balance) * 1e6) / 1e6;
      const dm = Math.round(((x.end_balance - x.begin_balance) - (lb.end_balance - lb.begin_balance)) * 1e6) / 1e6;
      if (Math.abs(dm) > 0.0005) inPeriod++
      if (Math.abs(d) > 0.0005) { out.push({ supplierId: r.id, name: r.name, currency: k.toLowerCase(), delta: d }); ok = false }
    }
    if (ok) eq++
  }
  console.log('equal', eq, 'of', ref.length, 'deltas', out.length, 'in-period movement diffs', inPeriod);
  console.log(out.map((o) => `${o.supplierId} ${o.name} ${o.currency} ${o.delta}`).join('\n'));
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify(out));
  await b.close();
})();
