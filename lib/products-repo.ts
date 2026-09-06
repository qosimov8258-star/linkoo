import "server-only"

import { getDb } from "@/lib/db"
import { formatProductDate } from "@/components/analytics/products-data"
import type { PriceListEntry, Product } from "@/components/analytics/products-data"

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
  has_photo: number
  can_sell: number
  is_inventory: number
  deleted: number
  only_mml: number
  perfect_store: number
  group_only: number
  track_expiry: number
  manual_discount: number
  hide_from_agent: number
  track_series: number
  show_in_bot: number
  marked_product: number
  limit_price: number
  product_group: string
  ikpu: string
  invoice_unit_code: string
  vat: string
  sale_points: string
  subcategory: string
  brand: string
  min_stock: string
  description: string
  supplier: string
  integration_code: string
  volume: string
  weight: string
  net_weight: string
  color: string
  price_lists: string
  cost: number
  price_min: number
  price_max: number
  price_updated_date: string
}

function rowToProduct(row: Row): Product {
  let priceLists: PriceListEntry[] = []
  try {
    priceLists = JSON.parse(row.price_lists) as PriceListEntry[]
  } catch {
    priceLists = []
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
    hasPhoto: row.has_photo === 1,
    canSell: row.can_sell === 1,
    isInventory: row.is_inventory === 1,
    deleted: row.deleted === 1,
    onlyMml: row.only_mml === 1,
    perfectStore: row.perfect_store === 1,
    groupOnly: row.group_only === 1,
    trackExpiry: row.track_expiry === 1,
    manualDiscount: row.manual_discount === 1,
    hideFromAgent: row.hide_from_agent === 1,
    trackSeries: row.track_series === 1,
    showInBot: row.show_in_bot === 1,
    markedProduct: row.marked_product === 1,
    limitPrice: row.limit_price === 1,
    group: row.product_group,
    ikpu: row.ikpu,
    invoiceUnitCode: row.invoice_unit_code,
    vat: row.vat,
    salePoints: row.sale_points,
    subcategory: row.subcategory,
    brand: row.brand,
    minStock: row.min_stock,
    description: row.description,
    supplier: row.supplier,
    integrationCode: row.integration_code,
    volume: row.volume,
    weight: row.weight,
    netWeight: row.net_weight,
    color: row.color,
    priceLists,
    cost: row.cost,
    priceMin: row.price_min,
    priceMax: row.price_max,
    priceUpdatedDate: row.price_updated_date,
  }
}

export type ProductInput = Omit<Product, "id" | "createdDate">

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function parseProductInput(body: unknown): ProductInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = str(value.name).trim()
  if (!name) return null

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
    unit: str(value.unit),
    subUnit: str(value.subUnit),
    orderNumber: str(value.orderNumber),
    hasPhoto: bool(value.hasPhoto),
    canSell: value.canSell !== false,
    isInventory: bool(value.isInventory),
    deleted: bool(value.deleted),
    onlyMml: bool(value.onlyMml),
    perfectStore: bool(value.perfectStore),
    groupOnly: bool(value.groupOnly),
    trackExpiry: bool(value.trackExpiry),
    manualDiscount: bool(value.manualDiscount),
    hideFromAgent: bool(value.hideFromAgent),
    trackSeries: bool(value.trackSeries),
    showInBot: value.showInBot !== false,
    markedProduct: bool(value.markedProduct),
    limitPrice: bool(value.limitPrice),
    group: str(value.group),
    ikpu: str(value.ikpu),
    invoiceUnitCode: str(value.invoiceUnitCode),
    vat: str(value.vat, "Без НДС"),
    salePoints: str(value.salePoints, "0"),
    subcategory: str(value.subcategory),
    brand: str(value.brand, "No brand"),
    minStock: str(value.minStock, "0 шт."),
    description: str(value.description, "Не указано"),
    supplier: str(value.supplier, "Не указано"),
    integrationCode: str(value.integrationCode),
    volume: str(value.volume, "Не указано м³."),
    weight: str(value.weight, "0 кг."),
    netWeight: str(value.netWeight, "0"),
    color: str(value.color, "Не указано"),
    priceLists,
    cost: num(value.cost),
    priceMin: num(value.priceMin),
    priceMax: num(value.priceMax),
    priceUpdatedDate: str(value.priceUpdatedDate, "Не установлена"),
  }
}

export async function listProducts(): Promise<Product[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM products ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToProduct)
}

export async function getProduct(id: number): Promise<Product | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM products WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToProduct(row) : null
}

function toParams(input: ProductInput) {
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
    hasPhoto: input.hasPhoto ? 1 : 0,
    canSell: input.canSell ? 1 : 0,
    isInventory: input.isInventory ? 1 : 0,
    deleted: input.deleted ? 1 : 0,
    onlyMml: input.onlyMml ? 1 : 0,
    perfectStore: input.perfectStore ? 1 : 0,
    groupOnly: input.groupOnly ? 1 : 0,
    trackExpiry: input.trackExpiry ? 1 : 0,
    manualDiscount: input.manualDiscount ? 1 : 0,
    hideFromAgent: input.hideFromAgent ? 1 : 0,
    trackSeries: input.trackSeries ? 1 : 0,
    showInBot: input.showInBot ? 1 : 0,
    markedProduct: input.markedProduct ? 1 : 0,
    limitPrice: input.limitPrice ? 1 : 0,
    group: input.group,
    ikpu: input.ikpu,
    invoiceUnitCode: input.invoiceUnitCode,
    vat: input.vat,
    salePoints: input.salePoints,
    subcategory: input.subcategory,
    brand: input.brand,
    minStock: input.minStock,
    description: input.description,
    supplier: input.supplier,
    integrationCode: input.integrationCode,
    volume: input.volume,
    weight: input.weight,
    netWeight: input.netWeight,
    color: input.color,
    priceLists: JSON.stringify(input.priceLists),
    cost: input.cost,
    priceMin: input.priceMin,
    priceMax: input.priceMax,
    priceUpdatedDate: input.priceUpdatedDate,
  }
}

export async function createProduct(input: ProductInput): Promise<Product> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO products (
        name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number,
        has_photo, can_sell, is_inventory, deleted, only_mml, perfect_store, group_only, track_expiry,
        manual_discount, hide_from_agent, track_series, show_in_bot, marked_product, limit_price, product_group,
        ikpu, invoice_unit_code, vat, sale_points, subcategory, brand, min_stock, description, supplier,
        integration_code, volume, weight, net_weight, color, price_lists, cost, price_min, price_max, price_updated_date
      ) VALUES (
        @name, @fullName, @barcode, @article, @type, @organization, @unit, @subUnit, @createdDate, @orderNumber,
        @hasPhoto, @canSell, @isInventory, @deleted, @onlyMml, @perfectStore, @groupOnly, @trackExpiry,
        @manualDiscount, @hideFromAgent, @trackSeries, @showInBot, @markedProduct, @limitPrice, @group,
        @ikpu, @invoiceUnitCode, @vat, @salePoints, @subcategory, @brand, @minStock, @description, @supplier,
        @integrationCode, @volume, @weight, @netWeight, @color, @priceLists, @cost, @priceMin, @priceMax, @priceUpdatedDate
      )`,
      )
      .run({ ...toParams(input), createdDate: formatProductDate(new Date()) }))
  return (await getProduct(Number(result.lastInsertRowid)))!
}

export async function updateProduct(id: number, input: ProductInput): Promise<Product | null> {
  if (!(await getProduct(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE products SET
      name = @name, full_name = @fullName, barcode = @barcode, article = @article, type = @type,
      organization = @organization, unit = @unit, sub_unit = @subUnit, order_number = @orderNumber,
      has_photo = @hasPhoto, can_sell = @canSell, is_inventory = @isInventory, deleted = @deleted,
      only_mml = @onlyMml, perfect_store = @perfectStore, group_only = @groupOnly, track_expiry = @trackExpiry,
      manual_discount = @manualDiscount, hide_from_agent = @hideFromAgent, track_series = @trackSeries,
      show_in_bot = @showInBot, marked_product = @markedProduct, limit_price = @limitPrice, product_group = @group,
      ikpu = @ikpu, invoice_unit_code = @invoiceUnitCode, vat = @vat, sale_points = @salePoints,
      subcategory = @subcategory, brand = @brand, min_stock = @minStock, description = @description,
      supplier = @supplier, integration_code = @integrationCode, volume = @volume, weight = @weight,
      net_weight = @netWeight, color = @color, price_lists = @priceLists, cost = @cost, price_min = @priceMin,
      price_max = @priceMax, price_updated_date = @priceUpdatedDate, updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(input), id })
  return (await getProduct(id))
}

export async function deleteProduct(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM products WHERE id = ?").run(id))
  return result.changes > 0
}
