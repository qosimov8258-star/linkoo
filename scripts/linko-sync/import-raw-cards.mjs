// Сырье: what only Linko's card of a raw material (main/product/{id}/ of an is_raw product) carries, written into the
// raw_materials rows the Сырье page lists. The first copy filled those rows from the list (main/product/?is_raw=true),
// which has no «Поставщик», «Минимальный остаток», «Вес», the price lists, and whose ММЛ / «Показывать в боте» /
// «Продать только в группе» / «Учитывать срок годности» flags were not copied. This step reads the same captured cards
// as import-product-cards.mjs (the SPA's own read-only GETs while #/product/{id} or #/raw/{id} opens) and:
//   1. writes the card's fields into the raw_materials row of that raw material (matched by name, then unit, as
//      import-product-boxes.mjs does: raw_materials has ids of its own);
//   2. copies the prices (price_lists, price_min / price_max, price_updated_date) from the products row with the
//      card's Linko id (the same item as a stock item; import-price-list-items.mjs keeps its prices).
// Every change is registered in linko_sync_rows (an update with the previous values).
//
//   node scripts/linko-sync/import-raw-cards.mjs          (DRY=1 only reports)
//   (raw: backups/linko-raw/<day>/product-detail/products_detail.json {id: card} — the newest day that has it, or
//    RAW=<folder of that file>)
import fs from "node:fs"
import path from "node:path"

import { ROOT, connect, ensureRegistry, register, runId } from "./lib.mjs"

function rawFolder() {
  if (process.env.RAW) return process.env.RAW
  const base = path.join(ROOT, "backups", "linko-raw")
  const days = fs.existsSync(base) ? fs.readdirSync(base).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort().reverse() : []
  const day = days.find((name) => fs.existsSync(path.join(base, name, "product-detail", "products_detail.json")))
  return day ? path.join(base, day, "product-detail") : null
}

const folder = rawFolder()
if (!folder) {
  console.log("raw cards: no raw product-detail/products_detail.json (capture the product cards first)")
  process.exit(0)
}
const cards = Object.values(JSON.parse(fs.readFileSync(path.join(folder, "products_detail.json"), "utf8"))).filter(
  (card) => card && card.id && !card.__status && !card.__error && card.is_raw && !card.is_delete,
)

const dry = process.env.DRY === "1"
const run = runId("raw-cards")
const key = (value) => String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ")
const PLACEHOLDERS = new Set(["", "не указано", "-", "no brand"])
const empty = (value) => PLACEHOLDERS.has(String(value ?? "").trim().toLowerCase())
const number = (value) => {
  const parsed = Number(value)
  return value === null || value === undefined || value === "" || !Number.isFinite(parsed) ? 0 : parsed
}
/** The leading number of a stored text ("20 шт.", "0,5 кг."). */
const leading = (value) => {
  const match = /-?\d[\d\s]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  return match ? Number(match[0].replace(/\s/g, "").replace(",", ".")) || 0 : 0
}
const plain = (value) => String(Math.round(number(value) * 1e6) / 1e6)
const flag = (value) => (value ? 1 : 0)
const text = (value) => String(value ?? "").trim()

/** Desired raw_materials values of one card; `same(current)` tells whether the stored value already says it. */
function columnsOf(card) {
  const named = (value, fallback) => ({ value: text(value) || fallback, same: (current) => (empty(current) && !text(value)) || text(current) === text(value) })
  const amount = (value) => ({ value: plain(value), same: (current) => leading(current) === number(value) })
  const bool = (value) => ({ value: flag(value), same: (current) => Number(current) === flag(value) })
  return {
    supplier: named(card.provider?.name, "Не указано"),
    description: named(card.description, "Не указано"),
    min_stock: amount(card.min_amount),
    mass: amount(card.kg_value),
    net_weight: amount(card.weight_netto),
    can_sell: bool(card.can_sell),
    only_mml: bool(card.is_mml),
    show_as_inventory: bool(card.is_gear),
    group_only: bool(card.sell_only_box),
    show_in_bot: bool(card.show_in_market),
    track_expiry: bool(card.use_expiration),
    track_series: bool(card.use_series),
    expiration_days: { value: card.expiration_days ?? null, same: (current) => (current ?? null) === (card.expiration_days ?? null) },
    notify_expire_days: { value: card.notify_expire_days ?? null, same: (current) => (current ?? null) === (card.notify_expire_days ?? null) },
    marked_product: bool(card.use_mark),
    manual_discount: bool(card.use_discount_percent),
    hide_from_agent: bool(card.is_promo),
    sale_points: amount(card.ball),
  }
}
const PRICE_COLUMNS = ["price_lists", "price_min", "price_max", "price_updated_date"]

const client = await connect()
await ensureRegistry(client)
const stats = { updated: 0, same: 0, fields: {}, missing: [], ambiguous: [] }
try {
  await client.query("BEGIN")
  const COLUMNS = Object.keys(columnsOf({}))
  const rows = (await client.query(`SELECT id, name, unit, ${[...COLUMNS, ...PRICE_COLUMNS].map((column) => `"${column}"`).join(", ")} FROM raw_materials WHERE COALESCE(deleted, 0) = 0 FOR UPDATE`))
    .rows
  for (const card of cards) {
    const candidates = rows.filter((row) => key(row.name) === key(card.name))
    const byUnit = candidates.filter((row) => key(row.unit) === key(card.measurement?.name))
    const row = byUnit.length === 1 ? byUnit[0] : candidates.length === 1 ? candidates[0] : null
    if (!row) {
      ;(candidates.length ? stats.ambiguous : stats.missing).push(card.id)
      continue
    }
    const wanted = columnsOf(card)
    const changed = COLUMNS.filter((column) => !wanted[column].same(row[column]))
    const values = Object.fromEntries(changed.map((column) => [column, wanted[column].value]))
    // The prices of the same item kept on its products row (id = Linko's).
    const product = (await client.query(`SELECT ${PRICE_COLUMNS.join(", ")} FROM products WHERE id = $1`, [Number(card.id)])).rows[0]
    if (product) {
      for (const column of PRICE_COLUMNS) {
        if (String(product[column] ?? "") !== String(row[column] ?? "")) {
          changed.push(column)
          values[column] = product[column]
        }
      }
    }
    if (!changed.length) {
      stats.same++
      continue
    }
    for (const column of changed) stats.fields[column] = (stats.fields[column] ?? 0) + 1
    stats.updated++
    if (dry) continue
    await client.query(`UPDATE raw_materials SET ${changed.map((column, index) => `"${column}" = $${index + 2}`).join(", ")} WHERE id = $1`, [
      row.id,
      ...changed.map((column) => values[column]),
    ])
    await register(client, run, "raw_materials", row.id, "update", Object.fromEntries(changed.map((column) => [column, row[column]])))
  }
  await client.query(dry ? "ROLLBACK" : "COMMIT")
} catch (error) {
  await client.query("ROLLBACK").catch(() => {})
  throw error
} finally {
  await client.end()
}
console.log(`raw cards${dry ? " (dry run)" : ""}: ${JSON.stringify(stats)}`)
