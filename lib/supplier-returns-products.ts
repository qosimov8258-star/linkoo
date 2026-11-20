import "server-only"

import { getDb } from "@/lib/db"
import { todayIso } from "@/lib/finance/dates"
import { round6, textKey, warehouseStock } from "@/lib/internal-transfers-stock"
import { getStockBalances, getStockCatalog, getStockPending } from "@/lib/stock/ledger"

// The products a supplier return can take (Linko's stock/all_balance_supply/): every catalog product (not deleted)
// with its balance and what is available of it (the balance less the reserved goods) — in `warehouse` (the add bar of
// the return form, Linko's &stock=) or in all warehouses together (the «Добавление продуктов» list, which Linko asks
// without a warehouse) — and its price in `priceList` (0 when the list has none). Products are listed as Linko's
// balance lists do: by their «Порядковый номер» (products.order_number, ascending, the ones without a number last);
// Linko leaves the order within one number to its database, here it is the product id (as the inventory form's
// product list, lib/stock-inventories-products.ts).

export type ReturnProductOption = {
  /** The stock ledger's catalog key ("product:12"). */
  key: string
  productId: number
  name: string
  unit: string
  type: string
  /** Linko's product.code (the integration code), "" when none. */
  code: string
  barcode: string
  balance: number
  /** The balance less the reserved goods (Linko's «Доступно»). */
  available: number
  price: number
  /** «Учитывать срок годности» (Linko's use_expiration): the add bar then asks for a series. */
  useExpiration: boolean
  /** Weight and net weight of one unit (Linko's kgValue / weightNetto), 0 when unknown. */
  weight: number
  netWeight: number
}

type ProductExtra = { id: number; integration_code: string | null; track_expiry: string | number | boolean | null; order_number: string | null; net_weight: string | null }

const truthy = (value: unknown) => value === true || ["1", "true", "t"].includes(String(value ?? "").trim().toLowerCase())
const blank = (value: unknown) => {
  const text = String(value ?? "").trim()
  return text && !/^не установлен/i.test(text) && text !== "-" ? text : ""
}
const orderNumber = (value: unknown) => (/^\d{1,15}$/.test(String(value ?? "").trim()) ? Number(String(value).trim()) : null)

export async function listReturnProducts(options: { warehouse?: string; priceList?: string } = {}): Promise<ReturnProductOption[]> {
  const db = getDb()
  const warehouse = String(options.warehouse ?? "").trim()
  const priceList = String(options.priceList ?? "").trim()
  const catalog = (await getStockCatalog(db)).filter((item) => item.kind === "product")
  const balances = new Map<string, number>()
  const available = new Map<string, number>()
  if (warehouse) {
    for (const [key, stock] of await warehouseStock(warehouse, undefined, db)) {
      balances.set(key, stock.qty)
      available.set(key, stock.qty - stock.reserved)
    }
  } else {
    for (const row of await getStockBalances({ date: todayIso() }, db)) balances.set(row.key, (balances.get(row.key) ?? 0) + row.qty)
    for (const [key, qty] of balances) available.set(key, qty)
    // Linko's «Доступно» takes off every reserved good, unconfirmed orders included (its reserved column).
    for (const row of await getStockPending({}, db)) available.set(row.key, (available.get(row.key) ?? 0) - row.reserved)
  }
  const ids = catalog.map((item) => item.id)
  const extras = ids.length
    ? ((await db
        .prepare(
          `SELECT id, to_jsonb(p) ->> 'integration_code' AS integration_code, to_jsonb(p) ->> 'track_expiry' AS track_expiry,
                  to_jsonb(p) ->> 'order_number' AS order_number, to_jsonb(p) ->> 'net_weight' AS net_weight
             FROM products p WHERE id = ANY(?::int[])`,
        )
        .all(ids)) as ProductExtra[])
    : []
  const extraOf = new Map(extras.map((row) => [Number(row.id), row]))
  // A price list is named by the user in any case / spacing: match it like the catalog's other names.
  const priceOf = (prices: Record<string, number>) => {
    if (!priceList) return 0
    if (priceList in prices) return Number(prices[priceList]) || 0
    const wanted = textKey(priceList)
    const found = Object.keys(prices).find((name) => textKey(name) === wanted)
    return found ? Number(prices[found]) || 0 : 0
  }
  const rows = catalog.map((item) => {
    const extra = extraOf.get(item.id)
    return {
      order: orderNumber(extra?.order_number),
      option: {
        key: item.key,
        productId: item.id,
        name: item.name,
        unit: item.unit,
        type: item.type,
        code: blank(extra?.integration_code),
        barcode: blank(item.barcode),
        balance: round6(balances.get(item.key) ?? 0),
        available: round6(available.get(item.key) ?? 0),
        price: priceOf(item.prices),
        useExpiration: truthy(extra?.track_expiry),
        weight: Number(item.weight) || 0,
        netWeight: Number(extra?.net_weight) || 0,
      } satisfies ReturnProductOption,
    }
  })
  rows.sort((a, b) => {
    if (a.order !== b.order) {
      if (a.order === null) return 1
      if (b.order === null) return -1
      return a.order - b.order
    }
    return a.option.productId - b.option.productId
  })
  return rows.map((row) => row.option)
}
