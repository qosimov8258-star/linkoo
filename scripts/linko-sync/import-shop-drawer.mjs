// The shop drawer (Клиенты card, opened from orders, returns, Активность …): Linko's own data of each shop the client
// row has no place for, from the raw file shop_drawer.json (fetch-shop-drawer.mjs: per shop market/market/{id}/,
// its detail_plans and its market_logs, all pages, and market_logs?type=<t> of each type it has: logsByType):
//   linko_market_cards  price list, «Статус ИНН», «Создал», «Класс клиента» per organization, last payment day,
//                       ФИНАНСОВЫЕ НАСТРОЙКИ (without_bonus, promotions, KPIs), the market options' order and
//                       «Комментарий отказа» (last_reject_comment)
//   linko_market_plans  the ЗАДАЧИ timeline, in Linko's order
//   linko_market_logs   КЛИЕНТ → ЛОГИ, in Linko's order (position) and in the order of its type's own list
//                       (type_position: Linko's filter pills ask for one type, which comes back in another order)
// (the tables of lib/shop-drawer-repo.ts). A re-run replaces a shop's rows with the newer copy; a shop the file has no
// complete copy of keeps what it had. Shops that are not here are reported.
//
//   node scripts/linko-sync/import-shop-drawer.mjs
import fs from "node:fs"
import path from "node:path"

import { ROOT, capturedOrSkip, connect, currencyCode, ensureRegistry, fullName, register, runId } from "./lib.mjs"

const run = runId("shop-drawer")
const NAME = "shop_drawer"

// <RAW>/shop_drawer.json (skipped when RAW lacks it), else the newest backups/linko-raw/<date> that has it.
const file = capturedOrSkip(`${NAME}.json`)
if (!file || !fs.existsSync(file)) {
  console.log("shop drawer: no raw shop_drawer.json (run fetch-shop-drawer.mjs first)")
  process.exit(0)
}
const raw = JSON.parse(fs.readFileSync(file, "utf8"))
const fetchedAt = String(raw.fetched ?? "")
const entries = Object.entries(raw.data ?? {})

const DDL = [
  `CREATE TABLE IF NOT EXISTS linko_market_cards (
    client_id INTEGER PRIMARY KEY,
    price_list_id INTEGER,
    price_list_name TEXT NOT NULL DEFAULT '',
    inn_is_correct BOOLEAN,
    created_by TEXT NOT NULL DEFAULT '',
    market_class TEXT NOT NULL DEFAULT '',
    class_divisions TEXT NOT NULL DEFAULT '[]',
    last_payment_date TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS linko_market_plans (
    id INTEGER PRIMARY KEY,
    client_id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    employee_id INTEGER,
    employee_name TEXT NOT NULL DEFAULT '',
    type TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    text TEXT NOT NULL DEFAULT '',
    done_at TEXT,
    order_id INTEGER,
    return_id INTEGER,
    transaction_id INTEGER,
    unscheduled BOOLEAN NOT NULL DEFAULT false
  )`,
  "CREATE INDEX IF NOT EXISTS linko_market_plans_client ON linko_market_plans (client_id, position)",
  `CREATE TABLE IF NOT EXISTS linko_market_logs (
    client_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    id INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    action TEXT NOT NULL DEFAULT '',
    status TEXT,
    created_at TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    total_price DOUBLE PRECISION,
    currency TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (client_id, type, id)
  )`,
  "CREATE INDEX IF NOT EXISTS linko_market_logs_client ON linko_market_logs (client_id, position)",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS without_bonus BOOLEAN",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS promotions TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS kpis TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS option_names TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE linko_market_cards ADD COLUMN IF NOT EXISTS last_reject_comment TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE linko_market_logs ADD COLUMN IF NOT EXISTS type_position INTEGER",
]

/** Linko's moment as it sends it (Tashkent wall clock), trimmed to seconds: "2026-07-17T08:24:09". */
const moment = (value) => (value ? String(value).slice(0, 19) : null)
const id = (value) => (value === null || value === undefined || value === "" ? null : Number(value) || null)
const list = (page) => (page && Array.isArray(page.results) ? page.results : null)

const stats = { shops: 0, cards: 0, plans: 0, logs: 0, incomplete: 0, missing: [] }
const client = await connect()
await ensureRegistry(client)
try {
  await client.query("BEGIN")
  await client.query("SELECT pg_advisory_xact_lock(hashtext('linko:shop_drawer'))")
  for (const statement of DDL) await client.query(statement)
  const shops = new Set((await client.query("SELECT id FROM clients")).rows.map((row) => Number(row.id)))
  const cards = new Set((await client.query("SELECT client_id FROM linko_market_cards")).rows.map((row) => Number(row.client_id)))
  // A shop's stored rows of a table, to register only what a re-run really changed.
  const stored = async (table, shopId, order) => JSON.stringify((await client.query(`SELECT * FROM ${table} WHERE client_id = $1 ORDER BY ${order}`, [shopId])).rows)
  for (const [key, entry] of entries) {
    const shopId = Number(key)
    const market = entry?.market
    const plans = list(entry?.plans)
    const logs = list(entry?.logs)
    if (!market || !plans || !logs || entry.error || Number(market.id) !== shopId) {
      stats.incomplete++
      continue
    }
    if (!shops.has(shopId)) {
      stats.missing.push(shopId)
      continue
    }
    stats.shops++
    const marketClass = market.market_class
    const classDivisions = (Array.isArray(market.class_divisions) ? market.class_divisions : []).map((item) => ({
      className: String(item?.market_class?.name ?? ""),
      division: String(item?.division?.name ?? ""),
    }))
    const names = (items) => JSON.stringify((Array.isArray(items) ? items : []).map((item) => String(item?.name ?? "")).filter(Boolean))
    const optionNames = JSON.stringify((Array.isArray(market.market_options) ? market.market_options : []).map((option) => String(option?.option_name ?? "")).filter(Boolean))
    const cardBefore = await stored("linko_market_cards", shopId, "client_id")
    await client.query(
      `INSERT INTO linko_market_cards (client_id, price_list_id, price_list_name, inn_is_correct, created_by, market_class, class_divisions, last_payment_date, fetched_at,
                                       without_bonus, promotions, kpis, option_names, last_reject_comment)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (client_id) DO UPDATE SET price_list_id = EXCLUDED.price_list_id, price_list_name = EXCLUDED.price_list_name,
         inn_is_correct = EXCLUDED.inn_is_correct, created_by = EXCLUDED.created_by, market_class = EXCLUDED.market_class,
         class_divisions = EXCLUDED.class_divisions, last_payment_date = EXCLUDED.last_payment_date, fetched_at = EXCLUDED.fetched_at,
         without_bonus = EXCLUDED.without_bonus, promotions = EXCLUDED.promotions, kpis = EXCLUDED.kpis,
         option_names = EXCLUDED.option_names, last_reject_comment = EXCLUDED.last_reject_comment`,
      [
        shopId,
        id(market.price_list?.id),
        String(market.price_list?.name ?? ""),
        typeof market.inn_is_correct === "boolean" ? market.inn_is_correct : null,
        fullName(market.created_by),
        String((marketClass && typeof marketClass === "object" ? marketClass.name : marketClass) ?? ""),
        JSON.stringify(classDivisions),
        String(market.last_payment_date ?? ""),
        fetchedAt,
        typeof market.without_bonus === "boolean" ? market.without_bonus : null,
        names(market.promotions),
        names(market.performance_indicators),
        optionNames,
        String(market.last_reject_comment ?? ""),
      ],
    )
    if (!cards.has(shopId)) await register(client, run, "linko_market_cards", shopId, "insert")
    else if ((await stored("linko_market_cards", shopId, "client_id")) !== cardBefore) await register(client, run, "linko_market_cards", shopId, "update")
    stats.cards++

    const plansBefore = await stored("linko_market_plans", shopId, "id")
    await client.query("DELETE FROM linko_market_plans WHERE client_id = $1", [shopId])
    for (const [position, plan] of plans.entries()) {
      await client.query(
        `INSERT INTO linko_market_plans (id, client_id, position, employee_id, employee_name, type, status, text, done_at, order_id, return_id, transaction_id, unscheduled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET client_id = EXCLUDED.client_id, position = EXCLUDED.position, employee_id = EXCLUDED.employee_id,
           employee_name = EXCLUDED.employee_name, type = EXCLUDED.type, status = EXCLUDED.status, text = EXCLUDED.text,
           done_at = EXCLUDED.done_at, order_id = EXCLUDED.order_id, return_id = EXCLUDED.return_id,
           transaction_id = EXCLUDED.transaction_id, unscheduled = EXCLUDED.unscheduled`,
        [
          Number(plan.id),
          shopId,
          position,
          id(plan.user?.id),
          fullName(plan.user),
          String(plan.type ?? ""),
          String(plan.status ?? ""),
          String(plan.text ?? ""),
          moment(plan.done_time),
          id(plan.order_id),
          id(plan.order_return_id),
          id(plan.client_transaction_id),
          Boolean(plan.unscheduled),
        ],
      )
      stats.plans++
    }
    if ((await stored("linko_market_plans", shopId, "id")) !== plansBefore) await register(client, run, "linko_market_plans", shopId, "replace")

    // Each type's own order (market_logs?type=<t>); a type with one entry has no other order.
    const typeOrder = new Map()
    for (const [type, page] of Object.entries(entry.logsByType ?? {})) {
      for (const [index, log] of (list(page) ?? []).entries()) typeOrder.set(`${type}:${Number(log.id)}`, index)
    }
    const logsBefore = await stored("linko_market_logs", shopId, "type, id")
    await client.query("DELETE FROM linko_market_logs WHERE client_id = $1", [shopId])
    for (const [position, log] of logs.entries()) {
      await client.query(
        `INSERT INTO linko_market_logs (client_id, type, id, position, action, status, created_at, created_by, total_price, currency, comment, type_position)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (client_id, type, id) DO NOTHING`,
        [
          shopId,
          String(log.type ?? ""),
          Number(log.id),
          position,
          String(log.action ?? ""),
          log.status === null || log.status === undefined ? null : String(log.status),
          moment(log.created_date) ?? "",
          fullName(log.created_by),
          log.total_price === null || log.total_price === undefined ? null : Number(log.total_price),
          log.currency ? currencyCode(log.currency) : "",
          String(log.comment ?? ""),
          typeOrder.get(`${String(log.type ?? "")}:${Number(log.id)}`) ?? null,
        ],
      )
      stats.logs++
    }
    if ((await stored("linko_market_logs", shopId, "type, id")) !== logsBefore) await register(client, run, "linko_market_logs", shopId, "replace")
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}

console.log(
  `shop drawer (${path.relative(ROOT, file)}): ${stats.shops} shops, ${stats.cards} cards, ${stats.plans} plans, ${stats.logs} log entries` +
    (stats.incomplete ? `, ${stats.incomplete} shops without a complete copy skipped` : "") +
    (stats.missing.length ? `, unknown shops ${stats.missing.slice(0, 10).join(", ")}` : ""),
)
