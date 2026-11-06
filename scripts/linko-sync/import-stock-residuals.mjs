// Остаток: stock movements Linko holds without a document, so that every product's balance in every warehouse equals
// Linko's (stock/all_balances_by_stock). Linko books them as "Прочие" (none) movements — balances loaded by its 1C
// integration into the "Ожидается синхронизация: …" warehouses, equipment (Работа с инвентарем) issued from or returned
// to a warehouse, and a few corrections without a document. Here they are production movements of direction 'adjust'
// without a batch or stage (the stock ledger books 'adjust' as none_in / none_out, the same "Прочие" column; the
// production pages do not list them):
// 1. equipment issues / returns from Linko's stock history (type "gear"), on their own day;
// 2. what is left between Linko's balance and this database's (after every document is imported) per product and
//    warehouse, on the day Linko's stock history starts.
// Re-running replaces the movements of earlier runs. Run it LAST, after every other import, with the local app running:
//
//   LOCAL_URL=http://localhost:3002 LOCAL_COOKIE='linko_session=…' node scripts/linko-sync/import-stock-residuals.mjs
import { connect, ensureRegistry, raw, register, runId } from "./lib.mjs"

const run = runId("stock-residuals")
const MARK = "Linko: "
const GEAR = `${MARK}инвентарь`
const REST = `${MARK}остаток без документа`
const LOCAL_URL = process.env.LOCAL_URL || "http://localhost:3002"
const LOCAL_COOKIE = process.env.LOCAL_COOKIE || ""

const balances = raw("all_balances_by_stock")
const history = raw("barcode_history")
const costs = new Map(raw("products_net_costs").map((p) => [p.id, Number(p.net_cost) || 0]))
const start = history.reduce((min, h) => (h.created_date < min ? h.created_date : min), "9999").slice(0, 10)

async function localBalances() {
  const response = await fetch(`${LOCAL_URL}/api/stock/balances?pageSize=0`, { headers: { cookie: LOCAL_COOKIE } })
  if (!response.ok) throw new Error(`local stock API answered ${response.status}: set LOCAL_URL / LOCAL_COOKIE`)
  const body = await response.json()
  const map = new Map()
  for (const row of body.rows ?? []) for (const s of row.stocks ?? []) map.set(`${row.key}|${s.warehouse}`, Number(s.total) || 0)
  return map
}

const client = await connect()
await ensureRegistry(client)
const stats = { removed: 0, gear: 0, rest: 0 }
try {
  // 0. Movements of earlier runs out.
  await client.query("BEGIN")
  const old = (await client.query("SELECT * FROM production_movements WHERE direction = 'adjust' AND party_id IS NULL AND stage_id IS NULL AND comment LIKE $1", [`${MARK}%`])).rows
  for (const row of old) {
    await client.query("DELETE FROM production_movements WHERE id = $1", [row.id])
    await register(client, run, "production_movements", row.id, "delete", row)
    stats.removed++
  }
  const products = new Map((await client.query("SELECT id, name, unit FROM products")).rows.map((p) => [p.id, p]))
  const add = async (warehouse, productId, amount, day, comment) => {
    const product = products.get(productId)
    if (!product || Math.abs(amount) < 1e-9) return false
    const inserted = await client.query(
      `INSERT INTO production_movements (stage_id, party_id, warehouse, direction, item_kind, item_id, item_name, unit, amount, cost, is_defect, comment, date, user_name, created_at, in_stock)
       VALUES (NULL, NULL, $1, 'adjust', 'product', $2, $3, $4, $5, $6, 0, $7, $8, '', $9, 1) RETURNING id`,
      [warehouse, productId, product.name, product.unit ?? "", Math.round(amount * 1e9) / 1e9, amount > 0 ? costs.get(productId) ?? 0 : 0, comment, day, `${day} 00:00:00`],
    )
    await register(client, run, "production_movements", inserted.rows[0].id, "insert")
    return true
  }

  // 1. Equipment issued / returned (Работа с инвентарем), per product, warehouse and day.
  const gear = new Map()
  for (const h of history) {
    if (h.generic?.type !== "gear") continue
    const key = `${h.product?.id}|${h.stock?.name}|${String(h.created_date).slice(0, 10)}`
    gear.set(key, (gear.get(key) ?? 0) + Number(h.amount))
  }
  for (const [key, amount] of gear) {
    const [productId, warehouse, day] = key.split("|")
    if (await add(warehouse, Number(productId), amount, day, `${GEAR} (Работа с инвентарем)`)) stats.gear++
  }
  await client.query("COMMIT")

  // 2. The rest, against Linko's balances (live products only — Linko lists no others).
  const local = await localBalances()
  const linko = new Map()
  for (const row of balances) {
    const amount = Number(row.balance) || 0
    // Warehouses are told apart by name here (documents name them), so Linko's same-named warehouses (two "HANGUK12" …)
    // add up into one.
    const key = `product:${row.id}|${row.stock.name}`
    if (Math.abs(amount) > 1e-9) linko.set(key, (linko.get(key) ?? 0) + amount)
  }
  const live = new Set(balances.map((row) => `product:${row.id}`))
  await client.query("BEGIN")
  for (const key of new Set([...linko.keys(), ...local.keys()])) {
    const [itemKey, warehouse] = key.split(/\|(.*)/s)
    if (!live.has(itemKey)) continue
    const diff = (linko.get(key) ?? 0) - (local.get(key) ?? 0)
    if (Math.abs(diff) < 1e-6) continue
    if (await add(warehouse, Number(itemKey.slice("product:".length)), diff, start, REST)) stats.rest++
  }
  await client.query("COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`stock residuals: earlier movements removed ${stats.removed}; equipment movements ${stats.gear}; other movements ${stats.rest} (dated ${start})`)
