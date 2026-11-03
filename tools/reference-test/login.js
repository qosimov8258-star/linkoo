const { chromium } = require('playwright-core');
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  if (!process.env.LOCALONLY) {
  let c = await b.newContext({ viewport: { width: 1500, height: 900 } });
  let p = await c.newPage();
  await p.goto('https://app.linko.uz/');
  await p.waitForSelector('input[name=server]', { timeout: 30000 });
  await p.fill('input[name=server]', process.env.REF_SERVER); await p.fill('input[name=username]', process.env.REF_USER); await p.fill('input[name=password]', process.env.REF_PASS);
  await p.keyboard.press('Enter'); await p.waitForTimeout(6000);
  console.log('ref', p.url());
  await c.storageState({ path: __dirname + '/ref.json' });
  }
  c = await b.newContext({ viewport: { width: 1500, height: 900 } });
  p = await c.newPage();
  await p.goto('http://localhost:3000/login', { timeout: 120000 });
  const ins = p.locator('form input');
  await ins.nth(0).fill(process.env.REF_SERVER); await ins.nth(1).fill(process.env.REF_USER); await ins.nth(2).fill(process.env.REF_PASS);
  await p.keyboard.press('Enter'); await p.waitForTimeout(8000);
  console.log('local', p.url());
  await c.storageState({ path: __dirname + '/local.json' });
  await b.close();
})();
