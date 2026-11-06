// Downloads the data of a Linko account (read-only GET requests only) into backups/linko-raw/<YYYY-MM-DD>/ — the raw
// files the import-*.mjs scripts read. Nothing is ever written to Linko.
//
//   LINKO_SERVER=time3 LINKO_USER=admin LINKO_PASS=… node scripts/linko-sync/fetch.mjs            (everything)
//   … node scripts/linko-sync/fetch.mjs lists details returns-patch manufacture-returns           (some steps)
//
// Steps: lists (fetch-manifest.json "lists": every list, all pages, no filter), details (each document of a list),
// returns-patch (return documents Linko answers 500 for), manufacture-returns (per production stage), attendance,
// months (per-month salary / KPI / plan lists), gps (every employee's GPS points), visit-sessions (timed visits),
// finance-entities (van-sell / branch / employee / supplier acts), cashback-details.
// LINKO_TOKEN=… instead of LINKO_USER / LINKO_PASS reuses an existing session token. RAW=<folder> writes elsewhere.
// The raw files hold business data: backups/ is git-ignored, never commit them.
import fs from "node:fs"
import path from "node:path"
import { ROOT } from "./lib.mjs"

const SERVER = process.env.LINKO_SERVER || "time3"
const BASE = `https://${SERVER}.linko.uz/ru/api/v1/`
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date())
const RAW = process.env.RAW || path.join(ROOT, "backups", "linko-raw", DAY)
const MAX = Number(process.env.MAXC || 4)
fs.mkdirSync(RAW, { recursive: true })

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
  if (!response.ok || !token) throw new Error(`Linko sign-in failed (${response.status})`)
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

const STEPS = {
  lists,
  details,
  "returns-patch": returnsPatch,
  "manufacture-returns": manufactureReturns,
  attendance,
  months: monthLists,
  gps,
  "visit-sessions": visitSessions,
  "finance-entities": financeEntities,
  "cashback-details": cashbackDetails,
}

await login()
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(STEPS)
for (const step of wanted) {
  if (!STEPS[step]) throw new Error(`Unknown step ${step}: ${Object.keys(STEPS).join(", ")}`)
  console.log(`== ${step}`)
  await STEPS[step]()
}
console.log(`Raw data in ${RAW}`)
