import "server-only"

import type { RawMaterial } from "@/components/analytics/raw-materials-data"
import { catalogDb } from "@/lib/products-schema"
import { parseItemPrices } from "@/lib/item-prices"
import { leadingNumber } from "@/lib/products-types"

// The default (legacy) shape of GET /api/raw-materials, POST and PUT responses: raw
// materials that are not deleted (?includeDeleted=1 adds the "Удалённые" ones with
// `deleted: true`). Reads and writes of the catalog pages live in lib/products-catalog.ts /
// products-write.ts.

type Row = Record<string, unknown> & { id: number; name: string }

const text = (value: unknown) => (value === null || value === undefined ? "" : String(value))
const flag = (value: unknown) => Number(value) === 1
const num = (value: unknown) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function rowToRawMaterial(row: Row, withDeleted: boolean): RawMaterial {
  let priceLists = parseItemPrices(text(row.price_lists))
  // Legacy single price-list columns of raw materials created before the multi-list form.
  if (!priceLists.length && text(row.price_list).trim()) {
    const cash = leadingNumber(row.cash_price)
    priceLists = [{ name: text(row.price_list).trim(), cash, nonCash: leadingNumber(row.non_cash_price) || cash, min: 0, max: 0, currency: "SUM", nonCashCurrency: "SUM" }]
  }
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
    supplier: text(row.supplier) || "Не указано",
    brand: text(row.brand) || "No brand",
    minStock: text(row.min_stock) || "0",
    color: text(row.color) || "Не указано",
    integrationCode: text(row.integration_code),
    mass: text(row.mass) || "0",
    netWeight: text(row.net_weight) || "0",
    volume: text(row.volume) || "Не указано",
    description: text(row.description) || "Не указано",
    canSell: flag(row.can_sell),
    onlyMml: flag(row.only_mml),
    perfectStore: flag(row.perfect_store),
    showAsInventory: flag(row.show_as_inventory),
    groupOnly: flag(row.group_only),
    showInBot: flag(row.show_in_bot),
    trackExpiry: flag(row.track_expiry),
    markedProduct: flag(row.marked_product),
    limitPrice: flag(row.limit_price),
    group: text(row.product_group),
    ikpu: text(row.ikpu),
    invoiceUnitCode: text(row.invoice_unit_code),
    vat: text(row.vat) || "Без НДС",
    salePoints: text(row.sale_points) || "0",
    priceLists,
    priceMin: num(row.price_min),
    priceMax: num(row.price_max),
    ...(withDeleted ? { deleted: flag(row.deleted) } : {}),
  }
}

export async function listRawMaterials(includeDeleted = false): Promise<RawMaterial[]> {
  const db = await catalogDb()
  const where = includeDeleted ? "" : "WHERE COALESCE(deleted, 0) = 0"
  const rows = (await db.prepare(`SELECT * FROM raw_materials ${where} ORDER BY id DESC`).all()) as Row[]
  return rows.map((row) => rowToRawMaterial(row, includeDeleted))
}

export async function getRawMaterial(id: number): Promise<RawMaterial | null> {
  const db = await catalogDb()
  const row = (await db.prepare("SELECT * FROM raw_materials WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRawMaterial(row, true) : null
}
