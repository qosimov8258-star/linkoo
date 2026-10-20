import "server-only"

import type { Product } from "@/components/analytics/products-data"
import { parseItemPrices } from "@/lib/item-prices"
import { catalogDb } from "@/lib/products-schema"

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
    // The stored value only: a client echoing this shape back (Формирование цен) must not
    // turn an empty "Полное наименование" into the name.
    fullName: text(row.full_name),
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
    priceUpdatedDate: text(row.price_updated_date) || "Не установлена",
  }
}

export async function listProducts(): Promise<Product[]> {
  const db = await catalogDb()
  const rows = (await db.prepare("SELECT * FROM products ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToProduct)
}

export async function getProduct(id: number): Promise<Product | null> {
  const db = await catalogDb()
  const row = (await db.prepare("SELECT * FROM products WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToProduct(row) : null
}
