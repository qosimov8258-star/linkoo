import "server-only"

import { getDb } from "@/lib/db"
import { formatRawMaterialDate } from "@/components/analytics/raw-materials-data"
import type { RawMaterial } from "@/components/analytics/raw-materials-data"

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
  show_as_inventory: number
  group_only: number
  show_in_bot: number
  track_expiry: number
  marked_product: number
  price_list: string
  cash_price: string
  non_cash_price: string
}

function rowToRawMaterial(row: Row): RawMaterial {
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
    showAsInventory: row.show_as_inventory === 1,
    groupOnly: row.group_only === 1,
    showInBot: row.show_in_bot === 1,
    trackExpiry: row.track_expiry === 1,
    markedProduct: row.marked_product === 1,
    priceList: row.price_list,
    cashPrice: row.cash_price,
    nonCashPrice: row.non_cash_price,
  }
}

export type RawMaterialInput = Omit<RawMaterial, "id" | "createdDate">

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function bool(value: unknown): boolean {
  return value === true
}

export function parseRawMaterialInput(body: unknown): RawMaterialInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const name = str(value.name).trim()
  const unit = str(value.unit).trim()
  if (!name || !unit) return null

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
    showAsInventory: bool(value.showAsInventory),
    groupOnly: bool(value.groupOnly),
    showInBot: value.showInBot !== false,
    trackExpiry: bool(value.trackExpiry),
    markedProduct: bool(value.markedProduct),
    priceList: str(value.priceList),
    cashPrice: str(value.cashPrice, "0"),
    nonCashPrice: str(value.nonCashPrice, "0"),
  }
}

export async function listRawMaterials(): Promise<RawMaterial[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM raw_materials ORDER BY id DESC").all()) as Row[]
  return rows.map(rowToRawMaterial)
}

export async function getRawMaterial(id: number): Promise<RawMaterial | null> {
  const db = getDb()
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
    showAsInventory: input.showAsInventory ? 1 : 0,
    groupOnly: input.groupOnly ? 1 : 0,
    showInBot: input.showInBot ? 1 : 0,
    trackExpiry: input.trackExpiry ? 1 : 0,
    markedProduct: input.markedProduct ? 1 : 0,
    priceList: input.priceList,
    cashPrice: input.cashPrice,
    nonCashPrice: input.nonCashPrice,
  }
}

export async function createRawMaterial(input: RawMaterialInput): Promise<RawMaterial> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO raw_materials (
        name, full_name, barcode, article, type, organization, unit, sub_unit, created_date, order_number,
        supplier, brand, min_stock, color, integration_code, mass, net_weight, volume, description, can_sell,
        only_mml, show_as_inventory, group_only, show_in_bot, track_expiry, marked_product, price_list, cash_price, non_cash_price
      ) VALUES (
        @name, @fullName, @barcode, @article, @type, @organization, @unit, @subUnit, @createdDate, @orderNumber,
        @supplier, @brand, @minStock, @color, @integrationCode, @mass, @netWeight, @volume, @description, @canSell,
        @onlyMml, @showAsInventory, @groupOnly, @showInBot, @trackExpiry, @markedProduct, @priceList, @cashPrice, @nonCashPrice
      )`,
      )
      .run({ ...toParams(input), createdDate: formatRawMaterialDate(new Date()) }))
  return (await getRawMaterial(Number(result.lastInsertRowid)))!
}

export async function updateRawMaterial(id: number, input: RawMaterialInput): Promise<RawMaterial | null> {
  if (!(await getRawMaterial(id))) return null
  const db = getDb()
  await db.prepare(
        `UPDATE raw_materials SET
      name = @name, full_name = @fullName, barcode = @barcode, article = @article, type = @type,
      organization = @organization, unit = @unit, sub_unit = @subUnit, order_number = @orderNumber,
      supplier = @supplier, brand = @brand, min_stock = @minStock, color = @color, integration_code = @integrationCode,
      mass = @mass, net_weight = @netWeight, volume = @volume, description = @description, can_sell = @canSell,
      only_mml = @onlyMml, show_as_inventory = @showAsInventory, group_only = @groupOnly, show_in_bot = @showInBot,
      track_expiry = @trackExpiry, marked_product = @markedProduct, price_list = @priceList, cash_price = @cashPrice,
      non_cash_price = @nonCashPrice, updated_at = datetime('now')
    WHERE id = @id`,
      ).run({ ...toParams(input), id })
  return (await getRawMaterial(id))
}

export async function deleteRawMaterial(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM raw_materials WHERE id = ?").run(id))
  return result.changes > 0
}
