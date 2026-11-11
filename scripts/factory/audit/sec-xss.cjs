// Stored-XSS check in a real browser against the LOCAL factory instance.
//
//   PW_CORE=… CHROME=… node scripts/factory/audit/sec-xss.cjs
//
// Writes a markup payload into records that many pages show (a new client with its address, note
// and contact person, an expense category, a client type, a brand), opens the pages that list
// them, hovers the charts and opens the map popups, and reports any payload that ran
// (window.__xss), any dialog, and any Content-Security-Policy violation. The dashboard donut is
// also fed a payload name directly (its tooltip is HTML). The test records stay (take a snapshot
// first, README): they are named "XSS probe …".
const path = require("path")
const ROOT = path.join(__dirname, "../../..")
const { chromium } = require(process.env.PW_CORE || path.join(ROOT, "tools/reference-test/node_modules/playwright-core"))
const BASE = process.env.FACTORY_URL || "http://localhost:3001"
const EXE = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(BASE)) throw new Error("local servers only")

const MARK = `XSS probe ${Date.now().toString(36)}`
// Runs if it ever lands in the page as markup, as an attribute, or as a URL.
const PAYLOAD = `${MARK} "'><img src=x onerror="window.__xss=(window.__xss||0)+1"><svg onload="window.__xss=1"></svg><script>window.__xss=1</script>`
const PAGES = [
  "/?beginDate=2026-10-01&endDate=2026-12-31",
  "/clients",
  "/clients?search=XSS",
  "/tracking",
  "/analytics/orders",
  "/analytics/client-balance",
  "/analytics/order-debts",
  "/analytics/customer-payments",
  "/analytics/cash-management",
  "/analytics/expense-categories",
  "/analytics/client-types",
  "/analytics/brands",
  "/analytics/contracts",
  "/analytics/store-reconciliation",
  "/analytics/activity",
  "/analytics/sales",
  "/analytics/expense-report",
]

;(async () => {
  const browser = await chromium.launch({ executablePath: EXE, headless: true })
  const context = await browser.newContext({ viewport: { width: 1500, height: 900 }, locale: "ru-RU" })
  const api = context.request
  const headers = { origin: BASE }
  const login = await api.post(`${BASE}/api/auth/login`, { data: { username: process.env.FACTORY_USER || "admin", password: process.env.FACTORY_PASS || "Zavod-Admin-2026" }, headers })
  if (!login.ok()) throw new Error(`sign-in ${login.status()}`)

  let failed = 0
  const check = (name, ok, detail = "") => {
    if (!ok) failed++
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  }

  // --- records that carry the payload ---------------------------------------------------
  const template = (await (await api.get(`${BASE}/api/clients/1`)).json()) ?? {}
  const created = await api.post(`${BASE}/api/clients`, {
    headers,
    data: {
      name: PAYLOAD.slice(0, 190),
      phone: "+998900000001",
      type: template.type,
      zone: template.zone,
      agent: template.agent,
      deliverer: template.deliverer,
      branch: template.branch,
      address: PAYLOAD,
      landmark: PAYLOAD,
      contactPerson: PAYLOAD.slice(0, 190),
      note: PAYLOAD,
      locationLat: 41.31,
      locationLng: 69.28,
      allowDuplicate: true,
    },
  })
  check("a client whose name, address and note are markup is stored as text", created.status() === 201, `status ${created.status()} ${(await created.text()).slice(0, 160)}`)
  for (const [url, data] of [
    ["/api/expense-categories", { name: PAYLOAD.slice(0, 180) }],
    ["/api/client-types", { name: PAYLOAD.slice(0, 180) }],
    ["/api/brands", { name: PAYLOAD.slice(0, 180), organization: "" }],
  ]) {
    const response = await api.post(BASE + url, { headers, data })
    console.log(`      ${url} → ${response.status()}`)
  }

  // --- the pages ----------------------------------------------------------------------
  const violations = []
  let dialogs = 0
  for (const route of PAGES) {
    const page = await context.newPage()
    page.on("dialog", (dialog) => {
      dialogs++
      dialog.dismiss().catch(() => {})
    })
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(message.text())) violations.push(`${route}: ${message.text().slice(0, 200)}`)
    })
    await page.goto(BASE + route, { timeout: 120000 }).catch(() => {})
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1500)
    // Hover every chart canvas (HTML tooltips) and click the first map markers (HTML popups).
    for (const canvas of await page.locator("canvas").all()) {
      const box = await canvas.boundingBox().catch(() => null)
      if (!box) continue
      for (const [dx, dy] of [[0.5, 0.12], [0.85, 0.5], [0.5, 0.88], [0.15, 0.5], [0.72, 0.2], [0.28, 0.8]]) {
        await page.mouse.move(box.x + box.width * dx, box.y + box.height * dy).catch(() => {})
        await page.waitForTimeout(120)
      }
    }
    for (const marker of (await page.locator(".leaflet-marker-icon").all()).slice(0, 80)) {
      await marker.click({ timeout: 800, force: true }).catch(() => {})
      await page.waitForTimeout(40)
    }
    const state = await page.evaluate((mark) => ({ ran: window.__xss ?? 0, shown: document.body.innerText.includes(mark), injected: document.querySelectorAll('img[src="x"], svg[onload]').length }), MARK).catch(() => ({ ran: -1, shown: false, injected: -1 }))
    check(`${route}: no payload ran${state.shown ? " (the text is on the page)" : ""}`, state.ran === 0 && state.injected === 0, `ran ${state.ran}, injected nodes ${state.injected}`)
    await page.close()
  }

  // --- the dashboard donut: its tooltip is HTML ----------------------------------------------
  const page = await context.newPage()
  page.on("dialog", (dialog) => {
    dialogs++
    dialog.dismiss().catch(() => {})
  })
  await page.route("**/api/dashboard-summary/breakdown**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ group: "По товарам", measure: "Факт продажи", currency: "SUM", unit: "money", total: 300, rows: [{ name: PAYLOAD, value: 200 }, { name: `<b id="xss-bold">bold</b>`, value: 100 }] }) }),
  )
  await page.goto(`${BASE}/?beginDate=2026-10-01&endDate=2026-10-31`, { timeout: 120000 })
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1500)
  let tooltipSeen = false
  for (const canvas of await page.locator("canvas").all()) {
    const box = await canvas.boundingBox().catch(() => null)
    if (!box) continue
    for (let step = 0; step < 24; step++) {
      const angle = (step / 24) * Math.PI * 2
      await page.mouse.move(box.x + box.width / 2 + Math.cos(angle) * box.width * 0.36, box.y + box.height / 2 + Math.sin(angle) * box.height * 0.36).catch(() => {})
      await page.waitForTimeout(90)
      if (await page.evaluate((mark) => [...document.querySelectorAll("div")].some((node) => node.style.position === "absolute" && node.innerText.includes(mark)), MARK).catch(() => false)) tooltipSeen = true
    }
  }
  const donut = await page.evaluate(() => ({ ran: window.__xss ?? 0, bold: Boolean(document.getElementById("xss-bold")), injected: document.querySelectorAll('img[src="x"], svg[onload]').length }))
  check("the donut tooltip showed the payload name", tooltipSeen)
  check("…as text: nothing ran and no markup was created", donut.ran === 0 && !donut.bold && donut.injected === 0, JSON.stringify(donut))
  await page.close()

  check("no dialog opened on any page", dialogs === 0, `${dialogs}`)
  check("no Content-Security-Policy violation on any page", violations.length === 0, violations.slice(0, 3).join(" | "))
  await browser.close()
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed")
  process.exit(failed ? 1 : 0)
})()
