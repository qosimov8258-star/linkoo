import "server-only"

import type { Product } from "@/components/analytics/products-data"
import { parseItemPrices } from "@/lib/item-prices"
import { catalogDb } from "@/lib/products-schema"
import { shortRuDate } from "@/lib/ref-date"

// The default (legacy) shape of GET /api/products, POST and PUT responses: one array of
// every product, deleted ones included (`deleted`), as the existing consumers expect.
// Reads and writes of the catalog pages live in lib/products-catalog.ts / products-write.ts.

type Row = Record<string, unknown> & { id: number; name: string }

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
const flag = (value: unknown) => Number(value) === 1
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rowToProduct(row: Row): Product {
  return {
    id: Number(row.id),
    name: text(row.name),
    fullName: text(row.full_name) || text(row.name),
    barcode: text(row.barcode).trim() || "не установлен",
    article: text(row.article),
    type: text(row.type),
    organization: text(row.organization),
    unit: text(row.unit),
    subUnit: text(row.sub_unit),
    createdDate: text(row.created_date),
    orderNumber: text(row.order_number),
    hasPhoto: flag(row.has_photo),
    canSell: flag(row.can_sell),
    isInventory: flag(row.is_inventory),
    deleted: flag(row.deleted),
    onlyMml: flag(row.only_mml),
    perfectStore: flag(row.perfect_store),
    groupOnly: flag(row.group_only),
    trackExpiry: flag(row.track_expiry),
    manualDiscount: flag(row.manual_discount),
    hideFromAgent: flag(row.hide_from_agent),
    trackSeries: flag(row.track_series),
    showInBot: flag(row.show_in_bot),
    markedProduct: flag(row.marked_product),
    limitPrice: flag(row.limit_price),
    group: text(row.product_group),
    boxUnit: text(row.box_unit).trim(),
    boxAmount: num(row.box_amount),
    ikpu: text(row.ikpu),
    invoiceUnitCode: text(row.invoice_unit_code),
    vat: text(row.vat) || "Без НДС",
    salePoints: text(row.sale_points) || "0",
    subcategory: text(row.subcategory),
    brand: text(row.brand) || "No brand",
    minStock: text(row.min_stock) || "0",
    description: text(row.description) || "Не указано",
    supplier: text(row.supplier) || "Не указано",
    integrationCode: text(row.integration_code),
    volume: text(row.volume),
    weight: text(row.weight),
    netWeight: text(row.net_weight),
    color: text(row.color) || "Не указано",
    priceLists: parseItemPrices(text(row.price_lists)),
    cost: num(row.cost),
    priceMin: num(row.price_min),
    priceMax: num(row.price_max),
    priceUpdatedDate: shortRuDate(text(row.price_updated_date)) || "Не установлена",
  }
}

export async function listProducts(): Promise<Product[]> {
  const db = await catalogDb()
  // The reference's own net cost / min / max price / update date (product_reference_prices, additive) win when a product has them.
  const hasReference = ((await db.prepare("SELECT to_regclass('product_reference_prices') AS t").get()) as { t: string | null }).t
  const hasEntries = ((await db.prepare("SELECT to_regclass('price_list_entries') AS t").get()) as { t: string | null }).t
  // Products without saved prices fall back to their price-list entries ("Анализ цен", matched by name), like the catalog pages;
  // the later duplicate column replaces the table column in the row object. The order form prices its lines from these.
  // The entries are grouped once (CTE) and joined by name: a per-product subquery rescans the whole table 974 times (~20 s).
  const withEntries = hasEntries
    ? `WITH pe AS (SELECT fin_key(e.product) AS k, jsonb_agg(jsonb_build_object('name', e.price_list, 'cash', e.cash, 'nonCash', e.non_cash, 'min', 0, 'max', 0, 'currency', 'SUM', 'nonCashCurrency', 'SUM') ORDER BY e.id)::text AS j
         FROM price_list_entries e GROUP BY 1) `
    : ""
  const priceFallback = hasEntries ? `, COALESCE(NULLIF(p.price_lists, '[]'), pe.j, '[]') AS price_lists` : ""
  const entriesJoin = hasEntries ? " LEFT JOIN pe ON pe.k = fin_key(p.name)" : ""
  const sql = hasReference
    ? `${withEntries}SELECT p.*, COALESCE(r.net_cost, p.cost) AS cost, COALESCE(r.min_price, p.price_min) AS price_min, COALESCE(r.max_price, p.price_max) AS price_max,
         COALESCE(r.price_updated, p.price_updated_date) AS price_updated_date${priceFallback}
       FROM products p LEFT JOIN product_reference_prices r ON r.product_id = p.id${entriesJoin} ORDER BY p.id DESC`
    : `${withEntries}SELECT p.*${priceFallback} FROM products p${entriesJoin} ORDER BY p.id DESC`
  const rows = (await db.prepare(sql).all()) as Row[]
  return rows.map(rowToProduct)
}

export async function getProduct(id: number): Promise<Product | null> {
  const db = await catalogDb()
  const row = (await db.prepare("SELECT * FROM products WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToProduct(row) : null
}
