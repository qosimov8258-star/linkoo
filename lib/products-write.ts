import "server-only"

import { withTransaction, type PgDb } from "@/lib/db"
import { cascadeCatalogRename, catalogUsage, type CatalogRenameChange } from "@/lib/catalog-refs"
import { priceDateLabel, priceListKey, setItemPrices, type ItemPriceChange } from "@/lib/item-prices"
import { readCatalogRow, rowToItem } from "@/lib/products-catalog"
import { CATALOG_TABLE, KIND_COLUMNS, catalogDb } from "@/lib/products-schema"
import type { CatalogBulkChanges, CatalogItem, CatalogKind, CatalogPrice, CatalogUsage } from "@/lib/products-types"
import { lockWarehouseNames } from "@/lib/warehouses-refs"

// Write side of the catalog pages: create / edit (with the rename cascade and the price
// writer of lib/item-prices.ts), soft delete ("Удалённые"), restore, hard delete (only when
// unused) and the multi edit. Every write runs in one transaction serialised by the
// "linko-catalog" advisory lock (unique names across live products and raw materials,
// because documents and the stock core reference items by name).

export class CatalogError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
    readonly usage?: CatalogUsage[],
  ) {
    super(message)
  }
}

export const EDITABLE_FIELDS = [
  "name",
  "fullName",
  "barcodes",
  "article",
  "code",
  "type",
  "subcategory",
  "organization",
  "unit",
  "boxUnit",
  "boxAmount",
  "orderNumber",
  "supplier",
  "brand",
  "color",
  "description",
  "minStock",
  "weight",
  "netWeight",
  "volume",
  "ikpu",
  "invoiceUnitCode",
  "vat",
  "canSell",
  "isMml",
  "perfectStore",
  "isInventory",
  "sellOnlyBox",
  "showInBot",
  "trackExpiry",
  "trackSeries",
  "expirationDays",
  "notifyExpireDays",
  "markedProduct",
  "manualDiscount",
  "hideFromAgent",
  "limitPrice",
  "saleMinPrice",
  "saleMaxPrice",
  "salePriceCurrency",
  "salePoints",
  "boxSizes",
  "priceLists",
] as const

export type EditableField = (typeof EDITABLE_FIELDS)[number]
export type CatalogPatch = Partial<Pick<CatalogItem, EditableField>>

const REQUIRED_FOR_MARK = "Это поле обязательно для работы маркировки"
export const DUPLICATE_NAME = "Продукт с таким наименованием уже существует"
export const NOT_FOUND: Record<CatalogKind, string> = { product: "Товар не найден", raw_material: "Сырьё не найдено" }

function blankItem(kind: CatalogKind): CatalogItem {
  return {
    kind,
    id: 0,
    name: "",
    fullName: "",
    barcodes: [],
    article: "",
    code: "",
    type: "",
    subcategory: "",
    organization: "",
    unit: "",
    boxUnit: "",
    boxAmount: 0,
    orderNumber: "",
    supplier: "",
    brand: "",
    color: "",
    description: "",
    minStock: 0,
    weight: 0,
    netWeight: 0,
    volume: 0,
    ikpu: "",
    invoiceUnitCode: "",
    vat: "Без НДС",
    canSell: true,
    isMml: false,
    perfectStore: false,
    isInventory: false,
    sellOnlyBox: false,
    showInBot: true,
    trackExpiry: false,
    trackSeries: false,
    expirationDays: null,
    notifyExpireDays: null,
    markedProduct: false,
    manualDiscount: false,
    hideFromAgent: false,
    limitPrice: false,
    saleMinPrice: 0,
    saleMaxPrice: 0,
    salePriceCurrency: "",
    salePoints: 0,
    boxSizes: [],
    priceLists: [],
    priceMin: 0,
    priceMax: 0,
    priceUpdatedDate: "",
    cost: 0,
    deleted: false,
    deletedAt: "",
    createdDate: "",
    createdAt: "",
    primaryImageId: null,
    imageCount: 0,
  }
}

function applyPatch(item: CatalogItem, patch: CatalogPatch): CatalogItem {
  const next: CatalogItem = { ...item }
  for (const field of EDITABLE_FIELDS) {
    const value = patch[field]
    if (value !== undefined) (next as Record<string, unknown>)[field] = value
  }
  next.name = next.name.trim()
  next.barcodes = [...new Set(next.barcodes.map((code) => code.trim()).filter(Boolean))]
  if (!next.trackExpiry) next.trackSeries = false
  return next
}

function validate(kind: CatalogKind, item: CatalogItem): void {
  const fields: Record<string, string> = {}
  if (!item.name) fields.name = "Обязательное поле"
  if (kind === "raw_material" && !item.unit.trim()) fields.unit = "Обязательное поле"
  if (item.markedProduct) {
    if (!item.barcodes.length) fields.barcodes = REQUIRED_FOR_MARK
    if (!item.ikpu.trim()) fields.ikpu = REQUIRED_FOR_MARK
  }
  if (item.limitPrice && item.saleMinPrice > 0 && item.saleMaxPrice > 0 && item.saleMinPrice > item.saleMaxPrice) {
    fields.saleMaxPrice = "Максимальная цена меньше минимальной"
  }
  for (const entry of item.priceLists) if (!entry.name.trim()) fields.priceLists = "Не указан прайс-лист"
  if (Object.keys(fields).length) throw new CatalogError(Object.values(fields)[0], 400, fields)
}

const plain = (value: number) => String(Math.round(value * 1e6) / 1e6)

/** Stored columns of an item (everything but prices, flags of deletion and creation). */
function storedColumns(kind: CatalogKind, item: CatalogItem): Record<string, unknown> {
  const columns = KIND_COLUMNS[kind]
  return {
    name: item.name,
    full_name: item.fullName.trim(),
    barcode: item.barcodes.join(", "),
    article: item.article.trim(),
    integration_code: item.code.trim(),
    type: item.type.trim(),
    subcategory: item.subcategory.trim(),
    organization: item.organization.trim(),
    unit: item.unit.trim(),
    product_group: item.boxUnit.trim(),
    box_amount: item.boxAmount,
    // "6 dona": the group size in base units — read by the stock core as the box size.
    sub_unit: item.boxAmount > 0 ? `${plain(item.boxAmount)} ${item.unit.trim()}`.trim() : "",
    order_number: item.orderNumber.trim(),
    supplier: item.supplier.trim(),
    brand: item.brand.trim(),
    color: item.color.trim(),
    description: item.description.trim(),
    min_stock: plain(item.minStock),
    [columns.weight]: plain(item.weight),
    net_weight: plain(item.netWeight),
    volume: plain(item.volume),
    ikpu: item.ikpu.trim(),
    invoice_unit_code: item.invoiceUnitCode.trim(),
    vat: item.vat.trim() || "Без НДС",
    can_sell: item.canSell ? 1 : 0,
    only_mml: item.isMml ? 1 : 0,
    perfect_store: item.perfectStore ? 1 : 0,
    [columns.isInventory]: item.isInventory ? 1 : 0,
    group_only: item.sellOnlyBox ? 1 : 0,
    show_in_bot: item.showInBot ? 1 : 0,
    track_expiry: item.trackExpiry ? 1 : 0,
    track_series: item.trackSeries ? 1 : 0,
    expiration_days: item.trackExpiry ? item.expirationDays : null,
    notify_expire_days: item.trackExpiry ? item.notifyExpireDays : null,
    marked_product: item.markedProduct ? 1 : 0,
    manual_discount: item.manualDiscount ? 1 : 0,
    hide_from_agent: item.hideFromAgent ? 1 : 0,
    limit_price: item.limitPrice ? 1 : 0,
    sale_min_price: item.limitPrice ? item.saleMinPrice : 0,
    sale_max_price: item.limitPrice ? item.saleMaxPrice : 0,
    sale_price_currency: item.limitPrice ? item.salePriceCurrency.trim() : "",
    sale_points: plain(item.salePoints),
    box_sizes: JSON.stringify(item.boxSizes.filter((size) => size.unit.trim() || size.height || size.width || size.length)),
  }
}

export async function lockCatalog(tx: PgDb): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko-catalog')) AS ok").get()
}

/** 409 when another live product / raw material already has this name (fin_key). */
export async function assertNameAvailable(tx: PgDb, kind: CatalogKind, id: number, name: string): Promise<void> {
  const row = await tx
    .prepare(
      `SELECT 1 AS hit FROM (
         SELECT 'product' AS kind, id FROM products WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
         UNION ALL SELECT 'raw_material', id FROM raw_materials WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
       ) o WHERE NOT (o.kind = @kind AND o.id = @id) LIMIT 1`,
    )
    .get({ name, kind, id })
  if (row) throw new CatalogError(DUPLICATE_NAME, 409, { name: DUPLICATE_NAME })
}

/** Waits for stock documents being written right now (they lock their warehouses). */
async function lockStockWrites(tx: PgDb): Promise<void> {
  const warehouses = (await tx.prepare("SELECT name FROM warehouses").all()) as Array<{ name: string }>
  await lockWarehouseNames(
    tx,
    warehouses.map((row) => row.name),
  )
}

/** Upserts the wanted price lists and removes the others (the form edits the whole list). */
async function writePrices(tx: PgDb, kind: CatalogKind, id: number, wanted: CatalogPrice[], current: CatalogPrice[]): Promise<void> {
  const byKey = new Map<string, CatalogPrice>()
  for (const entry of wanted) byKey.set(priceListKey(entry.name), entry)
  const changes: ItemPriceChange[] = current.filter((entry) => !byKey.has(priceListKey(entry.name))).map((entry) => ({ priceList: entry.name, remove: true }))
  for (const entry of byKey.values()) {
    changes.push({
      priceList: entry.name.trim(),
      cash: entry.cash,
      nonCash: entry.nonCash,
      min: entry.min,
      max: entry.max,
      ...(entry.currency ? { currency: entry.currency } : {}),
      ...(entry.nonCashCurrency ? { nonCashCurrency: entry.nonCashCurrency } : {}),
    })
  }
  if (!changes.length) return
  try {
    await setItemPrices(tx, kind, id, changes)
  } catch (error) {
    if (error instanceof RangeError) throw new CatalogError(error.message, 400, { priceLists: error.message })
    throw error
  }
  // The single legacy price of old raw materials now lives in the JSON.
  if (kind === "raw_material") await tx.prepare("UPDATE raw_materials SET price_list = '' WHERE id = @id AND price_list <> ''").run({ id })
}

function setClause(values: Record<string, unknown>): string {
  return Object.keys(values)
    .map((column) => `${column} = @c_${column}`)
    .join(", ")
}

function prefixed(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).map(([column, value]) => [`c_${column}`, value]))
}

export async function createCatalogItemTx(tx: PgDb, kind: CatalogKind, patch: CatalogPatch): Promise<number> {
  const item = applyPatch(blankItem(kind), patch)
  validate(kind, item)
  await assertNameAvailable(tx, kind, 0, item.name)
  const values = { ...storedColumns(kind, item), created_date: priceDateLabel(), price_lists: "[]" }
  const columns = Object.keys(values)
  const result = await tx.prepare(`INSERT INTO ${CATALOG_TABLE[kind]} (${columns.join(", ")}) VALUES (${columns.map((column) => `@c_${column}`).join(", ")})`).run(prefixed(values))
  const id = Number(result.lastInsertRowid)
  if (item.priceLists.length) await writePrices(tx, kind, id, item.priceLists, [])
  return id
}

export async function createCatalogItem(kind: CatalogKind, patch: CatalogPatch): Promise<number> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    return createCatalogItemTx(tx, kind, patch)
  })
}

export type CatalogUpdateResult = { id: number; renamed: CatalogRenameChange[] }

/** Edits an item: omitted fields keep their value; a rename is carried into every document. */
export async function updateCatalogItemTx(tx: PgDb, kind: CatalogKind, id: number, patch: CatalogPatch): Promise<CatalogUpdateResult | null> {
  const row = await readCatalogRow(tx, kind, id, true)
  if (!row) return null
  const current = rowToItem(kind, row)
  const item = applyPatch(current, patch)
  validate(kind, item)
  let renamed: CatalogRenameChange[] = []
  if (item.name !== current.name) {
    await assertNameAvailable(tx, kind, id, item.name)
    await lockStockWrites(tx)
    renamed = await cascadeCatalogRename(tx, { kind, id, deleted: current.deleted }, current.name, item.name)
  }
  const values = storedColumns(kind, item)
  await tx.prepare(`UPDATE ${CATALOG_TABLE[kind]} SET ${setClause(values)}, updated_at = datetime('now') WHERE id = @id`).run({ ...prefixed(values), id })
  if (patch.priceLists) await writePrices(tx, kind, id, item.priceLists, current.priceLists)
  return { id, renamed }
}

export async function updateCatalogItem(kind: CatalogKind, id: number, patch: CatalogPatch): Promise<CatalogUpdateResult | null> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    return updateCatalogItemTx(tx, kind, id, patch)
  })
}

async function setDeleted(tx: PgDb, kind: CatalogKind, id: number, deleted: boolean, userName: string): Promise<boolean> {
  const row = await readCatalogRow(tx, kind, id, true)
  if (!row) return false
  const item = rowToItem(kind, row)
  if (item.deleted === deleted) return true
  if (!deleted) await assertNameAvailable(tx, kind, id, item.name)
  await tx
    .prepare(`UPDATE ${CATALOG_TABLE[kind]} SET deleted = @deleted, deleted_at = @at, deleted_by = @by, updated_at = datetime('now') WHERE id = @id`)
    .run({ deleted: deleted ? 1 : 0, at: deleted ? new Date().toISOString() : "", by: deleted ? userName : "", id })
  return true
}

/** "Восстановить": 409 when a live item took the name meanwhile. */
export async function restoreCatalogItem(kind: CatalogKind, id: number): Promise<boolean> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    return setDeleted(tx, kind, id, false, "")
  })
}

export type CatalogDeleteMode = "soft" | "hard" | "auto"

/**
 * Deletes an item. "soft" = "Удалить" (to "Удалённые", restorable); "hard" = for good, only while
 * nothing references it (409 with the usage otherwise); "auto" (the API default, as the old
 * DELETE removed the row) = for good when unused, else soft. Returns the mode applied, null = not found.
 */
export async function deleteCatalogItem(kind: CatalogKind, id: number, mode: CatalogDeleteMode, userName: string): Promise<"soft" | "hard" | null> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    if (mode === "soft") return (await setDeleted(tx, kind, id, true, userName)) ? "soft" : null
    const row = await readCatalogRow(tx, kind, id, true)
    if (!row) return null
    const item = rowToItem(kind, row)
    await lockStockWrites(tx)
    const usage = await catalogUsage(tx, { kind, id, name: item.name, deleted: item.deleted })
    if (usage.length) {
      if (mode === "auto") return (await setDeleted(tx, kind, id, true, userName)) ? "soft" : null
      throw new CatalogError("Удаление невозможно из-за связи с другими данными", 409, undefined, usage)
    }
    await tx.prepare("DELETE FROM product_images WHERE item_kind = @kind AND item_id = @id").run({ kind, id })
    await tx.prepare("DELETE FROM product_limits WHERE item_kind = @kind AND item_id = @id").run({ kind, id })
    const result = await tx.prepare(`DELETE FROM ${CATALOG_TABLE[kind]} WHERE id = @id`).run({ id })
    return result.changes > 0 ? "hard" : null
  })
}

export async function getCatalogUsage(kind: CatalogKind, id: number): Promise<CatalogUsage[] | null> {
  const db = await catalogDb()
  const row = await readCatalogRow(db, kind, id)
  if (!row) return null
  const item = rowToItem(kind, row)
  return catalogUsage(db, { kind, id, name: item.name, deleted: item.deleted })
}

/** "Изменить выбранные продукты": the same change on every selected item (one transaction). */
export async function bulkUpdateCatalog(kind: CatalogKind, ids: number[], changes: CatalogBulkChanges, userName: string): Promise<number> {
  await catalogDb()
  return withTransaction(async (tx) => {
    await lockCatalog(tx)
    const patch: CatalogPatch = {}
    for (const field of ["type", "unit", "brand", "organization", "supplier", "color", "canSell", "showInBot", "isMml", "manualDiscount", "hideFromAgent"] as const) {
      if (changes[field] !== undefined) (patch as Record<string, unknown>)[field] = changes[field]
    }
    if (changes.type !== undefined) patch.subcategory = ""
    let count = 0
    for (const id of [...new Set(ids)]) {
      if (Object.keys(patch).length) {
        const result = await updateCatalogItemTx(tx, kind, id, patch)
        if (!result) continue
      }
      if (changes.deleted !== undefined && !(await setDeleted(tx, kind, id, changes.deleted, userName))) continue
      count += 1
    }
    return count
  })
}
