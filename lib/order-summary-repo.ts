import "server-only"

import { getDb } from "@/lib/db"

export type OrderSummaryRow = { type: string; blocks: number; orders: number; returns: number; volume: number; sum: number }
export type OrderSummary = { rows: OrderSummaryRow[]; bonus: OrderSummaryRow[] }

type Line = {
  type: string | null
  type_id: number | null
  quantity: number
  unit_price: number
  discount_percent: number
  return_quantity: number
  box_amount: number | null
}

/**
 * "Итоги выбранных заказов": the ticked orders' lines grouped by product type; Блок is the quantity divided by the box size,
 * Кол-во Возвратов is negative like the reference shows it. Order lines carry no bonus flag of this company, so the bonus
 * table stays empty (the reference account's flags, order_item_bonus, and its product_volumes rows that the removed demo
 * scripts wrote are not read).
 */
export async function summarizeOrders(orderIds: number[]): Promise<OrderSummary> {
  if (!orderIds.length) return { rows: [], bonus: [] }
  const placeholders = orderIds.map(() => "?").join(",")
  const lines = (await getDb()
    .prepare(
      `SELECT p.type AS type, (SELECT MIN(t.id) FROM product_types t WHERE t.name = p.type) AS type_id, i.quantity, i.unit_price, COALESCE(i.discount_percent, 0) AS discount_percent,
              COALESCE(i.return_quantity, 0) AS return_quantity, p.box_amount
       FROM order_items i
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id IN (${placeholders}) ORDER BY i.id ASC`,
    )
    .all(...orderIds)) as Line[]

  const group = () => {
    const grouped = new Map<string, OrderSummaryRow>()
    const typeIds = new Map<string, number>()
    for (const line of lines) {
      const type = line.type || ""
      const row = grouped.get(type) ?? { type, blocks: 0, orders: 0, returns: 0, volume: 0, sum: 0 }
      const quantity = Number(line.quantity)
      const box = Number(line.box_amount ?? 0)
      row.blocks += box > 0 ? quantity / box : 0
      row.orders += quantity
      row.returns -= Number(line.return_quantity)
      // Products carry no volume (the reference reports total_capacity 0 too), so Объём stays 0.
      row.sum += quantity * Number(line.unit_price) * (1 - Number(line.discount_percent) / 100)
      grouped.set(type, row)
      typeIds.set(type, Number(line.type_id ?? Number.MAX_SAFE_INTEGER))
    }
    // The reference lists the product types in the order of their ids.
    return [...grouped.values()].sort((a, b) => (typeIds.get(a.type) ?? 0) - (typeIds.get(b.type) ?? 0))
  }
  return { rows: group(), bonus: [] }
}
