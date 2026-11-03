// node refget.js '<hash route that triggers the API>' '<api path substring to copy headers from>' '<full api url to GET (all pages)>' out.json
// Read-only: opens the reference page once to capture its auth headers, then GETs the given API URL (following "next").
const { chromium } = require('playwright-core');
const fs = require('fs');
(async () => {
  const [route, match, url, out] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' });
  const c = await b.newContext({ storageState: __dirname + '/ref.json' });
  const p = await c.newPage(); let hdr = null;
  p.on('request', r => { if (!hdr && r.url().includes(match)) hdr = r.headers() });
  await p.goto('https://app.linko.uz/#' + route); await p.waitForTimeout(9000);
  if (!hdr) { console.log('no request matched', match); await b.close(); return }
  let next = url; const all = []; let single = null;
  while (next) { const r = await c.request.get(next, { headers: hdr }); const j = await r.json(); if (Array.isArray(j)) { all.push(...j); next = null } else if (j.results) { all.push(...j.results); next = j.next } else { single = j; next = null } }
  fs.writeFileSync(out, JSON.stringify(single ?? all, null, 1)); console.log('saved', single ? 'object' : all.length, out);
  await b.close();
})();
