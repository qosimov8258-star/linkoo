import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { placeName } from "@/lib/finance/entities"
import { stockTables, type StockTables } from "@/lib/stock/schema"
import type { StockCatalogItem, StockItemKey } from "@/lib/stock/types"

// The stock catalog: every (non-deleted) product and every raw material, with
// the attributes the stock pages show and filter by.

type CatalogRow = {
  kind: "product" | "raw_material"
  id: number
  name: string
  article: string | null
  barcode: string | null
  type: string | null
  subcategory: string | null
  brand: string | null
  unit: string | null
  organization: string | null
  supplier: string | null
  cost: number | null
  initial_cost: number | null
  price_lists: string | null
  price_list: string | null
  cash_price: string | null
  min_stock: string | null
  weight: string | null
  volume: string | null
  sub_unit: string | null
}

/** Leading number of a free-text quantity ("12,5 шт." → 12.5). */
export function leadingNumber(value: unknown): number {
  const match = /-?\d[\d\s ]*(?:[.,]\d+)?/.exec(String(value ?? ""))
  if (!match) return 0
  const parsed = Number(match[0].replace(/[\s ]/g, "").replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

function parsePrices(row: CatalogRow): Record<string, number> {
  const prices: Record<string, number> = {}
  try {
    const parsed = JSON.parse(row.price_lists || "[]") as unknown
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") continue
        const { name, cash } = entry as { name?: unknown; cash?: unknown }
        const key = String(name ?? "").trim()
        if (key && !(key in prices)) prices[key] = Number(cash) || 0
      }
    }
  } catch {
    // invalid JSON: no prices
  }
  // Legacy single price list of raw materials created before the multi-list form.
  if (!Object.keys(prices).length && row.price_list?.trim()) prices[row.price_list.trim()] = leadingNumber(row.cash_price)
  return prices
}

function catalogSql(t: StockTables): string {
  const pc = (column: string, fallback = "NULL") => (t.col("products", column) ? `p.${column}` : fallback)
  const rc = (column: string, fallback = "NULL") => (t.col("raw_materials", column) ? `r.${column}` : fallback)
  const parts: string[] = []
  if (t.has("products")) {
    parts.push(`SELECT 'product' AS kind, p.id, p.name, ${pc("article")}::text AS article, ${pc("barcode")}::text AS barcode, ${pc("type")}::text AS type,
      ${pc("subcategory")}::text AS subcategory, ${pc("brand")}::text AS brand, ${pc("unit")}::text AS unit, ${pc("organization")}::text AS organization,
      ${pc("supplier")}::text AS supplier, ${pc("cost")}::double precision AS cost, ${pc("initial_cost")}::double precision AS initial_cost,
      ${pc("price_lists")}::text AS price_lists, NULL::text AS price_list, NULL::text AS cash_price, ${pc("min_stock")}::text AS min_stock,
      ${pc("weight")}::text AS weight, ${pc("volume")}::text AS volume, ${pc("sub_unit")}::text AS sub_unit
      FROM products p ${t.col("products", "deleted") ? "WHERE COALESCE(p.deleted, 0) = 0" : ""}`)
  }
  if (t.has("raw_materials")) {
    parts.push(`SELECT 'raw_material', r.id, r.name, ${rc("article")}::text, ${rc("barcode")}::text, ${rc("type")}::text, NULL::text, ${rc("brand")}::text,
      ${rc("unit")}::text, ${rc("organization")}::text, ${rc("supplier")}::text, NULL::double precision, NULL::double precision,
      ${rc("price_lists")}::text, ${rc("price_list")}::text, ${rc("cash_price")}::text, ${rc("min_stock")}::text, ${rc("mass")}::text,
      ${rc("volume")}::text, ${rc("sub_unit")}::text
      FROM raw_materials r ${t.col("raw_materials", "deleted") ? "WHERE COALESCE(r.deleted, 0) = 0" : ""}`)
  }
  return parts.join(" UNION ALL ")
}

export function catalogKey(kind: string, id: number): StockItemKey {
  return `${kind}:${id}`
}

/** Every product and raw material that is not deleted, products first, by name. */
export async function loadStockCatalog(db: PgDb = getDb(), tables?: StockTables): Promise<StockCatalogItem[]> {
  const t = tables ?? (await stockTables(db))
  const sql = catalogSql(t)
  if (!sql) return []
  const rows = (await db.prepare(sql).all()) as CatalogRow[]
  const items = rows.map((row): StockCatalogItem => {
    const cost = Number(row.cost) || 0
    return {
      key: catalogKey(row.kind, Number(row.id)),
      kind: row.kind,
      id: Number(row.id),
      name: row.name ?? "",
      article: row.article ?? "",
      type: placeName(row.type),
      brand: placeName(row.brand),
      unit: row.unit ?? "",
      organization: placeName(row.organization),
      supplier: placeName(row.supplier),
      fallbackCost: Math.round((cost > 0 ? cost : Number(row.initial_cost) || 0) * 1e6) / 1e6,
      prices: parsePrices(row),
      minStock: leadingNumber(row.min_stock),
      weight: leadingNumber(row.weight),
      subcategory: placeName(row.subcategory),
      barcode: /^не установлен/i.test(String(row.barcode ?? "").trim()) ? "" : placeName(row.barcode),
      volume: Math.max(0, leadingNumber(row.volume)),
      boxSize: Math.max(0, leadingNumber(row.sub_unit)),
    }
  })
  const rank = (item: StockCatalogItem) => (item.kind === "product" ? 0 : 1)
  return items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "ru") || a.id - b.id)
}
