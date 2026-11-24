// Downloads the data of a Linko account (read-only GET requests only) into backups/linko-raw/<YYYY-MM-DD>/ (the first
// account, time3) or backups/linko-raw-<server>/<YYYY-MM-DD>/ (any other LINKO_SERVER) — the raw files the import-*.mjs
// scripts read — and marks the folder with its server (source.json). Nothing is ever written to Linko.
//
//   LINKO_SERVER=time3 LINKO_USER=admin LINKO_PASS=… node scripts/linko-sync/fetch.mjs            (everything)
//   … node scripts/linko-sync/fetch.mjs lists details returns-patch manufacture-returns           (some steps)
//
// Steps: lists (fetch-manifest.json "lists": every list, all pages, no filter), details (each document of a list),
// returns-patch (return documents Linko answers 500 for), manufacture-returns (per production stage), attendance,
// months (per-month salary / KPI / plan lists), employee-details (each employee's card: «Показывать в отслеживании»),
// gps (every employee's GPS points), visit-sessions (timed visits),
// finance-entities (van-sell / branch / employee / supplier acts), cashback-details, price-list-items (every product's
// prices per price list, read product by product), transfer-logs («Логи» of the transfers between warehouses),
// order-debt-transactions (each order's «Список оплат по заказу»), return-logs («Логи» of the client returns), return-marks (the marking codes of every client return line),
// border-agents (the employees bound to each territory), market-users (each shop's «Агенты магазина», and its last
// order / visit days, which only the shop's detail has), day-plans (the tasks of each agent-day of «Время работы агента»).
// extras (not part of the run without arguments; `… fetch.mjs extras`, or one of them by name): the inputs of the
// capture-based importers, which the first account got from read-only captures of Linko's screens — knowledge-base,
// finance-cash, stock-transfers-cancelled, draft-order-details, client-promotion-details, salary-cards, product-detail,
// sales-orders-list, shop-drawer (see "extras" below). They read the lists already in RAW: run them after lists / months.
// LINKO_TOKEN=… instead of LINKO_USER / LINKO_PASS reuses an existing session token. RAW=<folder> writes elsewhere; it
// needs LINKO_SERVER, and a folder that already belongs to another server (source.json, or its place) is refused.
// The raw files hold business data: backups/ is git-ignored, never commit them.
import fs from "node:fs"
import path from "node:path"
import { fetchDayPlans } from "./fetch-day-plans.mjs"
import { fetchTarget, markFolder } from "./lib.mjs"

const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date())
// The folder is created (and marked) only after the step names are checked and the sign-in worked.
const { server: SERVER, dir: RAW } = fetchTarget(DAY)
const BASE = `https://${SERVER}.linko.uz/ru/api/v1/`
const MAX = Number(process.env.MAXC || 4)

// --- HTTP ------------------------------------------------------------------------------------------------------------

let token = process.env.LINKO_TOKEN || ""
async function login() {
  if (token) return
  if (!process.env.LINKO_USER || !process.env.LINKO_PASS) throw new Error("Set LINKO_USER and LINKO_PASS (or LINKO_TOKEN)")
  const response = await fetch(`${BASE}main/user/auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", Accept: "application/json" },
    body: JSON.stringify({ username: process.env.LINKO_USER, password: process.env.LINKO_PASS, rememberMe: false, can_handle_2fa: false }),
  })
  const body = await response.json().catch(() => ({}))
  token = body.token || body.key || body.auth_token || ""
  if (!response.ok || !token) {
    // Linko's own reason («Неверный логин или пароль», a 2FA request …); the request's password is never printed.
    const reason = [body.detail, body.message, ...[].concat(body.non_field_errors ?? []), ...[].concat(body.username ?? []), ...[].concat(body.password ?? [])]
      .filter((text) => typeof text === "string" && text)
      .join(" ")
    throw new Error(`Linko sign-in failed (${response.status})${reason ? `: ${reason}` : ` (fields: ${Object.keys(body).join(", ") || "none"})`}`)
  }
}

let active = 0
const waiting = []
const slot = async () => {
  if (active >= MAX) await new Promise((resolve) => waiting.push(resolve))
  active++
}
const release = () => {
  active--
  waiting.shift()?.()
}

/** GET (never anything else): { status, json }. Retries server errors and throttling. */
async function get(p, params) {
  const url = new URL(p.startsWith("http") ? p : BASE + p.replace(/^\//, ""))
  for (const [k, v] of Object.entries(params ?? {})) if (v !== undefined && v !== null) url.searchParams.set(k, v)
  for (let attempt = 0; attempt < 5; attempt++) {
    await slot()
    try {
      const response = await fetch(url, { headers: { Authorization: `Token ${token}`, Accept: "application/json" } })
      const text = await response.text()
      if (response.status === 429 || (response.status >= 500 && attempt < 4)) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
        continue
      }
      let json
      try {
        json = JSON.parse(text)
      } catch {
        json = { __raw: text.slice(0, 300) }
      }
      return { status: response.status, json }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    } finally {
      release()
    }
  }
  return { status: "ERR", json: null }
}

/** Every row of a paginated list ({count, next, results}) or a plain array / object. */
async function getAll(p, params = {}, pageSize = 500) {
  const first = await get(p, { ...params, page_size: pageSize, page: 1 })
  if (first.status !== 200) return { status: first.status, error: first.json }
  const j = first.json
  if (Array.isArray(j)) return { status: 200, rows: j, count: j.length }
  if (!j || !Array.isArray(j.results)) return { status: 200, object: j }
  const rows = [...j.results]
  const pages = Math.ceil((j.count || rows.length) / (j.results.length || pageSize))
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => get(p, { ...params, page_size: pageSize, page: i + 2 })))
  for (const r of rest) {
    if (r.status !== 200 || !Array.isArray(r.json?.results)) return { status: r.status, rows, count: j.count, error: "a page failed" }
    rows.push(...r.json.results)
  }
  return { status: 200, rows, count: j.count }
}

const save = (name, data) => fs.writeFileSync(path.join(RAW, `${name}.json`), JSON.stringify({ fetched: new Date().toISOString(), ...data }))
const load = (name) => JSON.parse(fs.readFileSync(path.join(RAW, `${name}.json`), "utf8")).data
const fill = (params) => JSON.parse(JSON.stringify(params ?? {}).replaceAll("{today}", DAY).replaceAll("{year_end}", `${DAY.slice(0, 4)}-12-31`))

// --- steps -----------------------------------------------------------------------------------------------------------

const manifest = JSON.parse(fs.readFileSync(new URL("./fetch-manifest.json", import.meta.url), "utf8"))

async function lists() {
  for (const m of manifest.lists) {
    const params = fill(m.params)
    const r = await getAll(m.path, params, m.pageSize || 500)
    save(m.name, { path: m.path, params, count: r.count, data: r.rows ?? r.object ?? r.error ?? null })
    console.log(m.name.padEnd(36), r.status, r.count ?? (r.rows ? r.rows.length : ""), r.error ? JSON.stringify(r.error).slice(0, 80) : "")
  }
}

async function details() {
  for (const d of manifest.details) {
    const rows = load(d.list)
    const out = {}
    let failed = 0
    await Promise.all(
      rows.map(async (row) => {
        const r = await get(d.path.replace("{id}", row.id))
        if (r.status === 200) out[row.id] = r.json
        else {
          failed++
          out[row.id] = { __status: r.status }
        }
      }),
    )
    save(`${d.list}_detail`, { tpl: d.path, data: out })
    console.log(`${d.list}_detail`.padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
  }
}

/** Return documents Linko answers 500 for: their lines from sales/order_return_product/?order_return=<id>. */
async function returnsPatch() {
  const doc = JSON.parse(fs.readFileSync(path.join(RAW, "order_returns_detail.json"), "utf8"))
  const list = load("order_returns")
  const orderOf = new Map(load("order_products").map((line) => [line.id, line.order_id]))
  for (const [id, value] of Object.entries(doc.data)) {
    if (!value.__status) continue
    const head = list.find((row) => String(row.id) === id)
    const r = await getAll("sales/order_return_product/", { order_return: id })
    const products = (r.rows ?? []).map((p) => ({ id: p.id, price: Number(p.cost), product: p.product, order_product: p.order_product_id, amount: p.amount, order: orderOf.get(p.order_product_id) ?? null }))
    doc.data[id] = { ...head, order: products[0]?.order ?? null, returned_products: products, __patched: "order_return_product" }
    console.log("return", id, "lines", products.length)
  }
  fs.writeFileSync(path.join(RAW, "order_returns_detail.json"), JSON.stringify(doc))
}

/** Products made by the production stages (the list answers 500 for some records: per stage, then one by one). */
async function manufactureReturns() {
  const rows = []
  const failed = []
  for (const stage of load("manufacturings").map((m) => m.id)) {
    const all = await get("manufacture/manufacture_return/", { manufacture: stage, page_size: 100 })
    if (all.status === 200) {
      rows.push(...all.json.results.map((x) => ({ ...x, manufacture: x.manufacture ?? stage })))
      continue
    }
    for (let page = 1; page <= 500; page++) {
      const one = await get("manufacture/manufacture_return/", { manufacture: stage, page_size: 1, page })
      if (one.status === 404) break
      if (one.status !== 200) failed.push({ stage, page, status: one.status })
      else rows.push(...one.json.results.map((x) => ({ ...x, manufacture: x.manufacture ?? stage })))
    }
  }
  save("manufacture_returns", { path: "manufacture/manufacture_return/", failed, data: rows })
  console.log("manufacture_returns", rows.length, failed.length ? `Linko failed ${failed.length}` : "")
}

function months(fromYear = 2024) {
  const out = []
  const [y1, m1] = DAY.split("-").map(Number)
  for (let y = fromYear, m = 1; y < y1 || (y === y1 && m <= 12); m === 12 ? (y++, (m = 1)) : m++) out.push([y, m])
  return out.filter(([y, m]) => y < y1 || m <= Math.min(12, m1 + 1))
}

async function attendance() {
  const out = {}
  await Promise.all(
    months().map(async ([y, m]) => {
      const r = await get("staff/attendance/", { year: y, month: m })
      out[`${y}-${String(m).padStart(2, "0")}`] = r.status === 200 ? r.json : { __status: r.status }
    }),
  )
  save("attendance_months", { path: "staff/attendance/?year&month", data: out })
  console.log("attendance_months", Object.keys(out).length)
}

async function monthLists() {
  const defs = {
    salary: ["staff/salary/", (y, m) => ({ year: y, month: m, is_approved: "all" })],
    branch_performance: ["staff/branch_performance/", (y, m) => ({ year: y, month: m })],
    quiz_plan: ["main/quiz_plan/", (y, m) => ({ year: y, month: m, is_approved: "all" })],
    staff_balance: ["staff/staff_balance/", (y, m) => ({ year: y, month: m })],
    kpi_balance: ["staff/performance_indicator/balance/", (y, m) => ({ year: y, month: m })],
    // When Linko last recalculated the month's staff_balance («данные за»): import-kpi-balances.ts recomputes the
    // snapshot as of that moment.
    kpi_last_date: ["staff/staff_balance/last_date/", (y, m) => ({ year: y, month: m })],
  }
  for (const [name, [p, params]] of Object.entries(defs)) {
    const out = {}
    await Promise.all(
      months().map(async ([y, m]) => {
        const r = await getAll(p, params(y, m))
        out[`${y}-${String(m).padStart(2, "0")}`] = r.status === 200 ? (r.rows ?? r.object) : { __status: r.status }
      }),
    )
    save(`${name}_months`, { path: p, data: out })
    console.log(`${name}_months`, Object.keys(out).length)
  }
}

async function employees() {
  return [...load("employees_active"), ...load("employees_inactive")]
}

/** Each employee's own card (main/crud/<id>/): the list answers leave out «Показывать в отслеживании»
 * (track_the_plan), which decides who the field pages list (Активность, Анализ маршрутов, Отслеживание).
 * Deleted employees too (employees_inactive), and the users Linko still tracks (agents_location). */
async function employeeDetails() {
  const ids = new Set([...(await employees()).map((e) => e.id), ...load("agents_location").map((a) => a.id)])
  const out = {}
  let failed = 0
  await Promise.all(
    [...ids].map(async (id) => {
      const r = await get(`main/crud/${id}/`)
      if (r.status === 200) out[id] = r.json
      else {
        failed++
        out[id] = { __status: r.status }
      }
    }),
  )
  save("employees_detail", { tpl: "main/crud/{id}/", data: out })
  console.log("employees_detail".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

async function gps() {
  fs.mkdirSync(path.join(RAW, "gps"), { recursive: true })
  for (const e of await employees()) {
    const head = await get("market/location/", { page_size: 1, user: e.id })
    if (!head.json?.count) continue
    const r = await getAll("market/location/", { user: e.id }, 2000)
    fs.writeFileSync(
      path.join(RAW, "gps", `${e.id}.json`),
      JSON.stringify({ path: "market/location/", params: { user: e.id }, fetched: new Date().toISOString(), count: r.count, data: (r.rows ?? []).map((p) => ({ id: p.id, lat: p.point?.lat, lon: p.point?.lon, battery: p.battery, gps: p.gps, created: p.created_date, registered: p.registered_date })) }),
    )
    console.log("gps", e.id, (r.rows ?? []).length)
  }
}

async function visitSessions() {
  const out = []
  const range = { stat_key: "market_service_time", begin_date: "2020-01-01", end_date: `${DAY.slice(0, 4)}-12-31` }
  await Promise.all(
    (await employees()).map(async (e) => {
      const r = await get("stats/dynamic/get/", { ...range, user: e.id })
      for (const row of r.json?.data ?? []) out.push({ ...row, user_id: e.id })
    }),
  )
  save("visit_sessions", { path: "stats/dynamic/get/?stat_key=market_service_time&user=<id>", count: out.length, data: out })
  console.log("visit_sessions", out.length)
}

async function financeEntities() {
  const range = { begin_date: "2020-01-01", end_date: `${DAY.slice(0, 4)}-12-31` }
  const vansell = {}
  for (const u of load("fin_vansell_balance")) {
    const r = await getAll(`staff/balance/${u.id}/transactions/`, range)
    vansell[u.id] = r.rows ?? { status: r.status }
  }
  save("fin_vansell_transactions", { data: vansell })
  const branches = {}
  await Promise.all(load("branches").map(async (b) => {
    const r = await getAll(`main/branch/${b.id}/transactions/`, range)
    branches[b.id] = r.rows ?? { status: r.status }
  }))
  save("fin_branch_transactions", { data: branches })
  const salary = {}
  await Promise.all(load("fin_salary_balance").map(async (u) => {
    const r = await get("staff/salary_balance/act/", { user: u.id, ...range })
    salary[u.id] = r.status === 200 ? r.json : { status: r.status }
  }))
  save("fin_salary_acts", { data: salary })
  const providers = {}
  await Promise.all(load("providers").map(async (p) => {
    const r = await get("finance/provider_transactions/act/", { provider: p.id, ...range })
    providers[p.id] = r.status === 200 ? r.json : { status: r.status }
  }))
  save("fin_provider_acts", { data: providers })
  console.log("finance entities: van-sell", Object.keys(vansell).length, "branches", Object.keys(branches).length, "employees", Object.keys(salary).length, "suppliers", Object.keys(providers).length)
}

async function cashbackDetails() {
  const out = {}
  await Promise.all(load("cash_backs").filter((x) => x.last_created).map(async (x) => {
    const r = await getAll(`sales/cash_back/${x.id}/detail/`, {})
    out[x.id] = r.rows ?? { status: r.status }
  }))
  save("fin_cashback_details", { data: out })
  console.log("fin_cashback_details", Object.keys(out).length)
}

/** Prices of every product in every price list. Linko's paged list (sales/price_list_item/) answers 500 for some pages
 * (≈340 of its rows break its serializer), so the items are read product by product, where every row comes back. */
async function priceListItems() {
  const items = []
  const failed = []
  await Promise.all(
    load("products").map(async (product) => {
      const r = await getAll("sales/price_list_item/", { product: product.id }, 200)
      if (r.rows) items.push(...r.rows)
      if (r.status !== 200 || r.error) failed.push(product.id)
    }),
  )
  items.sort((a, b) => a.id - b.id)
  save("price_list_items", { path: "sales/price_list_item/?product=<id>", count: items.length, failedProducts: failed, data: items })
  console.log("price_list_items".padEnd(36), items.length, failed.length ? `failed products ${failed.join(",")}` : "")
}

/** «Логи» of every transfer between warehouses (stock/stock_transfer/{id}/logs/: who created, gave and accepted it). */
async function transferLogs() {
  const out = {}
  let failed = 0
  await Promise.all(
    load("stock_transfers").map(async (row) => {
      const r = await get(`stock/stock_transfer/${row.id}/logs/`)
      if (r.status === 200) out[row.id] = r.json
      else {
        failed++
        out[row.id] = { __status: r.status }
      }
    }),
  )
  save("stock_transfers_logs", { tpl: "stock/stock_transfer/{id}/logs/", data: out })
  console.log("stock_transfers_logs".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

// Заказы → card → «Список оплат по заказу»: each order's debt transactions (import-order-payment-lines.mjs).
async function orderDebtTransactions() {
  const out = {}
  let failed = 0
  await Promise.all(
    load("orders").map(async (row) => {
      const r = await getAll("sales/debt_transactions/", { order: row.id })
      if (r.status === 200 && r.rows) out[row.id] = r.rows
      else {
        failed++
        out[row.id] = { __status: r.status }
      }
    }),
  )
  save("order_debt_transactions", { tpl: "sales/debt_transactions/?order={id}", data: out })
  console.log("order_debt_transactions".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

// Возвраты → card → «Логи»: each client return's history (import-return-logs.mjs), in the order Linko answers it.
async function returnLogs() {
  const out = {}
  let failed = 0
  await Promise.all(
    load("order_returns").map(async (row) => {
      const r = await getAll("sales/order_return_logs/", { order_return: row.id })
      if (r.status === 200 && r.rows) out[row.id] = r.rows
      else {
        failed++
        out[row.id] = { __status: r.status }
      }
    }),
  )
  save("order_return_logs", { tpl: "sales/order_return_logs/?order_return={id}", data: out })
  console.log("order_return_logs".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

// Возвраты → card → «Список товаров» → green «+»: each returned line's marking codes (import-return-marks.mjs), per
// return in Linko's line order. Reads order_returns_detail.json, so it runs after details and returns-patch.
async function returnMarks() {
  const detail = load("order_returns_detail")
  const out = {}
  let failed = 0
  let withMarks = 0
  await Promise.all(
    Object.entries(detail).map(async ([id, doc]) => {
      if (!Array.isArray(doc?.returned_products)) return
      out[id] = await Promise.all(
        doc.returned_products.map(async (p, index) => {
          const r = await get(`sales/order_return_product/${p.id}/get_marks/`)
          const marks = Array.isArray(r.json) ? r.json : Array.isArray(r.json?.results) ? r.json.results : null
          if (r.status !== 200 || !marks) failed++
          else if (marks.length) withMarks++
          return { index, returned_product: p.id, product_id: p.product?.id ?? null, amount: p.amount, status: r.status, marks }
        }),
      )
    }),
  )
  save("order_return_marks", { tpl: "sales/order_return_product/{id}/get_marks/", data: out })
  console.log("order_return_marks".padEnd(36), Object.keys(out).length, `lines with codes ${withMarks}`, failed ? `Linko failed ${failed}` : "")
}

// Территория: the employees bound to each territory («Привязать агента»), only on the border's detail.
async function borderAgents() {
  const out = {}
  let failed = 0
  await Promise.all(
    load("borders").map(async (row) => {
      const r = await get(`market/border/${row.id}/`)
      if (r.status === 200) {
        out[row.id] = (r.json?.properties?.agents ?? []).map((agent) => ({ id: agent.id, first_name: agent.first_name, second_name: agent.second_name, position: agent.position }))
      } else {
        failed++
        out[row.id] = { __status: r.status }
      }
    }),
  )
  save("border_agents", { tpl: "market/border/{id}/", data: out })
  console.log("border_agents".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

/** «Агенты магазина» of every shop (its agents, each with a comment and price lists): only on the shop's detail with its
 * extra message (market/market/{id}/?with_extra_message=1 → extra_message.market_users). Shops without any are left out. */
function slimMarketUsers(users) {
  return (Array.isArray(users) ? users : []).map((item) => ({
    id: item.id,
    user: { id: item.user?.id, first_name: item.user?.first_name ?? "", second_name: item.user?.second_name ?? "" },
    description: item.description ?? "",
    price_lists: (item.price_lists ?? []).map((list) => ({ id: list.id, name: list.name ?? "" })),
  }))
}

async function marketUsers() {
  const out = {}
  // The detail also carries the days the list leaves out: last_visit_date (and last_order_date) → market_activity.
  const activity = {}
  let failed = 0
  await Promise.all(
    load("markets").map(async (row) => {
      const r = await get(`market/market/${row.id}/`, { with_extra_message: 1 })
      if (r.status !== 200) {
        failed++
        out[row.id] = { __status: r.status }
        return
      }
      const users = slimMarketUsers(r.json?.extra_message?.market_users)
      if (users.length) out[row.id] = users
      activity[row.id] = { last_order_date: r.json?.last_order_date ?? null, last_visit_date: r.json?.last_visit_date ?? null }
    }),
  )
  save("market_users", { tpl: "market/market/{id}/?with_extra_message=1", data: out })
  save("market_activity", { tpl: "market/market/{id}/?with_extra_message=1", data: activity })
  console.log("market_users".padEnd(36), Object.keys(out).length, failed ? `Linko failed ${failed}` : "")
}

// Время работы агента «Задачи»: the tasks of every agent-day of Linko's report (fetch-day-plans.mjs).
async function dayPlans() {
  save("day_plans", { tpl: "market/agent_plans/{agent}/?date={day}", data: await fetchDayPlans(get, months()) })
}

// --- extras: the inputs of the capture-based importers ---------------------------------------------------------------
// The first account (time3) got these files from read-only captures of Linko's screens (the SPA's own GET answers, in
// backups/linko-raw/2026-11-19 and 2026-11-20). These steps GET the same endpoints and write the same file at the same
// path below RAW (RAW/<path>: where import-*.mjs reads it when RAW is set), each in the layout its importer reads. They
// loop over the ids of the lists already in RAW. A list is written only when every page of it came back; in an
// {id: answer} file the ids Linko failed for are left out and printed.

const now = () => new Date().toISOString()

/** Writes RAW/<relPath> with the body exactly as given (no {fetched, data} wrapper unless the body has one). */
function saveCapture(relPath, body) {
  const file = path.join(RAW, relPath)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(body))
}

const inRawFile = (name) => fs.existsSync(path.join(RAW, `${name}.json`))

/** Whether a list file's `data` is complete: an array (the lists step saves Linko's error object, or null, when Linko
 * failed for the list); `months`: an object of month lists (salary_months). */
const isList = (data, months = false) => (months ? Boolean(data) && typeof data === "object" && !Array.isArray(data) : Array.isArray(data))

/** The `data` of a list already in RAW, or null: the step says which file it lacks (or that Linko failed for it) and
 * writes nothing. */
function needRaw(name, step, { months = false } = {}) {
  if (!inRawFile(name)) {
    console.log(`${step}: skipped, ${name}.json is not in ${RAW} (run the step that downloads it first)`)
    return null
  }
  const data = load(name)
  if (isList(data, months)) return data
  console.log(`${step}: skipped, ${name}.json is not a complete list (Linko failed for it: run the step that downloads it again)`)
  return null
}

/** The rows of an optional list in RAW: [] when it is not there; a list Linko failed for is reported and left out. */
function optionalList(name, step) {
  if (!inRawFile(name)) return []
  const data = load(name)
  if (isList(data)) return data
  console.log(`${step}: ${name}.json is not a complete list (Linko failed for it), its rows are left out`)
  return []
}

/** The rows of an answer: a plain array or a page's results; null for anything else. */
const rowsOf = (json) => (Array.isArray(json) ? json : Array.isArray(json?.results) ? json.results : null)

/** Every row of a list ({rows, count}), or null when Linko failed for it or for one of its pages. */
async function allRows(p, params = {}, pageSize = 500) {
  const r = await getAll(p, params, pageSize)
  return r.status === 200 && !r.error && Array.isArray(r.rows) ? { rows: r.rows, count: r.count ?? r.rows.length } : null
}

/** All pages of a list as the one page Linko answers ({count, next, previous, results}), or null. */
async function onePage(p, params, pageSize = 1000) {
  const list = await allRows(p, params, pageSize)
  return list && { count: list.count, next: null, previous: null, results: list.rows }
}

/** One GET per id, MAX at a time: { ok: {id: answer}, failed: [id] }. `pick` keeps a part of an answer (null = failed). */
async function eachId(ids, pathOf, { params, pick = (json) => json } = {}) {
  const ok = {}
  const failed = []
  await Promise.all(
    [...new Set(ids.map(Number).filter((id) => id > 0))].map(async (id) => {
      const r = await get(pathOf(id), params?.(id))
      const value = r.status === 200 && r.json && !r.json.__raw ? pick(r.json) : null
      if (value == null) failed.push(id)
      else ok[id] = value
    }),
  )
  return { ok, failed: failed.sort((a, b) => a - b) }
}

const report = (file, count, failed = []) =>
  console.log(file.padEnd(44), count, failed.length ? `Linko failed ${failed.length}: ${failed.slice(0, 30).join(",")}${failed.length > 30 ? " …" : ""}` : "")

// База знания (import-knowledge-base.mjs): main/knowledge/ as the #/knowledge-base screen reads it.
async function knowledgeBase() {
  const file = "knowledge-base/knowledge.json"
  const list = await allRows("main/knowledge/")
  if (!list) return report(file, "Linko failed, not written")
  saveCapture(file, { path: "main/knowledge/", params: {}, fetched: now(), count: list.count, data: list.rows })
  report(file, list.rows.length)
}

// Управления кассой (import-cash-list-facts.mjs): the list's own=True rows and the unverified transactions (the clock
// badge), which the own=True list leaves out. Both or neither: the importer reads the two together.
async function financeCash() {
  const lists = [
    ["cash_transactions_live", "finance/transaction/", { own: "True" }],
    ["unverified_transactions", "finance/transaction/unverified_transactions/", {}],
  ]
  const got = await Promise.all(lists.map(([, p, params]) => allRows(p, params)))
  if (got.some((list) => !list)) return report("finance-cash/", "Linko failed, not written")
  const fetched = now()
  lists.forEach(([name, p, params], index) => {
    const query = new URLSearchParams(params).toString()
    saveCapture(`finance-cash/${name}.json`, { path: query ? `${p}?${query}` : p, fetched, count: got[index].count, data: got[index].rows })
    report(`finance-cash/${name}.json`, got[index].rows.length)
  })
}

// Передачи между складами → «Показать отмененные передачи» (import-cancelled-transfers.mjs): the list with the cancelled
// transfers, each cancelled transfer's card and its «Логи».
async function stockTransfersCancelled() {
  const dir = "stock-transfers-cancelled"
  const params = { with_cancelled: "true" }
  const list = await allRows("stock/stock_transfer/", params, 100)
  if (!list) return report(`${dir}/`, "Linko failed, not written")
  const ids = list.rows.filter((row) => row.status === "cancelled" || row.status === "canceled").map((row) => row.id)
  const [details, logs] = await Promise.all([
    eachId(ids, (id) => `stock/stock_transfer/${id}/`),
    eachId(ids, (id) => `stock/stock_transfer/${id}/logs/`, { pick: rowsOf }),
  ])
  const fetched = now()
  saveCapture(`${dir}/stock_transfers.json`, { path: "stock/stock_transfer/", params, fetched, count: list.count, data: list.rows })
  saveCapture(`${dir}/stock_transfers_detail.json`, { tpl: "stock/stock_transfer/{id}/", fetched, data: details.ok })
  saveCapture(`${dir}/stock_transfers_logs.json`, { tpl: "stock/stock_transfer/{id}/logs/", fetched, data: logs.ok })
  report(`${dir}/stock_transfers_detail.json`, Object.keys(details.ok).length, details.failed)
  report(`${dir}/stock_transfers_logs.json`, Object.keys(logs.ok).length, logs.failed)
}

// Интеграция → draft card (import-draft-orders.mjs): sales/draft_order/<id>/ of every draft (its product lines).
async function draftOrderDetails() {
  const file = "draft_order_details.json"
  const list = needRaw("draft_orders", file)
  if (!list) return
  const { ok, failed } = await eachId(list.map((row) => row.id), (id) => `sales/draft_order/${id}/`)
  saveCapture(file, { path: "sales/draft_order/{id}/", fetched: now(), data: ok })
  report(file, Object.keys(ok).length, failed)
}

// Бонусы клиентов (import-client-bonuses.mjs): each client's bonus dialog (all its entries), for every client Linko's
// list gives a last entry (a client without one has none).
async function clientPromotionDetails() {
  const file = "client_promotion_details.json"
  const list = needRaw("client_promotions", file)
  if (!list) return
  const out = {}
  const failed = []
  await Promise.all(
    list
      .filter((row) => row.last_created)
      .map(async (row) => {
        const entries = await allRows(`sales/client_promotion/${row.id}/detail/`, {}, 100)
        if (entries) out[row.id] = entries.rows
        else failed.push(row.id)
      }),
  )
  saveCapture(file, { path: "sales/client_promotion/{id}/detail/", params: { page_size: 100 }, fetched: now(), data: out })
  report(file, Object.keys(out).length, failed.sort((a, b) => a - b))
}

// Зарплата и установка планов → row card (import-salary-cards.mjs): staff/salary/<id>/ of every salary record of the
// month lists (step "months"), with the record's year and month as the card page asks for it.
async function salaryCards() {
  const file = "salary_cards.json"
  const months = needRaw("salary_months", file, { months: true })
  if (!months) return
  const missingMonths = Object.entries(months).filter(([, rows]) => !Array.isArray(rows)).map(([month]) => month)
  if (missingMonths.length) console.log(`${file}: the month lists Linko failed for are not covered: ${missingMonths.join(", ")}`)
  const rows = new Map(Object.values(months).filter(Array.isArray).flat().map((row) => [Number(row.id), row]))
  const { ok, failed } = await eachId([...rows.keys()], (id) => `staff/salary/${id}/`, { params: (id) => ({ year: rows.get(id).year, month: rows.get(id).month }) })
  saveCapture(file, { fetched: now(), path: "staff/salary/<id>/?year&month", data: ok })
  report(file, Object.keys(ok).length, failed)
}

// Продукты / Сырье → card (import-product-cards.mjs, import-raw-cards.mjs): main/product/<id>/ of every product, raw
// material and deleted product ({id: card}, no wrapper), and the «Удалённые» tab's list (show_deleted=true, as Linko's
// page answer: {count, next, previous, results}; only its deleted rows are kept).
async function productDetail() {
  const file = "product-detail/products_detail.json"
  const products = needRaw("products", file)
  if (!products) return
  const deleted = await allRows("main/product/", { show_deleted: "true" })
  const deletedRows = deleted ? deleted.rows.filter((row) => row.is_delete === true) : []
  const lists = ["products_raw", "products_notraw"].flatMap((name) => optionalList(name, file))
  const { ok, failed } = await eachId([...products, ...lists, ...deletedRows].map((row) => row.id), (id) => `main/product/${id}/`)
  saveCapture(file, ok)
  report(file, Object.keys(ok).length, failed)
  if (!deleted) return report("product-detail/products_show_deleted.json", "Linko failed, not written")
  saveCapture("product-detail/products_show_deleted.json", { count: deletedRows.length, next: null, previous: null, results: deletedRows })
  report("product-detail/products_show_deleted.json", `${deletedRows.length} deleted (Linko answered ${deleted.rows.length} rows)`)
}

// Заказы (import-order-filter-facts.mjs, import-order-line-returns.mjs): the whole order list as the Заказы screen asks
// for it (status=&exclude=true, saved under that query), each order's card (sales/order/<id>/: order-details.json, and
// one file per order, order-cards/sales_order_<id>_.json, as the order card captures were saved) and the cards of the
// products on the orders' lines (product-details.json; taken from product-detail/products_detail.json when it has them).
async function salesOrdersList() {
  const dir = "sales-orders-list"
  const list = await allRows("sales/order/", { status: "", exclude: "true" })
  const known = optionalList("orders", `${dir}/`)
  if (!list && !known.length) return report(`${dir}/`, "Linko failed, not written")
  if (list) saveCapture(`${dir}/ids-linko.json`, { "status=&exclude=true": list.rows })
  report(`${dir}/ids-linko.json`, list ? list.rows.length : "Linko failed, not written")

  const orders = await eachId([...(list?.rows ?? []), ...known].map((row) => row.id), (id) => `sales/order/${id}/`, { pick: (json) => (json.id ? json : null) })
  saveCapture(`${dir}/order-details.json`, orders.ok)
  for (const [id, card] of Object.entries(orders.ok)) saveCapture(`order-cards/sales_order_${id}_.json`, card)
  report(`${dir}/order-details.json + order-cards/`, Object.keys(orders.ok).length, orders.failed)

  const productIds = [...new Set(Object.values(orders.ok).flatMap((card) => (card.products ?? []).map((line) => Number(line.product?.id ?? line.product))))].filter((id) => id > 0)
  const cardsFile = path.join(RAW, "product-detail", "products_detail.json")
  const cardsInRaw = fs.existsSync(cardsFile) ? JSON.parse(fs.readFileSync(cardsFile, "utf8")) : {}
  const more = await eachId(productIds.filter((id) => !cardsInRaw[id]?.id), (id) => `main/product/${id}/`)
  const cards = {}
  for (const id of productIds.sort((a, b) => a - b)) {
    const card = cardsInRaw[id]?.id ? cardsInRaw[id] : more.ok[id]
    if (card) cards[id] = card
  }
  saveCapture(`${dir}/product-details.json`, cards)
  report(`${dir}/product-details.json`, Object.keys(cards).length, more.failed)
}

// Карточка клиента → ЗАДАЧИ, КЛИЕНТ → ДЕТАЛИ / ЛОГИ (import-shop-drawer.mjs, import-shop-closed.mjs, import-shop-state.mjs,
// import-series.mjs): what fetch-shop-drawer.mjs reads for each shop of markets.json, all pages of each list —
// market/market/<id>/?with_extra_message=1&with_plan=1&detail_gear=true, its detail_plans, its market_logs and
// market_logs?type=<t> of each type it has twice or more — into shop_drawer.json ({data: {shopId: {market, plans, logs,
// logsByType}}}). Progress goes to shop_drawer.json.part (no importer reads it): a run stopped half-way continues from it.
async function shopDrawer() {
  const file = "shop_drawer.json"
  const markets = needRaw("markets", file)
  if (!markets) return
  const partFile = path.join(RAW, `${file}.part`)
  const out = fs.existsSync(partFile)
    ? JSON.parse(fs.readFileSync(partFile, "utf8"))
    : { path: "market/market/{id}/ + detail_plans + market_logs (+ ?type=) (shop drawer)", fetched: now(), data: {} }
  const todo = markets.map((market) => Number(market.id)).filter((id) => !out.data[id] || out.data[id].error)
  console.log(`${file}: ${todo.length} shops to read${Object.keys(out.data).length ? ` (continuing ${path.basename(partFile)})` : ""}`)
  let done = 0
  await Promise.all(
    todo.map(async (id) => {
      const [market, plans, logs] = await Promise.all([
        get(`market/market/${id}/`, { with_extra_message: 1, with_plan: 1, detail_gear: "true" }),
        onePage(`market/market/${id}/detail_plans/`),
        onePage("market/market_logs/", { market: id }),
      ])
      let complete = market.status === 200 && Number(market.json?.id) === id && Boolean(plans && logs)
      const logsByType = {}
      if (complete) {
        const counts = {}
        for (const log of logs.results) counts[log.type] = (counts[log.type] ?? 0) + 1
        for (const type of ["order", "order_return", "client_transaction", "market"]) {
          if ((counts[type] ?? 0) < 2) continue
          const page = await onePage("market/market_logs/", { market: id, type })
          if (page) logsByType[type] = page
          else complete = false
        }
      }
      out.data[id] = complete ? { market: market.json, plans, logs, logsByType } : { error: "incomplete" }
      if (++done % 200 === 0) {
        fs.writeFileSync(partFile, JSON.stringify(out))
        console.log(`${file}: ${done}/${todo.length}`)
      }
    }),
  )
  saveCapture(file, out)
  fs.rmSync(partFile, { force: true })
  report(file, Object.keys(out.data).length, Object.entries(out.data).filter(([, entry]) => entry.error).map(([id]) => Number(id)))
}

const EXTRAS = {
  "knowledge-base": knowledgeBase,
  "finance-cash": financeCash,
  "stock-transfers-cancelled": stockTransfersCancelled,
  "draft-order-details": draftOrderDetails,
  "client-promotion-details": clientPromotionDetails,
  "salary-cards": salaryCards,
  // Before sales-orders-list, which takes the line products' cards from its file.
  "product-detail": productDetail,
  "sales-orders-list": salesOrdersList,
  "shop-drawer": shopDrawer,
}

const STEPS = {
  lists,
  "price-list-items": priceListItems,
  details,
  "returns-patch": returnsPatch,
  "manufacture-returns": manufactureReturns,
  attendance,
  "employee-details": employeeDetails,
  months: monthLists,
  gps,
  "visit-sessions": visitSessions,
  "finance-entities": financeEntities,
  "cashback-details": cashbackDetails,
  "transfer-logs": transferLogs,
  "return-logs": returnLogs,
  "order-debt-transactions": orderDebtTransactions,
  "return-marks": returnMarks,
  "border-agents": borderAgents,
  "market-users": marketUsers,
  "day-plans": dayPlans,
}

// Without arguments every step of STEPS (not the extras); "extras" stands for all of EXTRAS, in their order.
const ALL = { ...STEPS, ...EXTRAS }
const wanted = process.argv.slice(2).length ? process.argv.slice(2).flatMap((step) => (step === "extras" ? Object.keys(EXTRAS) : [step])) : Object.keys(STEPS)
for (const step of wanted) if (!ALL[step]) throw new Error(`Unknown step ${step}: ${Object.keys(ALL).join(", ")}, extras`)
await login()
markFolder(RAW, SERVER)
console.log(`Linko server ${SERVER} → ${RAW}`)
for (const step of wanted) {
  console.log(`== ${step}`)
  await ALL[step]()
}
console.log(`Raw data in ${RAW}`)
