// Compares local "Долги доставщиков" (today, 2026-10-30) with refdata/delivery_balance.json; prints membership differences
// and per deliverer/currency begin-balance deltas; writes the deltas ([employee id, currency, amount]) to argv[2] if given.
const { chromium } = require('playwright-core');
(async () => {
  const ref = require('./refdata/delivery_balance.json');
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const c = await b.newContext({ storageState: __dirname + '/local.json' }); const p = await c.newPage(); await p.goto('http://localhost:3000/login');
  const loc = await p.evaluate(async () => (await fetch('/api/balances/deliverer?from=2026-10-30&to=2026-10-30&pageSize=0')).json());
  const lm = new Map((loc.rows || []).map((r) => [String(r.key), r])); const refIds = new Set(ref.map((r) => String(r.id)));
  console.log('local rows', lm.size, 'ref rows', ref.length, 'only local:', [...lm.keys()].filter((k) => !refIds.has(k)).join(','), 'only ref:', [...refIds].filter((k) => !lm.has(k)).join(','));
  const deltas = []; let same = 0; const cur = (n) => (n === 'Euro' ? 'EUR' : n);
  for (const r of ref) { const l = lm.get(String(r.id)); let ok = true
    for (const x of r.currencies) { const k = cur(x.name); const lb = l?.currencies?.[k]?.begin_balance ?? 0; const d = Math.round((x.begin_balance - lb) * 1000) / 1000; if (Math.abs(d) > 0.001) { deltas.push([r.id, k, d]); ok = false } }
    if (ok) same++ }
  console.log('equal', same, 'deltas', deltas.length); console.log(JSON.stringify(deltas));
  console.log('totals local', JSON.stringify(Object.fromEntries(Object.entries(loc.totals || {}).map(([k, v]) => [k, Math.round(v.begin_balance * 1000) / 1000]))));
  if (process.argv[2]) require('fs').writeFileSync(process.argv[2], JSON.stringify(deltas));
  await b.close();
})();
