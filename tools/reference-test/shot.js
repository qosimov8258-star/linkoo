const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
// usage: node shot.js name refUrl localUrl
(async () => {
  const [name, refUrl, locUrl] = process.argv.slice(2);
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  for (const [tag, url, st] of [['ref', refUrl, 'ref.json'], ['loc', locUrl, 'local.json']]) {
    if (!url || url === '-') continue;
    const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/' + st });
    const p = await c.newPage();
    await p.goto(url, { timeout: 120000 }); await p.waitForTimeout(tag === 'ref' ? 7000 : 6000);
    await p.screenshot({ path: `${__dirname}/shots/${name}-${tag}.png`, fullPage: true });
    console.log(tag, p.url());
  }
  await b.close();
})();
