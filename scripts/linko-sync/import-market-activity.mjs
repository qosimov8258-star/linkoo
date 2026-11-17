// Клиенты: Linko's market last_order_date / last_visit_date (the latest order / visit made in the field; "2020-01-01" =
// never) into clients.last_order_date / last_visit_date. «Охват территорий» counts «Перестали покупать» and «Нет заказа»
// from the first, the card's «Прошло дней с последнего заказа / визита» from both — Linko keeps them apart from its
// orders (an order typed in the office does not move them). A later day set here (a visit made in the app) is kept.
//
// The days come from the shops' details (fetch step market-users → market_activity: the list has no last_visit_date),
// else from the market list (last_order_date only).
//
//   node scripts/linko-sync/import-market-activity.mjs     (raw: market_activity, else markets)
import { connect, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const run = runId("market-activity")
const client = await connect()
await ensureRegistry(client)
const stats = { clients: 0, updated: 0, missing: 0 }
const day = (value) => (/^\d{4}-\d{2}-\d{2}/.test(String(value ?? "")) ? String(value).slice(0, 10) : "")

try {
  await client.query("BEGIN")
  await client.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_order_date TEXT NOT NULL DEFAULT ''")
  await client.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS last_visit_date TEXT NOT NULL DEFAULT ''")
  const detail = hasRaw("market_activity") ? raw("market_activity") : null
  const markets = detail ? Object.entries(detail).map(([id, days]) => ({ id: Number(id), ...days })) : raw("markets")
  for (const market of markets) {
    const order = day(market.last_order_date)
    const visit = day(market.last_visit_date)
    if (!order && !visit) continue
    const row = (await client.query("SELECT last_order_date, last_visit_date FROM clients WHERE id = $1", [market.id])).rows[0]
    if (!row) {
      stats.missing++
      continue
    }
    stats.clients++
    const nextOrder = order > (row.last_order_date ?? "") ? order : row.last_order_date
    const nextVisit = visit > (row.last_visit_date ?? "") ? visit : row.last_visit_date
    if (nextOrder === row.last_order_date && nextVisit === row.last_visit_date) continue
    await client.query("UPDATE clients SET last_order_date = $2, last_visit_date = $3 WHERE id = $1", [market.id, nextOrder, nextVisit])
    await register(client, run, "clients", market.id, "update", { last_order_date: row.last_order_date, last_visit_date: row.last_visit_date })
    stats.updated++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}

console.log(`market activity: ${stats.updated} of ${stats.clients} clients given Linko's last order / visit days${stats.missing ? `, ${stats.missing} markets not here` : ""}`)
