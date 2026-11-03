// Compares local employee balances (Oct 2026) with refdata/salary_balance.json and writes the remaining deltas
// ([kind, employee id, currency, date, signed amount]) to the given file.
const { chromium } = require('playwright-core');
(async () => {
  const ref = require('./refdata/salary_balance.json');
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const c = await b.newContext({ storageState: __dirname + '/local.json' }); const p = await c.newPage(); await p.goto('http://localhost:3000/login');
  const loc = await p.evaluate(async () => (await fetch('/api/balances/employee?from=2026-10-01&to=2026-10-31&pageSize=0')).json());
  const lm = new Map((loc.rows || []).map((r) => [String(r.key), r])); const deltas = []; let same = 0;
  const cur = (n) => (n === 'Euro' ? 'EUR' : n);
  for (const r of ref) {
    const l = lm.get(String(r.id)); let ok = true
    for (const x of r.currencies) {
      const k = cur(x.name); const lb = l?.currencies?.[k] || { begin_balance: 0, end_balance: 0 };
      const db = Math.round((x.begin_balance - lb.begin_balance) * 1000) / 1000; const dm = Math.round(((x.end_balance - x.begin_balance) - (lb.end_balance - lb.begin_balance)) * 1000) / 1000;
      if (Math.abs(db) > 0.001) { deltas.push(['employee', r.id, k, '2020-01-01', db]); ok = false }
      if (Math.abs(dm) > 0.001) { deltas.push(['employee', r.id, k, '2026-10-01', dm]); ok = false }
    }
    if (ok) same++
  }
  console.log('rows equal', same, 'of', ref.length, 'deltas', deltas.length); console.log(JSON.stringify(deltas));
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify(deltas));
  await b.close();
})();
