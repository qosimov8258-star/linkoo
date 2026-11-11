// For every page: open each "Добавить/Создать" dialog, submit it empty, then with hostile values.
// Records page errors, 5xx answers and dialogs that closed (= saved) on empty / hostile input.
const path = require("path")
const fs = require("fs")
const ROOT = path.join(__dirname, "../../..")
const { chromium } = require(process.env.PW_CORE || path.join(ROOT, "tools/reference-test/node_modules/playwright-core"))
const BASE = process.env.FACTORY_URL || "http://localhost:3001"
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local servers only")
const EXE = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const OUT = process.env.AUDIT_OUT || path.join(ROOT, ".ui-check/audit/forms")
fs.mkdirSync(OUT, { recursive: true })
const routes = fs.readFileSync(path.join(ROOT, "tools/reference-test/routes.txt"), "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
const [SI, SC] = (process.env.SHARD || "0/1").split("/").map(Number)
const FILTER = process.argv[2] ? new RegExp(process.argv[2]) : null
const mine = routes.map((r, i) => ({ r, i })).filter(({ r, i }) => i % SC === SI && (!FILTER || FILTER.test(r)))
const ADD = /^(\+\s*)?(добавить|создать|новый|новая|новое|\+)(\s|$)/i
const SUBMIT = /^(сохранить|создать|добавить|применить|ок|ok)$/i
const DIALOG = '[role=dialog]:visible, [aria-modal="true"]:visible, div.fixed.inset-0:visible'

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "ru-RU" })
  const login = await context.request.post(`${BASE}/api/auth/login`, { data: { username: "admin", password: "Zavod-Admin-2026", remember: true }, headers: { origin: BASE } })
  if (!login.ok()) throw new Error("login " + login.status())
  const results = []
  for (const { r: route, i } of mine) {
    const page = await context.newPage()
    const problems = []
    let at = "load"
    page.on("pageerror", (e) => problems.push({ at, kind: "pageerror", text: String(e.message).slice(0, 250) }))
    page.on("response", async (res) => {
      if (!res.url().startsWith(BASE + "/api") || res.status() < 500) return
      let body = ""
      try { body = (await res.text()).slice(0, 160) } catch {}
      problems.push({ at, kind: "http " + res.status(), text: `${res.request().method()} ${res.url().replace(BASE, "")} ${body}` })
    })
    page.on("request", (req) => {
      if (req.url().startsWith(BASE + "/api") && req.method() !== "GET") problems.push({ at, kind: "write", text: `${req.method()} ${req.url().replace(BASE, "")} ${(req.postData() || "").slice(0, 160)}` })
    })
    page.on("dialog", (d) => d.dismiss().catch(() => {}))
    try {
      await page.goto(BASE + route, { timeout: 120000 })
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
      await page.waitForTimeout(800)
      const buttons = page.locator("main button:visible")
      const n = await buttons.count()
      const labels = []
      for (let k = 0; k < n; k++) {
        const t = ((await buttons.nth(k).innerText({ timeout: 500 }).catch(() => "")) || "").trim().replace(/\s+/g, " ")
        if (ADD.test(t) && t.length < 40 && !labels.includes(t)) labels.push(t)
      }
      for (const label of labels.slice(0, 3)) {
        for (const mode of ["empty", "hostile"]) {
          at = `${label} / ${mode}`
          await page.goto(BASE + route, { timeout: 60000 }).catch(() => {})
          await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {})
          const btn = page.locator("main button:visible", { hasText: label }).first()
          await btn.click({ timeout: 3000 }).catch(() => {})
          await page.waitForTimeout(900)
          const dlg = page.locator(DIALOG).last()
          if (!(await dlg.count())) { if (mode === "empty") problems.push({ at, kind: "nodialog", text: page.url().replace(BASE, "") }); break }
          if (mode === "hostile") {
            const inputs = dlg.locator("input:visible:not([type=checkbox]):not([type=radio]):not([type=file]):not([readonly]), textarea:visible")
            const c = await inputs.count()
            for (let k = 0; k < Math.min(c, 25); k++) {
              const inp = inputs.nth(k)
              const type = (await inp.getAttribute("type").catch(() => "")) || ""
              const role = (await inp.getAttribute("role").catch(() => "")) || ""
              if (role === "combobox" || type === "date" || type === "time") continue
              const v = type === "number" ? "-99999999999999" : "Тест<script>x</script>'\";-- " + "Ж".repeat(400)
              await inp.fill(v, { timeout: 800 }).catch(() => {})
            }
          }
          const submits = dlg.locator("button:visible")
          const sc = await submits.count()
          let clicked = ""
          for (let k = sc - 1; k >= 0; k--) {
            const t = ((await submits.nth(k).innerText({ timeout: 500 }).catch(() => "")) || "").trim()
            if (SUBMIT.test(t)) { await submits.nth(k).click({ timeout: 2000 }).catch(() => {}); clicked = t; break }
          }
          await page.waitForTimeout(1500)
          const still = await page.locator(DIALOG).count()
          if (clicked && !still) problems.push({ at, kind: "closed-after-submit", text: clicked })
          if (!clicked) problems.push({ at, kind: "nosubmit", text: "" })
          await page.keyboard.press("Escape").catch(() => {})
        }
      }
      if (labels.length) await page.screenshot({ path: path.join(OUT, `${String(i).padStart(3, "0")}.png`) }).catch(() => {})
      results.push({ route, labels, problems })
      if (problems.some((p) => p.kind !== "write" || true)) console.log(JSON.stringify({ route, labels, problems }))
    } catch (e) {
      results.push({ route, problems: [{ kind: "nav", text: e.message.slice(0, 200) }] })
    }
    await page.close()
  }
  fs.writeFileSync(path.join(OUT, `ff-${SI}.json`), JSON.stringify(results, null, 1))
  console.log("done", results.length)
  await browser.close()
})()
