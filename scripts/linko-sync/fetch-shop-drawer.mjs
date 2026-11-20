// Downloads (read-only GET requests) what Linko's shop drawer shows for each shop and the client list does not carry:
//   market/market/{id}/?with_extra_message=1&with_plan=1&detail_gear=true   price list, «Статус ИНН», «Создал», …
//   market/market/{id}/detail_plans/                                         the ЗАДАЧИ timeline (all of it)
//   market/market_logs/?market={id}                                          КЛИЕНТ → ЛОГИ (all of it)
//   market/market_logs/?market={id}&type={type}                              each type it has twice or more (the filter
//                                                                              pills: Linko sends a type in its own order)
// into backups/linko-raw/<YYYY-MM-DD>/shop_drawer.json ({fetched, data: {shopId: {market, plans, logs, logsByType}}}), the file
// import-shop-drawer.mjs reads. A re-run continues where the last one stopped (shops already saved are skipped).
//
//   LINKO_SERVER=time3 LINKO_TOKEN=… node scripts/linko-sync/fetch-shop-drawer.mjs           (every shop of markets.json)
//   SHOPS=4567,3503 LINKO_TOKEN=… node scripts/linko-sync/fetch-shop-drawer.mjs              (some shops)
// LINKO_USER / LINKO_PASS instead of LINKO_TOKEN sign in first. The raw files hold business data: never commit them.
import fs from "node:fs"
import path from "node:path"

import { ROOT, rawDir } from "./lib.mjs"

const SERVER = process.env.LINKO_SERVER || "time3"
const BASE = `https://${SERVER}.linko.uz/ru/api/v1/`
const DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date())
const OUT_DIR = process.env.RAW || path.join(ROOT, "backups", "linko-raw", DAY)
const OUT = path.join(OUT_DIR, "shop_drawer.json")
fs.mkdirSync(OUT_DIR, { recursive: true })

let token = process.env.LINKO_TOKEN || ""
async function login() {
  if (token) return
  if (!process.env.LINKO_USER || !process.env.LINKO_PASS) throw new Error("Set LINKO_TOKEN (or LINKO_USER and LINKO_PASS)")
  const response = await fetch(`${BASE}main/user/auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json;charset=UTF-8", Accept: "application/json" },
    body: JSON.stringify({ username: process.env.LINKO_USER, password: process.env.LINKO_PASS, rememberMe: false, can_handle_2fa: false }),
  })
  const body = await response.json().catch(() => ({}))
  token = body.token || body.key || body.auth_token || ""
  if (!response.ok || !token) throw new Error(`Linko sign-in failed (${response.status})`)
}

/** GET only; retries throttling and server errors. */
async function get(p) {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(BASE + p, { headers: { Authorization: `Token ${token}`, Accept: "application/json" } })
      if (response.status === 429 || response.status >= 500) {
        await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
        continue
      }
      return response.ok ? await response.json() : null
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)))
    }
  }
  return null
}

function shopIds() {
  if (process.env.SHOPS) return process.env.SHOPS.split(",").map(Number).filter((id) => id > 0)
  const file = path.join(rawDir(), "markets.json")
  return JSON.parse(fs.readFileSync(file, "utf8")).data.map((market) => Number(market.id))
}

await login()
const out = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { fetched: new Date().toISOString(), data: {} }
const todo = shopIds().filter((id) => !out.data[id] || out.data[id].error)
console.log(`shop drawer: ${todo.length} shops to fetch`)
let done = 0
for (const id of todo) {
  const [market, plans, logs] = await Promise.all([
    get(`market/market/${id}/?with_extra_message=1&with_plan=1&detail_gear=true`),
    get(`market/market/${id}/detail_plans/?page_size=1000`),
    get(`market/market_logs/?market=${id}&page_size=1000`),
  ])
  const logsByType = {}
  let complete = Boolean(market && plans && logs)
  if (complete) {
    const counts = {}
    for (const log of logs.results ?? []) counts[log.type] = (counts[log.type] ?? 0) + 1
    for (const type of ["order", "order_return", "client_transaction", "market"]) {
      if ((counts[type] ?? 0) < 2) continue
      const page = await get(`market/market_logs/?market=${id}&type=${type}&page_size=1000`)
      if (!page) complete = false
      else logsByType[type] = page
    }
  }
  out.data[id] = complete ? { market, plans, logs, logsByType } : { error: "incomplete" }
  if (++done % 25 === 0) {
    fs.writeFileSync(OUT, JSON.stringify(out))
    console.log(`shop drawer: ${done}/${todo.length}`)
  }
}
fs.writeFileSync(OUT, JSON.stringify(out))
console.log(`shop drawer: done, ${Object.values(out.data).filter((entry) => entry.error).length} incomplete`)
