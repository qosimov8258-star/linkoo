// Opens every page of the LOCAL factory instance in headless Chromium, as the factory's
// administrator, and clicks every non-destructive button (tabs, filters, "Показать фильтр",
// "Добавить" dialogs, then Escape). Records page errors, console errors and failed API calls
// per page and per button, and a screenshot of every page.
//
//   node scripts/factory/ui-check.cjs [outDir] [routeFilter]
//
// Uses playwright-core from tools/reference-test (see its README; PW_CORE=<folder of another
// playwright-core install> when that one is missing) and the routes list there.
// Read-only towards data: buttons that save, delete, confirm, pay, import or sign out are skipped.

const path = require("path")
const fs = require("fs")
const { chromium } = require(process.env.PW_CORE || path.join(__dirname, "../../tools/reference-test/node_modules/playwright-core"))

const BASE = process.env.FACTORY_URL || "http://localhost:3001"
const USER = process.env.FACTORY_USER || "admin"
const PASS = process.env.FACTORY_PASS || "Zavod-Admin-2026"
const EXE = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const OUT = process.argv[2] || path.join(__dirname, "../../.ui-check")
const FILTER = process.argv[3] ? new RegExp(process.argv[3]) : null
const CLICKS = Number(process.env.CLICKS ?? 30)
// Longest wait for a page to go quiet after it loads (a page that polls never does).
const IDLE_MS = Number(process.env.IDLE_MS ?? 15000)
// Longest time one page (load + clicks) may take before it is reported as hung and left behind.
const PAGE_MS = Number(process.env.PAGE_MS ?? 240000)
const SKIP = /удал|сохран|отправ|подтвер|выйти|выход|перерасч|пересчит|сверить|принять|закрыть|очист|сброс|импорт|загруз|архив|отмен|оплат|провест|создать|^да$|^ok$|начать|завершить|копир|дублир|блок|актив|зачисл|списат|выдать|передать|рассчитать|применить|telegram|excel|скачать|печать|экспорт|синхрон/i

if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("ui-check only runs against a local server")
fs.mkdirSync(path.join(OUT, "shots"), { recursive: true })
const routes = fs
  .readFileSync(path.join(__dirname, "../../tools/reference-test/routes.txt"), "utf8")
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((route) => !FILTER || FILTER.test(route))
// SHARD=i/n: this worker takes every n-th route starting at i (several workers in parallel).
const [SHARD_INDEX, SHARD_COUNT] = (process.env.SHARD || "0/1").split("/").map(Number)
// RESUME=1: leave out the routes that already have a screenshot in OUT (a stopped run goes on).
const shotsDir = path.join(OUT, "shots")
const done = process.env.RESUME ? new Set(fs.readdirSync(shotsDir).map((name) => Number(name.slice(0, 3)))) : new Set()
const mine = routes.map((route, index) => ({ route, index })).filter(({ index }) => index % SHARD_COUNT === SHARD_INDEX && !done.has(index))

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, acceptDownloads: false, locale: "ru-RU" })
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { username: USER, password: PASS, remember: true }, headers: { origin: BASE } })
  if (!login.ok()) throw new Error(`login ${login.status()} ${await login.text()}`)
  const results = []
  for (const { route, index } of mine) {
    const page = await context.newPage()
    const problems = []
    let current = "load"
    page.on("pageerror", (error) => problems.push({ at: current, kind: "pageerror", text: String(error.message).slice(0, 300) }))
    page.on("console", (message) => {
      if (message.type() === "error" && !/Failed to load resource/.test(message.text())) problems.push({ at: current, kind: "console", text: message.text().slice(0, 300) })
    })
    page.on("response", async (response) => {
      const url = response.url()
      if (!url.startsWith(BASE) || response.status() < 400) return
      let body = ""
      try {
        body = (await response.text()).slice(0, 200)
      } catch {}
      problems.push({ at: current, kind: `http ${response.status()}`, text: `${response.request().method()} ${url.replace(BASE, "")} ${body}` })
    })
    page.on("dialog", (dialog) => dialog.dismiss().catch(() => {}))
    let status = 0
    let text = ""
    const visit = async () => {
      const response = await page.goto(BASE + route, { timeout: 120000 })
      status = response ? response.status() : 0
      await page.waitForLoadState("networkidle", { timeout: IDLE_MS }).catch(() => {})
      await page.waitForTimeout(1200)
      text = await page.evaluate(() => document.body.innerText).catch(() => "")
      await page.screenshot({ path: path.join(OUT, "shots", `${String(index).padStart(3, "0")}${route.replace(/[^a-z0-9]+/gi, "_")}.png`) }).catch(() => {})
      const buttons = page.locator("main button:visible, [role=tab]:visible")
      const count = await buttons.count()
      const seen = new Set()
      for (let i = 0; i < Math.min(count, CLICKS); i++) {
        const button = buttons.nth(i)
        const label = ((await button.innerText({ timeout: 1000 }).catch(() => "")) || (await button.getAttribute("aria-label").catch(() => "")) || "").trim().replace(/\s+/g, " ")
        if (!label || SKIP.test(label) || label.length > 40 || seen.has(label)) continue
        seen.add(label)
        const before = page.url()
        current = `click "${label}"`
        await button.click({ timeout: 2500 }).catch(() => {})
        await page.waitForTimeout(800)
        await page.keyboard.press("Escape").catch(() => {})
        await page.waitForTimeout(250)
        if (page.url().split("?")[0] !== before.split("?")[0]) {
          await page.goto(before, { timeout: 60000 }).catch(() => {})
          await page.waitForTimeout(1200)
        }
      }
    }
    // A page that stops answering (a frozen or crashed renderer) must not stop the whole run.
    let timer
    const hung = await Promise.race([
      visit().then(
        () => false,
        (error) => {
          problems.push({ at: current, kind: "nav", text: error.message.slice(0, 200) })
          return false
        },
      ),
      new Promise((resolve) => (timer = setTimeout(() => resolve(true), PAGE_MS))),
    ])
    clearTimeout(timer)
    if (hung) problems.push({ at: current, kind: "hang", text: `the page did not answer within ${PAGE_MS / 1000} s` })
    const flagged = /Application error|Unhandled Runtime Error|This page could not be found|Internal Server Error/.test(text.slice(0, 4000))
    const row = { route, status, final: hung ? route : page.url().replace(BASE, ""), flagged, problems }
    results.push(row)
    if (status >= 400 || flagged || problems.length) console.log(JSON.stringify(row))
    await Promise.race([page.close().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 5000))])
  }
  fs.writeFileSync(path.join(OUT, `ui-check-${SHARD_INDEX}.json`), JSON.stringify(results, null, 1))
  console.log(`done: ${results.length} pages, ${results.filter((row) => row.problems.length || row.flagged || row.status >= 400).length} with problems`)
  await browser.close()
})()
