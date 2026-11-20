import "server-only"

import { getDb } from "@/lib/db"
import { leadingNumber } from "@/lib/stock/catalog"
import { getStockLevelList } from "@/lib/stock/level"
import type { StockInventoryProductOption } from "@/lib/stock-inventories-types"

// «Наименование» of the inventory edit form's add row: Linko's GET stock/all_balances/?search=<q>&page_size=50 (no
// warehouse: the balance over every warehouse, option «title (balance)»). Built on the «Остаток» list
// (lib/stock/level.ts, the same rows), plus what the form needs per product: whether it keeps series
// (products.track_expiry, Linko's use_expiration) and the weight of one unit (Linko's kg_value / weight_netto).
// Order: Linko's all_balances lists the products by their «Порядковый номер» (products.order_number, ascending, the
// ones without a number last); Linko leaves the order within one number to its database, here it is the product id.

export async function listInventoryProductOptions(query: { search: string; limit: number }): Promise<{ count: number; results: StockInventoryProductOption[] }> {
  const limit = Math.min(Math.max(Math.trunc(query.limit) || 50, 1), 200)
  const list = await getStockLevelList({
    mode: "amount",
    unit: "amount",
    priceList: "",
    search: query.search,
    ordering: "",
    page: 1,
    pageSize: 0,
    warehouse: [],
    branch: [],
    type: [],
    subcategory: [],
    brand: [],
    supplier: [],
    organization: [],
    onlyHas: false,
  })
  const productIdOf = (row: (typeof list.rows)[number]) => (row.kind === "product" && row.id !== null ? Number(row.id) : null)
  const ids = list.rows.map(productIdOf).filter((id): id is number => id !== null)
  const products = new Map<number, { track: boolean; weight: number; netWeight: number; order: number | null }>()
  if (ids.length) {
    const rows = (await getDb()
      .prepare(
        `SELECT id, COALESCE((to_jsonb(p) ->> 'track_expiry')::int, 0) AS track_expiry, to_jsonb(p) ->> 'weight' AS weight, to_jsonb(p) ->> 'net_weight' AS net_weight,
                to_jsonb(p) ->> 'order_number' AS order_number
         FROM products p WHERE id = ANY(@ids::int[])`,
      )
      .all({ ids })) as Array<{ id: number; track_expiry: number; weight: string | null; net_weight: string | null; order_number: string | null }>
    for (const row of rows) {
      const order = /^\s*-?\d+(\.\d+)?\s*$/.test(row.order_number ?? "") ? Number(row.order_number) : null
      products.set(Number(row.id), { track: Number(row.track_expiry) === 1, weight: leadingNumber(row.weight), netWeight: leadingNumber(row.net_weight), order })
    }
  }
  const rank = (row: (typeof list.rows)[number]) => {
    const id = productIdOf(row)
    const order = id === null ? null : (products.get(id)?.order ?? null)
    return { order: order ?? Number.POSITIVE_INFINITY, id: id ?? Number.POSITIVE_INFINITY }
  }
  const ordered = list.rows
    .map((row, index) => ({ row, index, ...rank(row) }))
    .sort((a, b) => a.order - b.order || a.id - b.id || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.row)
  return {
    count: list.count,
    results: ordered.map((row) => {
      const productId = row.kind === "product" && row.id !== null ? Number(row.id) : null
      const product = productId === null ? undefined : products.get(productId)
      return {
        key: row.key,
        productId,
        name: row.name,
        unit: row.unit,
        balance: row.total,
        trackExpiry: product?.track ?? false,
        weight: product?.weight ?? 0,
        netWeight: product?.netWeight ?? 0,
      }
    }),
  }
}
