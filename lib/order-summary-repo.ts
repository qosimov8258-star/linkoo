import "server-only"

import { getDb } from "@/lib/db"

export type OrderSummaryRow = { type: string; blocks: number; orders: number; returns: number; volume: number; sum: number }
export type OrderSummary = { rows: OrderSummaryRow[]; bonus: OrderSummaryRow[] }

let schemaReady: Promise<void> | undefined

/** Per-product volume (m³); the products table only keeps the text "Не указано м³." */
async function ensureSchema() {
  schemaReady ??= (async () => {
    await getDb().exec("CREATE TABLE IF NOT EXISTS product_volumes (product_id integer PRIMARY KEY, volume_m3 double precision NOT NULL)")
    // Lines the reference flags is_bonus (scripts/backfill-order-item-bonus-from-reference.mjs).
    await getDb().exec("CREATE TABLE IF NOT EXISTS order_item_bonus (order_item_id integer PRIMARY KEY)")
  })()
  return schemaReady
}

type Line = {
  type: string | null
  type_id: number | null
  quantity: number
  unit_price: number
  discount_percent: number
  return_quantity: number
  box_amount: number | null
  volume_m3: number | null
  is_bonus: boolean
}

/**
 * "Итоги выбранных заказов": the ticked orders' lines grouped by product type. Lines the reference flags as bonus goods
 * (order_item_bonus; a free line is not necessarily a bonus) get their own table; Блок is the quantity divided by the box size, Кол-во Возвратов is negative like the reference shows it.
 */
export async function summarizeOrders(orderIds: number[]): Promise<OrderSummary> {
  if (!orderIds.length) return { rows: [], bonus: [] }
  await ensureSchema()
  const placeholders = orderIds.map(() => "?").join(",")
  const lines = (await getDb()
    .prepare(
      `SELECT p.type AS type, (SELECT MIN(t.id) FROM product_types t WHERE t.name = p.type) AS type_id, i.quantity, i.unit_price, COALESCE(i.discount_percent, 0) AS discount_percent,
              COALESCE(i.return_quantity, 0) AS return_quantity, p.box_amount, v.volume_m3,
              EXISTS (SELECT 1 FROM order_item_bonus b WHERE b.order_item_id = i.id) AS is_bonus
       FROM order_items i
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN product_volumes v ON v.product_id = i.product_id
       WHERE i.order_id IN (${placeholders}) ORDER BY i.id ASC`,
    )
    .all(...orderIds)) as Line[]

  const group = (bonus: boolean) => {
    const grouped = new Map<string, OrderSummaryRow>()
    const typeIds = new Map<string, number>()
    for (const line of lines) {
      if (Boolean(line.is_bonus) !== bonus) continue
      const type = line.type || ""
      const row = grouped.get(type) ?? { type, blocks: 0, orders: 0, returns: 0, volume: 0, sum: 0 }
      const quantity = Number(line.quantity)
      const box = Number(line.box_amount ?? 0)
      row.blocks += box > 0 ? quantity / box : 0
      row.orders += quantity
      row.returns -= Number(line.return_quantity)
      // The reference reports total_capacity 0 for every product, so the demo product_volumes rows are not used here.
      row.sum += quantity * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100)
      grouped.set(type, row)
      typeIds.set(type, Number(line.type_id ?? Number.MAX_SAFE_INTEGER))
    }
    // The reference lists the product types in the order of their ids.
    return [...grouped.values()].sort((a, b) => (typeIds.get(a.type) ?? 0) - (typeIds.get(b.type) ?? 0))
  }
  return { rows: group(false), bonus: group(true) }
}
