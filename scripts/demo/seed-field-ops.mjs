// DEMO data for the field-operations domain (visits, agent routes, KPI plans,
// tasks, survey plans, holidays). INSERT-only and idempotent: each section is
// skipped when its rows were already seeded. Every inserted row is registered
// in demo_seed_rows(domain = 'field-ops') so scripts/demo/rollback-field-ops.mjs
// can remove exactly this data.
//
//   node scripts/demo/seed-field-ops.mjs
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const require = createRequire(path.join(root, "package.json"))
const pg = require("pg")

const DOMAIN = "field-ops"
const url = process.env.DATABASE_URL ?? fs.readFileSync(path.join(root, ".env"), "utf8").match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim()
if (!url) throw new Error("DATABASE_URL is not set")
const db = new pg.Client({ connectionString: url })
await db.connect()

// ---------- deterministic PRNG ----------
let state = 20261023
function rnd() {
  state |= 0
  state = (state + 0x6d2b79f5) | 0
  let t = Math.imul(state ^ (state >>> 15), 1 | state)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1))
const pick = (list) => list[Math.floor(rnd() * list.length)]
const pad = (n) => String(n).padStart(2, "0")
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d, sec) => `${iso(d)} ${pad(Math.floor(sec / 3600))}:${pad(Math.floor((sec % 3600) / 60))}:${pad(sec % 60)}`

// ---------- schema (same DDL the app's repos use) ----------
await db.query(`CREATE TABLE IF NOT EXISTS demo_seed_rows (table_name text NOT NULL, row_id text NOT NULL, domain text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`)
await db.query(`CREATE TABLE IF NOT EXISTS agent_visits (
  id SERIAL PRIMARY KEY,
  agent TEXT NOT NULL,
  client TEXT NOT NULL DEFAULT '',
  client_id INTEGER,
  visit_date TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  result TEXT NOT NULL DEFAULT 'visit',
  refusal_type TEXT NOT NULL DEFAULT '',
  order_id INTEGER,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  planned INTEGER NOT NULL DEFAULT 1,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
)`)
await db.query(`CREATE INDEX IF NOT EXISTS agent_visits_date_idx ON agent_visits (visit_date, agent)`)
await db.query(`CREATE TABLE IF NOT EXISTS branch_kpi_indicator_rules (
  id SERIAL PRIMARY KEY, indicator_id INTEGER NOT NULL UNIQUE, bonus_fund DOUBLE PRECISION NOT NULL DEFAULT 0,
  levels TEXT NOT NULL DEFAULT '[]', updated_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), updated_at TEXT NOT NULL DEFAULT to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)

const seeded = async (table) => (await db.query(`SELECT 1 FROM demo_seed_rows WHERE domain = $1 AND table_name = $2 LIMIT 1`, [DOMAIN, table])).rowCount > 0
const register = async (table, ids) => {
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500)
    await db.query(
      `INSERT INTO demo_seed_rows (table_name, row_id, domain) SELECT $1, x, $2 FROM unnest($3::text[]) AS x`,
      [table, DOMAIN, chunk.map(String)],
    )
  }
}
const counts = {}

// ---------- reference data ----------
const TODAY = new Date(2026, 9, 23) // the demo's "today" (22 Oct 2026 in the reference)
const HISTORY_FROM = new Date(2026, 6, 1)
const refusals = (await db.query(`SELECT name FROM refusal_types WHERE id IN (1,2,3,4,5,6,13,14) ORDER BY id`)).rows.map((r) => r.name)
const usdRate = Number((await db.query(`SELECT rate FROM currencies WHERE code='USD'`)).rows[0]?.rate ?? 12500)
const eurRate = Number((await db.query(`SELECT rate FROM currencies WHERE code='EUR'`)).rows[0]?.rate ?? 14658)
const AGENTS = [
  "Admin Ritm", "xodim2 1", "agent TIMUR 007", "Тп 2 Алиса", "Salohiddin Agent Tashkent", "Шохрух Туляганов",
  "Temur Raupov", "Тп 1 Исмоилов Гани", "Samandar Abdurahmonov", "Karim Karimov", "feruz bobokulov Bobokulov",
]
const clientsByAgent = {}
for (const agent of AGENTS) {
  const rows = (
    await db.query(
      `SELECT id, name, location_lat AS lat, location_lng AS lng FROM clients WHERE agent = $1 AND name <> '' ORDER BY id LIMIT 400`,
      [agent],
    )
  ).rows
  clientsByAgent[agent] = rows
}

function parseAmount(text) {
  const m = String(text ?? "").trim().match(/^([\d\s .,-]+)\s*([A-Za-zА-Яа-я]+)?$/)
  if (!m) return 0
  const n = Number.parseFloat(m[1].replace(/[\s ]/g, "").replace(",", "."))
  const cur = (m[2] || "SUM").toUpperCase()
  const k = cur === "USD" ? usdRate : cur.startsWith("EUR") ? eurRate : 1
  return Number.isFinite(n) ? Math.round(n * k) : 0
}

// ---------- agent_visits ----------
if (!(await seeded("agent_visits"))) {
  const visits = []
  const days = []
  for (let d = new Date(HISTORY_FROM); d < new Date(2026, 9, 22); d.setDate(d.getDate() + 1)) days.push(new Date(d))
  // Real orders become "visit with an order" so every order has a visit behind it.
  const orders = (await db.query(`SELECT id, agent, client, market_name, amount, created_at FROM orders WHERE created_at ~ '^\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2}:\\d{2}$'`)).rows
  const orderDayAgent = new Set()
  for (const o of orders) {
    const date = o.created_at.slice(0, 10)
    const [h, mi, s] = o.created_at.slice(11).split(":").map(Number)
    const lookup = clientsByAgent[o.agent]?.find((c) => c.name === (o.market_name || o.client))
    visits.push({
      agent: o.agent, client: o.market_name || o.client, client_id: lookup?.id ?? null, date,
      started: o.created_at, duration: int(120, 900), result: "order", refusal: "", order_id: o.id,
      amount: parseAmount(o.amount), planned: 1, lat: lookup?.lat ?? null, lng: lookup?.lng ?? null,
    })
    orderDayAgent.add(`${o.agent}|${date}`)
    void h; void mi; void s
  }
  for (const day of days) {
    const dow = day.getDay()
    if (dow === 0) continue // Sunday is a day off
    for (const agent of AGENTS) {
      const pool = clientsByAgent[agent]
      if (!pool?.length) continue
      if (rnd() < 0.1) continue // the agent did not come out that day
      const date = iso(day)
      const checkIn = rnd() < 0.72 ? int(7 * 3600 + 50 * 60, 8 * 3600 + 10 * 60) : int(8 * 3600 + 12 * 60, 9 * 3600 + 20 * 60)
      const n = Math.min(pool.length, int(6, 12))
      let clock = checkIn + int(15, 40) * 60
      const used = new Set()
      for (let i = 0; i < n; i++) {
        let client = pick(pool)
        for (let tries = 0; used.has(client.id) && tries < 6; tries++) client = pick(pool)
        used.add(client.id)
        const roll = rnd()
        const result = roll < 0.45 ? "order" : roll < 0.8 ? "visit" : "refusal"
        const duration = result === "order" ? int(240, 1200) : result === "visit" ? int(90, 420) : int(60, 240)
        visits.push({
          agent, client: client.name, client_id: client.id, date, started: stamp(day, clock), duration, result,
          refusal: result === "refusal" ? pick(refusals) : "", order_id: null,
          amount: result === "order" ? int(150, 6000) * 1000 : 0, planned: rnd() < 0.82 ? 1 : 0,
          lat: client.lat, lng: client.lng,
        })
        clock += duration + int(5, 20) * 60
      }
    }
  }
  // 22 and 23 Oct: exactly what the reference shows — one visit by Admin Ritm at 10:30.
  const tinchlik = (await db.query(`SELECT id, location_lat AS lat, location_lng AS lng FROM clients WHERE name = 'Tinchlik market' LIMIT 1`)).rows[0]
  for (const d of [new Date(2026, 9, 22), new Date(2026, 9, 23)]) {
    visits.push({
      agent: "Admin Ritm", client: "Tinchlik market", client_id: tinchlik?.id ?? null, date: iso(d), started: stamp(d, 10 * 3600 + 30 * 60),
      duration: 12, result: "visit", refusal: "", order_id: null, amount: 0, planned: 0, lat: tinchlik?.lat ?? null, lng: tinchlik?.lng ?? null,
    })
  }
  const ids = []
  for (let i = 0; i < visits.length; i += 400) {
    const chunk = visits.slice(i, i + 400)
    const params = []
    const values = chunk.map((v, k) => {
      params.push(v.agent, v.client, v.client_id, v.date, v.started, v.duration, v.result, v.refusal, v.order_id, v.amount, v.planned, v.lat, v.lng)
      const o = k * 13
      return `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9},$${o + 10},$${o + 11},$${o + 12},$${o + 13})`
    })
    const res = await db.query(
      `INSERT INTO agent_visits (agent, client, client_id, visit_date, started_at, duration_sec, result, refusal_type, order_id, amount, planned, lat, lng) VALUES ${values.join(",")} RETURNING id`,
      params,
    )
    ids.push(...res.rows.map((r) => r.id))
  }
  await register("agent_visits", ids)
  counts.agent_visits = ids.length
}

// ---------- agent_routes (per agent per day, aggregated from the visits above) ----------
if (!(await seeded("agent_routes"))) {
  const rows = (await db.query(`SELECT agent, visit_date, started_at, duration_sec, result, amount, planned, lat, lng FROM agent_visits ORDER BY agent, visit_date, started_at`)).rows
  const groups = new Map()
  for (const v of rows) {
    const key = `${v.agent}|${v.visit_date}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(v)
  }
  const ids = []
  for (const [key, list] of groups) {
    const [agent, date] = key.split("|")
    const isToday = date >= "2026-10-22"
    const agg = { rv: 0, re: 0, rr: 0, rs: 0, ov: 0, oe: 0, or: 0, os: 0 }
    for (const v of list) {
      const p = v.planned ? "r" : "o"
      agg[p + "v"] += 1
      if (v.result === "order") { agg[p + "e"] += 1; agg[p + "s"] += Number(v.amount) }
      if (v.result === "refusal") agg[p + "r"] += 1
    }
    const first = list[0]
    const last = list[list.length - 1]
    const lastEnd = new Date(last.started_at.replace(" ", "T"))
    lastEnd.setSeconds(lastEnd.getSeconds() + Number(last.duration_sec))
    const checkIn = isToday ? "" : first.started_at.slice(11, 16)
    const checkOut = isToday ? "" : `${pad(lastEnd.getHours())}:${pad(lastEnd.getMinutes())}`
    const withGps = list.find((v) => v.lat != null)
    const res = await db.query(
      `INSERT INTO agent_routes (agent, route_date, plan_visits, route_visited, route_effective, route_refused, route_sales,
         outside_visited, outside_effective, outside_refused, outside_sales, check_in, check_out, gps_lat, gps_lng)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [agent, date, agg.rv + (isToday ? 0 : int(0, 2)), agg.rv, agg.re, agg.rr, agg.rs, agg.ov, agg.oe, agg.or, agg.os, checkIn, checkOut, withGps?.lat ?? null, withGps?.lng ?? null],
    )
    ids.push(res.rows[0].id)
  }
  await register("agent_routes", ids)
  counts.agent_routes = ids.length
}

// ---------- tasks ----------
if (!(await seeded("tasks"))) {
  const descriptions = ["Следует посетить клиента", "Принять заказ и собрать оплату", "Сделать фото витрины", "Проверить остатки на полке", "Провести сверку задолженности"]
  const statuses = ["in_progress", "fulfilled", "closed"]
  const ids = []
  for (const agent of AGENTS) {
    const pool = clientsByAgent[agent] ?? []
    if (!pool.length) continue
    for (let i = 0; i < 6; i++) {
      const client = pick(pool)
      const day = new Date(TODAY)
      day.setDate(day.getDate() + int(-20, 5))
      const status = day < TODAY ? pick(["fulfilled", "closed", "in_progress"]) : "in_progress"
      const res = await db.query(
        `INSERT INTO tasks (responsible, store, description, date, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
        [agent, client.name, pick(descriptions), iso(day), statuses.includes(status) ? status : "in_progress", `${iso(day)} 09:00:00`],
      )
      ids.push(res.rows[0].id)
    }
  }
  await register("tasks", ids)
  counts.tasks = ids.length
}

// ---------- weekend / holiday days (0-based month; Sundays are implicit in the UI) ----------
if (!(await seeded("attendance_weekend_days"))) {
  const holidays = [[0, 1], [2, 8], [2, 21], [4, 9], [8, 1], [9, 1], [11, 8], [11, 31]]
  const ids = []
  for (const [month, day] of holidays) {
    const res = await db.query(`INSERT INTO attendance_weekend_days (year, month, day) VALUES (2026,$1,$2) ON CONFLICT (year, month, day) DO NOTHING RETURNING id`, [month, day])
    if (res.rows[0]) ids.push(res.rows[0].id)
  }
  await register("attendance_weekend_days", ids)
  counts.attendance_weekend_days = ids.length
}

// ---------- survey plans ----------
if (!(await seeded("survey_plans"))) {
  const surveys = (await db.query(`SELECT name FROM surveys WHERE active = 1 ORDER BY id`)).rows.map((r) => r.name)
  const periods = ["Август-2026", "Сентябрь-2026", "Октябрь-2026"]
  const ids = []
  for (const period of periods) {
    for (const agent of AGENTS.slice(0, 7)) {
      for (const survey of [pick(surveys), pick(surveys)].filter((v, i, a) => a.indexOf(v) === i)) {
        const res = await db.query(`INSERT INTO survey_plans (period, employee, survey) VALUES ($1,$2,$3) RETURNING id`, [period, agent, survey])
        ids.push(res.rows[0].id)
      }
    }
  }
  await register("survey_plans", ids)
  counts.survey_plans = ids.length
}

// ---------- branch plans and KPI plans ----------
const branchRows = (
  await db.query(
    `SELECT b.id, b.name FROM branches b JOIN (SELECT branch_name, COUNT(*) n FROM orders GROUP BY 1) o ON o.branch_name = b.name
     WHERE b.id IN (SELECT MIN(id) FROM branches GROUP BY name) ORDER BY o.n DESC LIMIT 8`,
  )
).rows
if (!(await seeded("branch_plans"))) {
  const ids = []
  for (const b of branchRows) {
    const res = await db.query(`INSERT INTO branch_plans (branch_id, weight, amount, price) VALUES ($1,$2,$3,$4) RETURNING id`, [b.id, String(int(8, 60) * 1000), String(int(500, 4000)), String(int(200, 900) * 1_000_000)])
    ids.push(res.rows[0].id)
  }
  await register("branch_plans", ids)
  counts.branch_plans = ids.length
}
if (!(await seeded("branch_kpi_plans"))) {
  const SUPPORTED = ["Сумма фактической продажи (продажа - возврат)", "product_sales_amount", "active_client_count", "sales_sum_order", "payment_to_cashbox", "payed_market_count", "active_client_count_by_day"]
  const indicators = (await db.query(`SELECT id, plan_type FROM kpi_tasks WHERE active = 1 AND plan_type = ANY($1) ORDER BY id LIMIT 6`, [SUPPORTED])).rows
  const planOf = (type, scale) => {
    if (type.startsWith("Сумма") || type === "sales_sum_order" || type === "payment_to_cashbox") return Math.round(scale * int(150, 500) * 1_000_000 / 100) * 100
    if (type === "product_sales_amount") return Math.round(scale * int(800, 3000))
    return Math.round(scale * int(40, 300))
  }
  const ids = []
  const ruleIds = []
  for (const ind of indicators) {
    const exists = await db.query(`SELECT 1 FROM branch_kpi_indicator_rules WHERE indicator_id = $1`, [ind.id])
    if (exists.rowCount) continue
    const levels = [
      { id: 1, fromAmount: 80, toAmount: 99.99, bonus: 1, calculationType: "percentFromSales", excludeLowLevel: false },
      { id: 2, fromAmount: 100, toAmount: 119.99, bonus: 2, calculationType: "percentFromSales", excludeLowLevel: false },
      { id: 3, fromAmount: 120, toAmount: 1000, bonus: 3, calculationType: "percentFromSales", excludeLowLevel: true },
    ]
    const res = await db.query(`INSERT INTO branch_kpi_indicator_rules (indicator_id, bonus_fund, levels, updated_by) VALUES ($1,$2,$3,'Admin Ritm') RETURNING id`, [ind.id, int(5, 20) * 1_000_000, JSON.stringify(levels)])
    ruleIds.push(res.rows[0].id)
  }
  for (const period of ["2026-08", "2026-09", "2026-10"]) {
    for (const b of branchRows) {
      const scale = 0.3 + rnd()
      const plan = { indicators: Object.fromEntries(indicators.map((ind) => [String(ind.id), planOf(ind.plan_type, scale)])) }
      const res = await db.query(`INSERT INTO branch_kpi_plans (branch_id, branch_name, period, plan) VALUES ($1,$2,$3,$4) ON CONFLICT (branch_id, period) DO NOTHING RETURNING id`, [b.id, b.name, period, JSON.stringify(plan)])
      if (res.rows[0]) ids.push(res.rows[0].id)
    }
  }
  await register("branch_kpi_plans", ids)
  if (ruleIds.length) await register("branch_kpi_indicator_rules", ruleIds)
  counts.branch_kpi_plans = ids.length
  counts.branch_kpi_indicator_rules = ruleIds.length
}

console.log(JSON.stringify(counts))
await db.end()
