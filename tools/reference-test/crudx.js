// Create / edit / delete one row on a local settings list with a dialog described by a spec:
// node crudx.js '{"path":"/analytics/transport","add":"добавить транспорт","fields":{"Модель":"$NAME","Номер":"01A001AA"},"drops":["Филиал"],"save":"сохран|примен"}'
// "$NAME" is replaced with a unique "QA test …" name; the row is found by it, renamed to "… edited", then deleted.
const { chromium } = require('playwright-core');
const spec = JSON.parse(process.argv[2]);
const EXE = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
(async () => {
  const b = await chromium.launch({ executablePath: EXE, headless: true });
  const c = await b.newContext({ viewport: { width: 1500, height: 900 }, storageState: __dirname + '/local.json' });
  const p = await c.newPage(); const api = []; const res = { path: spec.path };
  p.on('dialog', d => d.accept());
  p.on('response', async r => { if (r.request().method() !== 'GET' && r.url().includes('/api/')) api.push(r.request().method() + ' ' + r.status() + ' ' + r.url().replace('http://localhost:3000', '') + (r.status() >= 400 ? ' ' + (await r.text()).slice(0, 120) : '')) });
  const name = 'QA test ' + Date.now().toString().slice(-6); res.name = name;
  const save = new RegExp(spec.save || 'сохран', 'i');
  const go = async () => { await p.goto('http://localhost:3000' + spec.path); await p.waitForTimeout(3000); await p.evaluate(() => document.querySelectorAll('div.fixed.inset-0').forEach(e => { if (e.innerText.includes('Сменить пароль')) e.remove() })); const s = p.locator('input[placeholder*="Поиск"]:visible').first(); if (await s.count()) { await s.fill(name); await p.waitForTimeout(1200); } };
  const dlg = () => p.locator('[role=dialog], .fixed.inset-0').last();
  // An input "belongs" to the nearest label text above it inside the same field wrapper.
  const fieldInput = (label) => dlg().locator(`xpath=.//*[normalize-space(text())="${label}" or starts-with(normalize-space(text()),"${label} ")]/ancestor::*[.//input or .//textarea][1]`).locator('input:not([type=checkbox]), textarea').first();
  const fill = async (fields, nm) => { for (const [label, v] of Object.entries(fields)) { await fieldInput(label).fill(String(v).replace('$NAME', nm), { timeout: 4000 }).catch(e => res['fillErr:' + label] = e.message.split('\n')[0]); } };
  const pick = async (drops) => { for (const d of drops || []) { const lab = dlg().locator('span.pointer-events-none', { hasText: new RegExp('^' + d) }).first(); await lab.locator('xpath=..').locator('button').first().click({ timeout: 3000 }).catch(async () => { const bb = await dlg().getByText(new RegExp('^' + d)).first().boundingBox(); if (bb) await p.mouse.click(bb.x + 150, bb.y + bb.height / 2); }); await p.waitForTimeout(600); const opt = p.locator('.max-h-64 button:visible, button.block.w-full:visible').filter({ hasNotText: /^[-.\s]*$/ }).nth(1); if (await opt.count()) await opt.click({ timeout: 3000 }).catch(() => {}); else res['noOption:' + d] = true; await p.waitForTimeout(300); } };
  try {
    await go(); await p.getByText(new RegExp(spec.add, 'i')).filter({ visible: true }).first().click(); await p.waitForTimeout(900);
    await fill(spec.fields, name); await pick(spec.drops);
    // Extra clicks in order, e.g. open a clock picker and accept it: "clicks":["Начало","OK","Конец","OK"].
    for (const t of spec.clicks || []) { await p.getByText(new RegExp('^\\s*' + t + '\\s*$')).filter({ visible: true }).last().click({ timeout: 4000 }).catch(e => res['clickErr:' + t] = e.message.split('\n')[0]); await p.waitForTimeout(500); }
    await p.screenshot({ path: `${__dirname}/crud/x-${spec.path.split('/').pop()}-add.png` });
    await dlg().getByRole('button', { name: save }).last().click({ timeout: 5000 }); await p.waitForTimeout(1800);
    await go(); res.created = await p.getByText(name, { exact: true }).count() > 0;
    const cell = p.getByText(name, { exact: true }).first(); await cell.hover(); await p.waitForTimeout(400);
    const row = cell.locator('xpath=ancestor::*[.//button][1]'); const btns = row.locator('button'); const nb = await btns.count();
    const kebab = nb === 1 && !/измен/i.test(await btns.first().innerText().catch(() => '') + (await btns.first().getAttribute('title') || ''));
    await btns.first().click(); if (kebab) { await p.waitForTimeout(400); await p.getByText(/^(Изменить|Редактировать)$/).first().click(); } await p.waitForTimeout(900);
    const inputs = dlg().locator('input:visible, textarea:visible'); const n = await inputs.count();
    for (let i = 0; i < n; i++) if ((await inputs.nth(i).inputValue().catch(() => '')) === name) { await inputs.nth(i).fill(name + ' edited'); break; }
    await dlg().getByRole('button', { name: save }).last().click({ timeout: 5000 }); await p.waitForTimeout(1800);
    await go(); res.edited = await p.getByText(name + ' edited', { exact: true }).count() > 0;
    const cell2 = p.getByText(name + ' edited', { exact: true }).first(); await cell2.hover(); await p.waitForTimeout(400);
    const row2 = cell2.locator('xpath=ancestor::*[.//button][1]'); await row2.locator('button').last().click(); await p.waitForTimeout(800);
    if (kebab) { await p.getByText(/^Удалить$/).first().click(); await p.waitForTimeout(800); }
    const conf = p.getByRole('button', { name: /^(да|удалить|подтвердить|ok)$/i }).last(); if (await conf.count()) { await conf.click(); await p.waitForTimeout(1500); }
    await go(); res.deleted = await p.getByText(name, { exact: false }).count() === 0;
  } catch (e) { res.err = e.message.split('\n')[0].slice(0, 160); await p.screenshot({ path: `${__dirname}/crud/x-${spec.path.split('/').pop()}-err.png` }).catch(() => {}); }
  res.api = api; console.log(JSON.stringify(res)); await b.close();
})();
