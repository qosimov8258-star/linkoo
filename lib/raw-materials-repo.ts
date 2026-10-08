import "server-only"

import { getDb } from "@/lib/db"
import { formatRawMaterialDate } from "@/components/analytics/raw-materials-data"
import type { PriceListEntry, RawMaterial } from "@/components/analytics/raw-materials-data"

// Additive columns for the full "Добавить сырьё" form (parity with the
// product form: Perfect Store, group, ИКПУ/НДС, sale points, multiple price
// lists with min/max limiting) so a database created before that form
// existed still works — ADD COLUMN IF NOT EXISTS is a no-op once the column
// is already there.
async function ensureSchema(db: ReturnType<typeof getDb>) {
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS perfect_store INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS limit_price INTEGER NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS product_group TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS ikpu TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS invoice_unit_code TEXT NOT NULL DEFAULT '';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS vat TEXT NOT NULL DEFAULT 'Без НДС';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS sale_points TEXT NOT NULL DEFAULT '0';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_lists TEXT NOT NULL DEFAULT '[]';`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_min REAL NOT NULL DEFAULT 0;`)
  await db.exec(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS price_max REAL NOT NULL DEFAULT 0;`)
}

type Row = {
  id: number
  name: string
  full_name: string
  barcode: string
  article: string
  type: string
  organization: string
  unit: string
  sub_unit: string
  created_date: string
  order_number: string
  supplier: string
  brand: string
  min_stock: string
  color: string
  integration_code: string
  mass: string
  net_weight: string
  volume: string
  description: string
  can_sell: number
  only_mml: number
  perfect_store: number
  show_as_inventory: number
  group_only: number
  show_in_bot: number
  track_expiry: number
  marked_product: number
  limit_price: number
  product_group: string
  ikpu: string
  invoice_unit_code: string
  vat: string
  sale_points: string
  price_lists: string
  price_min: number
  price_max: number
  // Legacy single price-list columns, kept only so raw materials created
  // before the multi price-list form existed still show their price.
  price_list: string
  cash_price: string
  non_cash_price: string
}

function rowToRawMaterial(row: Row): RawMaterial {
  let priceLists: PriceListEntry[] = []
  try {
    priceLists = JSON.parse(row.price_lists) as PriceListEntry[]
  } catch {
    priceLists = []
  }
  if (!priceLists.length && row.price_list) {
    priceLists = [
      {
        name: row.price_list,
        cash: Number(row.cash_price) || 0,
        nonCash: Number(row.non_cash_price) || 0,
        min: 0,
        max: 0,
        currency: "SUM",
        nonCashCurrency: "SUM",
      },
    ]
  }
  return {
    id: row.id,
    name: row.name,
    fullName: row.full_name,
    barcode: row.barcode,
    article: row.article,
    type: row.type,
    organization: row.organization,
    unit: row.unit,
    subUnit: row.sub_unit,
    createdDate: row.created_date,
    orderNumber: row.order_number,
    supplier: row.supplier,
    brand: row.brand,
    minStock: row.min_stock,
    color: row.color,
    integrationCode: row.integration_code,
    mass: row.mass,
    netWeight: row.net_weight,
    volume: row.volume,
    description: row.description,
    canSell: row.can_sell === 1,
    onlyMml: row.only_mml === 1,
    perfectStore: row.perfect_store === 1,
    showAsInventory: row.show_as_inventory === 1,
    groupOnly: row.group_only === 1,
    showInBot: row.show_in_bot === 1,
    trackExpiry: row.track_expiry === 1,
    markedProduct: row.marked_product === 1,
    limitPrice: row.limit_price === 1,
    group: row.product_group,
    ikpu: row.ikpu,
    invoiceUnitCode: row.invoice_unit_code,
    vat: row.vat,
    salePoints: row.sale_points,
    priceLists,
    priceMin: row.price_min,
    priceMax: row.price_max,
  }
}

export type RawMaterialInput = Omit<RawMaterial, "id" | "createdDate">

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function parseRawMaterialInput(body: unknown): RawMaterialInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = str(value.name).trim()
  const unit = str(value.unit).trim()
  if (!name || !unit) return null

  let priceLists: PriceListEntry[] = []
  if (Array.isArray(value.priceLists)) {
    priceLists = value.priceLists
      .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
      .map((entry) => ({
        name: str(entry.name),
        cash: num(entry.cash),
        nonCash: num(entry.nonCash),
        min: num(entry.min),
        max: num(entry.max),
        currency: str(entry.currency, "SUM"),
        nonCashCurrency: str(entry.nonCashCurrency, "SUM"),
      }))
  }

  return {
    name,
    fullName: str(value.fullName).trim() || name,
    barcode: str(value.barcode).trim() || "не установлен",
    article: str(value.article),
    type: str(value.type),
    organization: str(value.organization),
    unit,
    subUnit: str(value.subUnit),
    orderNumber: str(value.orderNumber),
    supplier: str(value.supplier, "Не указано"),
    brand: str(value.brand, "No brand"),
    minStock: str(value.minStock, "0"),
    color: str(value.color, "Не указано"),
    integrationCode: str(value.integrationCode),
    mass: str(value.mass, "0"),
    netWeight: str(value.netWeight, "0"),
    volume: str(value.volume, "Не указано"),
    description: str(value.description, "Не указано"),
    canSell: value.canSell !== false,
    onlyMml: bool(value.onlyMml),
    perfectStore: bool(value.perfectStore),
    showAsInventory: bool(value.showAsInventory),
    groupOnly: bool(value.groupOnly),
    showInBot: value.showInBot !== false,
    trackExpiry: bool(value.trackExpiry),
    markedProduct: bool(value.markedProduct),
    limitPrice: bool(value.limitPrice),
    group: str(value.group),
    ikpu: str(value.ikpu),
    invoiceUnitCode: str(value.invoiceUnitCode),
    vat: str(value.vat, "Без НДС"),
    salePoints: str(value.salePoints, "0"),
    priceLists,
    priceMin: num(value.priceMin),
    priceMax: num(value.priceMax),
  }
}

export async function listRawMaterials(): Promise<RawMaterial[]> {
  const db = getDb()
  await ensureSchema(db)
  const rows = (await db.prepare("SELECT * FROM raw_materials ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToRawMaterial)
}

export async function getRawMaterial(id: number): Promise<RawMaterial | null> {
  const db = getDb()
  await ensureSchema(db)
  const row = (await db.prepare("SELECT * FROM raw_materials WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToRawMaterial(row) : null
}

function toParams(input: RawMaterialInput) {
  return {
    name: input.name,
    fullName: input.fullName,
    barcode: input.barcode,
    article: input.article,
    type: input.type,
    organization: input.organization,
    unit: input.unit,
    subUnit: input.subUnit,
    orderNumber: input.orderNumber,
    supplier: input.supplier,
    brand: input.brand,
    minStock: input.minStock,
    color: input.color,
    integrationCode: input.integrationCode,
    mass: input.mass,
    netWeight: input.netWeight,
    volume: input.volume,
    description: input.description,
    canSell: input.canSell ? 1 : 0,
    onlyMml: input.onlyMml ? 1 : 0,
    perfectStore: input.perfectStore ? 1 : 0,
    showAsInventory: input.showAsInventory ? 1 : 0,
    groupOnly: input.groupOnly ? 1 : 0,
    showInBot: input.showInBot ? 1 : 0,
    trackExpiry: input.trackExpiry ? 1 : 0,
    markedProduct: input.markedProduct ? 1 : 0,
    limitPrice: input.limitPrice ? 1 : 0,
    group: input.group,
    ikpu: input.ikpu,
    invoiceUnitCode: input.invoiceUnitCode,
    vat: input.vat,
    salePoints: input.salePoints,
    priceLists: JSON.stringify(input.priceLists),
    priceMin: input.priceMin,
    priceMax: input.priceMax,
  }
}

export async function createRawMaterial(input: RawMaterialInput): Promise<RawMaterial> {
  const db = getDb()
  await ensureSchema(db)
  const result = (await db
      .prepare(
        `INSERT INTO raw_materials (
        name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number,
        supplier, brand, min_stock, color, integration_code, mass, net_weight, volume, description, can_sell,
        only_mml, perfect_store, show_as_inventory, group_only, show_in_bot, track_expiry, marked_product, limit_price,
        product_group, ikpu, invoice_unit_code, vat, sale_points, price_lists, price_min, price_max
      ) VALUES (
        @name, @fullName, @barcode, @article, @type, @organization, @unit, @subUnit, @createdDate, @orderNumber,
        @supplier, @brand, @minStock, @color, @integrationCode, @mass, @netWeight, @volume, @description, @canSell,
        @onlyMml, @perfectStore, @showAsInventory, @groupOnly, @showInBot, @trackExpiry, @markedProduct, @limitPrice,
        @group, @ikpu, @invoiceUnitCode, @vat, @salePoints, @priceLists, @priceMin, @priceMax
      )`,
      )
      .run({ ...toParams(input), createdDate: formatRawMaterialDate(new Date()) }))
  return (await getRawMaterial(Number(result.lastInsertRowid)))!
}

export async function updateRawMaterial(id: number, input: RawMaterialInput): Promise<RawMaterial | null> {
  if (!(await getRawMaterial(id))) return null
  const db = getDb()
  await ensureSchema(db)
  await db.prepare(
        `UPDATE raw_materials SET
      name = @name, full_name = @fullName, barcode = @barcode, article = @article, type = @type,
      organization = @organization, unit = @unit, sub_unit = @subUnit, order_number = @orderNumber,
      supplier = @supplier, brand = @brand, min_stock = @minStock, color = @color, integration_code = @integrationCode,
      mass = @mass, net_weight = @netWeight, volume = @volume, description = @description, can_sell = @canSell,
      only_mml = @onlyMml, perfect_store = @perfectStore, show_as_inventory = @showAsInventory, group_only = @groupOnly,
      show_in_bot = @showInBot, track_expiry = @trackExpiry, marked_product = @markedProduct, limit_price = @limitPrice,
      product_group = @group, ikpu = @ikpu, invoice_unit_code = @invoiceUnitCode, vat = @vat, sale_points = @salePoints,
      price_lists = @priceLists, price_min = @priceMin, price_max = @priceMax, updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(input), id })
  return (await getRawMaterial(id))
}

export async function deleteRawMaterial(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM raw_materials WHERE id = ?").run(id))
  return result.changes > 0
}
