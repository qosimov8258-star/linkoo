// Прайс-листы / Формирование цен / order prices: every product's price in every price list as Linko has it (raw
// price_list_items, fetch.mjs step price-list-items) into products.price_lists — the app's own store of item prices
// (lib/item-prices.ts: [{ name, cash, nonCash, min, max, currency, nonCashCurrency }], name = the price list's name) —
// with the derived price_min / price_max (every positive price converted into the base currency, the app's rule) and
// price_updated_date (Linko's last price change of the product, "23 окт. 2026"). A product with several rows for one
// price list keeps the latest one. Every change is registered in linko_sync_rows with the previous values.
//
//   node scripts/linko-sync/import-price-list-items.mjs   (raw: price_list_items, products_net_costs)
import { connect, currencyCode, ensureRegistry, hasRaw, raw, register, runId } from "./lib.mjs"

const MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
/** Linko's local (Tashkent) timestamp "2026-10-23T09:41:24.8" → "23 окт. 2026"; nothing → "Не установлена". */
const dayLabel = (value) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? ""))
  return match ? `${match[3]} ${MONTHS[Number(match[2]) - 1]} ${match[1]}` : "Не установлена"
}
const money = (value) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 1e6) / 1e6 : 0
}

const items = raw("price_list_items")
const updatedOf = new Map((hasRaw("products_net_costs") ? raw("products_net_costs") : []).map((p) => [p.id, p.price_updated]))
for (const item of items) if (item.product?.price_updated !== undefined) updatedOf.set(item.product.id, item.product.price_updated)

const run = runId("price-list-items")
const client = await connect()
await ensureRegistry(client)
const stats = { products: { update: 0, same: 0 }, entries: 0, missingProducts: [] }
try {
  await client.query("BEGIN")
  const lists = new Map((await client.query("SELECT id, name, currency FROM price_lists")).rows.map((row) => [Number(row.id), row]))
  const rates = new Map((await client.query("SELECT code, rate FROM currencies")).rows.map((row) => [currencyCode({ name: row.code }), Number(row.rate) || 0]))
  const base = (await client.query("SELECT code FROM currencies ORDER BY CASE WHEN rate = 1 THEN 0 ELSE 1 END, id LIMIT 1")).rows[0]?.code ?? "SUM"
  const toBase = (value, currency) => {
    const rate = rates.get(currencyCode({ name: currency || base })) ?? (currencyCode({ name: currency }) === currencyCode({ name: base }) ? 1 : 0)
    return rate ? value * rate : null
  }

  // The latest row of each product × price list (Linko lists a few products twice in one list).
  const byProduct = new Map()
  for (const item of [...items].sort((a, b) => a.id - b.id)) {
    const productId = item.product?.id
    const listId = item.price_list?.id
    if (!productId || !listId) continue
    if (!byProduct.has(productId)) byProduct.set(productId, new Map())
    byProduct.get(productId).set(listId, item)
  }

  const products = (await client.query("SELECT id, price_lists, price_min, price_max, price_updated_date FROM products WHERE COALESCE(deleted, 0) = 0")).rows
  const known = new Set(products.map((row) => Number(row.id)))
  for (const id of byProduct.keys()) if (!known.has(id)) stats.missingProducts.push(id)
  for (const row of products) {
    const id = Number(row.id)
    if (!updatedOf.has(id) && !byProduct.has(id)) continue // not a product of the Linko account
    const entries = [...(byProduct.get(id)?.values() ?? [])]
      .sort((a, b) => a.price_list.id - b.price_list.id)
      .map((item) => {
        const list = lists.get(Number(item.price_list.id))
        const currency = currencyCode(item.cash_currency) || currencyCode({ name: list?.currency }) || base
        return {
          name: String(list?.name ?? item.price_list.name ?? "").trim(),
          cash: money(item.cash_price),
          nonCash: money(item.transfer_price),
          min: 0,
          max: 0,
          currency,
          nonCashCurrency: currencyCode(item.transfer_currency) || currency,
        }
      })
      .filter((entry) => entry.name)
    stats.entries += entries.length
    const prices = entries
      .flatMap((entry) => [
        [entry.cash, entry.currency],
        [entry.nonCash, entry.nonCashCurrency],
      ])
      .filter(([value]) => value > 0)
      .map(([value, currency]) => toBase(value, currency))
      .filter((value) => value !== null && value > 0)
    const next = {
      price_lists: JSON.stringify(entries),
      price_min: prices.length ? Math.min(...prices) : 0,
      price_max: prices.length ? Math.max(...prices) : 0,
      price_updated_date: dayLabel(updatedOf.get(id)),
    }
    const same =
      String(row.price_lists ?? "") === next.price_lists &&
      Number(row.price_min) === next.price_min &&
      Number(row.price_max) === next.price_max &&
      String(row.price_updated_date ?? "") === next.price_updated_date
    if (same) {
      stats.products.same++
      continue
    }
    await client.query("UPDATE products SET price_lists = $2, price_min = $3, price_max = $4, price_updated_date = $5 WHERE id = $1", [
      id,
      next.price_lists,
      next.price_min,
      next.price_max,
      next.price_updated_date,
    ])
    await register(client, run, "products", id, "update", {
      price_lists: row.price_lists,
      price_min: row.price_min,
      price_max: row.price_max,
      price_updated_date: row.price_updated_date,
    })
    stats.products.update++
  }
  await client.query("COMMIT")
  console.log(JSON.stringify(stats))
} catch (error) {
  await client.query("ROLLBACK")
  throw error
} finally {
  await client.end()
}
