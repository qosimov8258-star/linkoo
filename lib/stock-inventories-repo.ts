import "server-only"

import { getDb, isolated, withTransaction, type PgDb } from "@/lib/db"
import { DOC_DATE_INVALID, docYearOk } from "@/lib/document-dates"
import { loadCurrencyContext } from "@/lib/finance/context"
import { isIsoDay, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { checkDay, findWarehouse, lockDocumentWarehouses, lockWarehouseStock, shortageMessage } from "@/lib/internal-transfers-stock"
import type { StockShortage } from "@/lib/internal-transfers-types"
import { leadingNumber } from "@/lib/stock/catalog"
import { getStockBalances } from "@/lib/stock/ledger"
import { stockOrphanNames } from "@/lib/stock/level"
import { minBalancesFrom } from "@/lib/stock/min-balance"
import { ensureStockSchema } from "@/lib/stock/schema"
import type { StockCatalogItem } from "@/lib/stock/types"
import { StockInventoryError } from "@/lib/stock-inventories-api"
import {
  getInventoryBalances,
  loadCatalogMap,
  nameFromKey,
  round6,
  snapshotLines,
  textKey,
  type BalanceMoment,
  type LineSnapshot,
} from "@/lib/stock-inventories-balances"
import { ensureStockInventoriesSchema } from "@/lib/stock-inventories-schema"
import type {
  StockInventoryDetail,
  StockInventoryImportInput,
  StockInventoryInput,
  StockInventoryItem,
  StockInventoryListQuery,
  StockInventoryListResult,
  StockInventoryOptions,
  StockInventoryRow,
  StockInventoryStatus,
  StockInventoryType,
} from "@/lib/stock-inventories-types"

// "Инвентаризация" (demo #/inventory, API stock/inventory/): list / detail /
// create / update while pending, delete (pending or confirmed), confirm (pending → confirmed: the
// system balance, diff, cost and sum of every line are frozen from the stock
// core in one transaction) and cancel (confirmed → canceled: the core reads
// confirmed inventories only, so the stock goes back). Demo rules: edit and
// confirm only while pending, "Отменить" (cancel_accept) only once confirmed.
// No stock may go negative on any day (business rule 8): a confirmed shortage
// (diff < 0) and the undo of a surplus (diff > 0) take GOOD units out from the
// inventory day on (the stock core books inventory differences as good units,
// never as Брак), so both are refused (409) when a later day's good stock —
// after the outflows already booked — could not cover them.

type InventoryRow = {
  id: number
  warehouse: string
  inv_date: string
  for_day_end: number
  type: string
  status: string
  comment: string
  currency: string
  total_price: number
  created_by: string
  created_at: string
  confirmed_at: string
  confirmed_by: string
  canceled_at: string
  canceled_by: string
  booked_by_documents?: number | string | null
  item_count?: number | string
}

type ItemRow = {
  id: number
  item_key: string
  item_name: string
  unit: string
  amount: number
  balance_amount: number
  diff: number
  cost: number
  total_price: number
  series: string
  series_id: number | null
  total_weight: number | null
  total_weight_netto: number | null
  position: number
}

type Line = { key: string; name: string; unit: string; amount: number; series: string; seriesId: number | null; position: number }

const NOT_FOUND = "Инвентаризация не найдена"
const WAREHOUSE_KEY_SQL = "regexp_replace(lower(btrim(i.warehouse)), '\\s+', ' ', 'g')"

// Sort keys of the list; several apply in order (Linko's "created_date,-id"), then the newest first.
const ORDER_COLUMNS: Record<string, string[]> = { id: ["i.id"], created_date: ["i.inv_date", "i.created_at"], total_price: ["i.total_price"] }

function orderBy(keys: StockInventoryListQuery["ordering"]): string {
  const parts = keys.flatMap((key) => (ORDER_COLUMNS[key.replace(/^-/, "")] ?? []).map((column) => `${column} ${key.startsWith("-") ? "DESC" : "ASC"}`))
  return [...parts, "i.id DESC"].join(", ")
}

function userName(user: { displayName?: string; username?: string }): string {
  return (user.displayName || user.username || "").trim()
}

function asStatus(value: string): StockInventoryStatus {
  return value === "confirmed" || value === "canceled" ? value : "pending"
}

function asType(value: string): StockInventoryType {
  return value === "custom_date" ? "custom_date" : "fact_date"
}

function localTime(utcText: string): string {
  return utcText ? (parseAnyDate(utcText, true) ?? "") : ""
}

function toRow(row: InventoryRow): StockInventoryRow {
  const type = asType(row.type)
  const createdAt = localTime(row.created_at)
  return {
    id: Number(row.id),
    warehouse: row.warehouse,
    type,
    invDate: row.inv_date,
    forDayEnd: Number(row.for_day_end) === 1,
    status: asStatus(row.status),
    comment: row.comment ?? "",
    currency: row.currency ?? "",
    totalPrice: round6(Number(row.total_price) || 0),
    createdBy: row.created_by ?? "",
    createdAt,
    createdDate: type === "fact_date" ? createdAt || row.inv_date : row.inv_date,
    itemCount: Number(row.item_count ?? 0),
  }
}

/** products.id of a "product:<id>" key, else null. */
function productIdOf(key: string): number | null {
  const match = /^product:(\d{1,10})$/.exec(key)
  return match ? Number(match[1]) : null
}

function toItem(row: ItemRow, catalog: Map<string, StockCatalogItem> | null, tracked: Set<number>): StockInventoryItem {
  const amount = round6(Number(row.amount) || 0)
  const productId = productIdOf(row.item_key)
  return {
    id: Number(row.id),
    key: row.item_key,
    name: row.item_name,
    article: catalog?.get(row.item_key)?.article ?? "",
    unit: row.unit || catalog?.get(row.item_key)?.unit || "",
    series: row.series ?? "",
    seriesId: row.series_id == null ? null : Number(row.series_id),
    productId,
    trackExpiry: productId !== null && tracked.has(productId),
    amount,
    balanceAmount: round6(Number(row.balance_amount) || 0),
    diff: round6(Number(row.diff) || 0),
    cost: round6(Number(row.cost) || 0),
    totalPrice: round6(Number(row.total_price) || 0),
    totalWeight: round6(Number(row.total_weight) || 0),
    totalWeightNetto: round6(Number(row.total_weight_netto) || 0),
    position: Number(row.position) || 0,
  }
}

function momentOf(row: Pick<InventoryRow, "warehouse" | "inv_date" | "for_day_end">, excludeInventoryId?: number): BalanceMoment {
  return { warehouse: row.warehouse, date: row.inv_date, forDayEnd: Number(row.for_day_end) === 1, excludeInventoryId }
}

async function lockRow(db: PgDb, id: number): Promise<InventoryRow> {
  const row = (await db.prepare("SELECT * FROM stock_inventories WHERE id = ? FOR UPDATE").get(id)) as InventoryRow | undefined
  if (!row) throw new StockInventoryError(NOT_FOUND, 404)
  return row
}

/** Serialises the stock writers of the inventory's warehouse: the documents' lock
 * (lib/internal-transfers-stock.ts, "linko-stock:<key>") first, then the confirms'
 * ("stock_inventory:<key>"), the order lib/warehouses-refs.ts lockWarehouseNames uses. */
async function lockInventoryWarehouse(tx: PgDb, warehouse: string): Promise<void> {
  await lockWarehouseStock(tx, [warehouse])
  await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(?)) AS locked").get(`stock_inventory:${textKey(warehouse)}`)
}

/** The inventory's warehouse was renamed between the unlocked read and its locks. */
class WarehouseRenamed extends Error {}

/**
 * Runs `fn` in one transaction with the inventory's warehouse locks AND its row lock,
 * taken in the order a warehouse rename takes them (lib/warehouses-refs.ts
 * lockWarehouseNames, then cascadeWarehouseRename's row updates): the advisory locks
 * of the warehouse first, the stock_inventories row second — the reverse order
 * deadlocks against a concurrent rename. The warehouse is read without a lock first;
 * when a rename lands in between (the locked row names another warehouse) the
 * transaction rolls back and runs again with the new name.
 */
async function withInventoryLocked(id: number, fn: (tx: PgDb, row: InventoryRow) => Promise<void>): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await withTransaction(async (tx) => {
        const peek = (await tx.prepare("SELECT warehouse FROM stock_inventories WHERE id = ?").get(id)) as Pick<InventoryRow, "warehouse"> | undefined
        if (!peek) throw new StockInventoryError(NOT_FOUND, 404)
        await lockInventoryWarehouse(tx, peek.warehouse)
        const row = await lockRow(tx, id)
        if (textKey(row.warehouse) !== textKey(peek.warehouse)) throw new WarehouseRenamed()
        await fn(tx, row)
      })
      return
    } catch (error) {
      if (!(error instanceof WarehouseRenamed)) throw error
    }
  }
  throw new StockInventoryError("Не удалось рассчитать остатки склада", 503)
}

/** The ledger key of an inventory line ("name:" lines by fin_key of the name, as the core books them). */
const ledgerLineKey = (key: string) => (key.startsWith("name:") ? `name:${textKey(key.slice(5))}` : key)

/** Refuses (409) quantities taken out of the inventory's warehouse from the inventory day on
 * when the smallest end-of-day GOOD balance (on hand − Брак) over those days (today and
 * the documents dated ahead included) cannot cover them. Inventory differences are booked
 * as good units (lib/stock/sources.ts, is_defect = 0), so Брак on hand never covers them:
 * a count below the Брак on hand waits until that Брак is written off (a "Брак" line). */
async function requireStockFromInventoryDay(
  tx: PgDb,
  row: InventoryRow,
  needs: Array<{ key: string; name: string; unit: string; qty: number }>,
  prefix: string,
): Promise<void> {
  const required = new Map<string, { key: string; name: string; unit: string; qty: number }>()
  for (const need of needs) {
    if (!(need.qty > 0)) continue
    const key = ledgerLineKey(need.key)
    const current = required.get(key)
    if (current) current.qty += need.qty
    else required.set(key, { ...need, key })
  }
  if (!required.size) return
  const balances = await minBalancesFrom(row.warehouse, checkDay(parseAnyDay(row.inv_date) ?? row.inv_date.slice(0, 10)), tx)
  const shortages: StockShortage[] = []
  for (const need of required.values()) {
    const available = balances.get(need.key)?.minGood ?? 0
    if (need.qty > available + 1e-9) {
      shortages.push({ key: need.key, product: need.name, unit: need.unit, required: round6(need.qty), available: round6(Math.max(0, available)) })
    }
  }
  if (shortages.length) throw new StockInventoryError(`${prefix}${shortageMessage(row.warehouse, shortages)}`, 409, undefined, { shortages })
}

async function catalogOrFail(db: PgDb): Promise<Map<string, StockCatalogItem>> {
  try {
    return await loadCatalogMap(db)
  } catch (error) {
    console.error("stock inventories: catalog", error)
    throw new StockInventoryError("Не удалось загрузить остатки склада", 503)
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listStockInventories(query: StockInventoryListQuery): Promise<StockInventoryListResult> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const params = {
    needle: textKey(query.search),
    status: query.status,
    warehouses: query.warehouses.map(textKey),
    createdBy: query.createdBy,
    fromDate: query.fromDate,
    toDate: query.toDate,
  }
  // Linko's stock/inventory/?search= matches the number only («13» → 13, 113, 130 … 133); a warehouse, a creator or a
  // product name finds nothing there.
  const where = `
    (@needle = '' OR strpos(i.id::text, @needle) > 0)
    AND (@status = '' OR i.status = @status)
    AND (cardinality(@warehouses::text[]) = 0 OR ${WAREHOUSE_KEY_SQL} = ANY(@warehouses::text[]))
    AND (cardinality(@createdBy::text[]) = 0 OR i.created_by = ANY(@createdBy::text[]))
    AND (@fromDate = '' OR i.inv_date >= @fromDate)
    AND (@toDate = '' OR i.inv_date <= @toDate)`
  const countRow = (await db.prepare(`SELECT count(*)::int AS n FROM stock_inventories i WHERE ${where}`).get(params)) as { n: number } | undefined
  const paging = query.pageSize ? `LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}` : ""
  const rows = (await db
    .prepare(
      `SELECT i.*, COALESCE(c.n, 0) AS item_count
       FROM stock_inventories i
       LEFT JOIN (SELECT inventory_id, count(*)::int AS n FROM stock_inventory_items GROUP BY inventory_id) c ON c.inventory_id = i.id
       WHERE ${where}
       ORDER BY ${orderBy(query.ordering)} ${paging}`,
    )
    .all(params)) as InventoryRow[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(toRow) }
}

/** Detail. Like Linko's GET stock/inventory/:id/, every status shows the values stored on the document: a pending
 * inventory keeps the system balance / difference / sum computed when it was last saved (create / «Изменение»), so the
 * card, its Excel and the list «Сумма» agree; confirming computes them again at that moment. */
export async function getStockInventory(id: number): Promise<StockInventoryDetail | null> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM stock_inventories WHERE id = ?").get(id)) as InventoryRow | undefined
  if (!row) return null
  const items = (await db.prepare("SELECT * FROM stock_inventory_items WHERE inventory_id = ? ORDER BY position, id").all(id)) as ItemRow[]
  let catalog: Map<string, StockCatalogItem> | null = null
  try {
    catalog = await loadCatalogMap(db)
  } catch (error) {
    // Only the articles come from the catalog: the card still opens without them.
    console.error("stock inventories: catalog", error)
  }
  const tracked = await trackedProducts(db, items.map((item) => productIdOf(item.item_key)))
  return {
    ...toRow({ ...row, item_count: items.length }),
    confirmedAt: localTime(row.confirmed_at),
    confirmedBy: row.confirmed_by ?? "",
    canceledAt: localTime(row.canceled_at),
    canceledBy: row.canceled_by ?? "",
    items: items.map((item) => toItem(item, catalog, tracked)),
  }
}

/** The products among `ids` that keep expiry dates / series (products.track_expiry = 1). */
async function trackedProducts(db: PgDb, ids: Array<number | null>): Promise<Set<number>> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))]
  if (!wanted.length) return new Set()
  const rows = (await db
    .prepare("SELECT id FROM products WHERE id = ANY(@ids::int[]) AND COALESCE((to_jsonb(products) ->> 'track_expiry')::int, 0) = 1")
    .all({ ids: wanted })) as Array<{ id: number }>
  return new Set(rows.map((row) => Number(row.id)))
}

async function requireDetail(id: number): Promise<StockInventoryDetail> {
  const detail = await getStockInventory(id)
  if (!detail) throw new StockInventoryError(NOT_FOUND, 404)
  return detail
}

/** Warehouses, creators ("Создал" filter) and the base currency. `warehouses` (the list filter) is,
 * as Linko's, the warehouses linked to the signed-in user's employee card («Связанные склады», in their
 * id order: `linked`), else every warehouse, inactive and document-only ones included;
 * `activeWarehouses` (the form's select) is what a new count may use (resolveWarehouse): the table's
 * active warehouses plus the document-only ones. `users` are the app's users, the active employees
 * (Linko lists its users, i.e. the employees) and every creator already on a count. */
export async function getStockInventoryOptions(linked: string[] = []): Promise<StockInventoryOptions> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const table = (await db.prepare("SELECT name, COALESCE(active, 1) AS active FROM warehouses WHERE btrim(name) <> ''").all()) as Array<{
    name: string
    active: number | boolean
  }>
  const used = (await db.prepare("SELECT DISTINCT warehouse AS name FROM stock_inventories WHERE btrim(warehouse) <> ''").all()) as Array<{ name: string }>
  const hasEmployees = Boolean(((await db.prepare("SELECT to_regclass('employees') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined)?.ok)
  const users = (await db
    .prepare(
      `SELECT display_name AS name FROM users WHERE btrim(display_name) <> ''
       UNION SELECT created_by FROM stock_inventories WHERE btrim(created_by) <> ''
       ${hasEmployees ? "UNION SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) FROM employees WHERE COALESCE(active, 1) = 1 AND btrim(COALESCE(first_name, '') || COALESCE(last_name, '')) <> ''" : ""}`,
    )
    .all()) as Array<{ name: string }>
  const unique = (names: string[]) => {
    const seen = new Map<string, string>()
    for (const name of names) if (!seen.has(textKey(name))) seen.set(textKey(name), name.trim())
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  const documents = await documentWarehouses(db)
  const tableKeys = new Set(table.map((row) => textKey(row.name)))
  const active = [...table.filter((row) => Number(row.active)).map((row) => row.name), ...documents.filter((name) => !tableKeys.has(textKey(name)))]
  const currency = (await loadCurrencyContext(db)).base
  return {
    warehouses: linked.length ? [...new Set(linked)] : unique([...table.map((row) => row.name), ...used.map((row) => row.name), ...documents]),
    activeWarehouses: unique(active),
    users: unique(users.map((row) => row.name)),
    currency,
  }
}

export { getInventoryBalances }

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** `warehouseId`: the registry row the name was resolved from (null: a document-only warehouse);
 * lockHeaderWarehouse reads it again under the stock lock. Not stored. */
type Header = { type: StockInventoryType; warehouse: string; warehouseId: number | null; invDate: string; forDayEnd: boolean; comment: string }

/** Warehouse names that only appear on documents (not in the warehouses table), from the stock core. */
async function documentWarehouses(db: PgDb): Promise<string[]> {
  try {
    return [...new Set((await getStockBalances({}, db)).map((row) => row.warehouse.trim()).filter(Boolean))]
  } catch (error) {
    console.error("stock inventories: warehouses", error)
    return []
  }
}

const INACTIVE_WAREHOUSE = "Склад неактивен"

/** The warehouses-table spelling of `name` (or a document-only warehouse the core knows). An
 * inactive warehouse is closed to new counts (as to write-offs and transfers), except the one an
 * edited inventory already has (its confirm is refused until the warehouse is active again). */
async function resolveWarehouse(db: PgDb, name: string, current?: InventoryRow): Promise<{ name: string; id: number | null }> {
  const wanted = textKey(name)
  const kept = Boolean(current && textKey(current.warehouse) === wanted)
  const rows = (await db.prepare("SELECT id, name, COALESCE(active, 1) AS active FROM warehouses").all()) as Array<{ id: number; name: string; active: number | boolean }>
  const matches = rows.filter((row) => textKey(row.name) === wanted)
  // Same pick as lib/internal-transfers-stock.ts findWarehouse: an active namesake first.
  const match = matches.find((row) => Boolean(Number(row.active))) ?? matches[0]
  if (match) {
    if (!Number(match.active) && !kept) throw new StockInventoryError(INACTIVE_WAREHOUSE, 400, "warehouse")
    return { name: match.name.trim(), id: Number(match.id) }
  }
  if (current && kept) return { name: current.warehouse, id: null }
  const known = (await documentWarehouses(db)).find((warehouse) => textKey(warehouse) === wanted)
  if (known) return { name: known, id: null }
  throw new StockInventoryError("Склад не найден", 400, "warehouse")
}

/** A chosen inventory day: a real day, a year within 2000..2100, not in the future. */
function checkedDay(day: string): string {
  if (!isIsoDay(day)) throw new StockInventoryError("Укажите дату", 400, "invDate")
  if (!docYearOk(day)) throw new StockInventoryError(DOC_DATE_INVALID, 400, "invDate")
  if (day > todayIso()) throw new StockInventoryError("Дата не может быть позже сегодняшнего дня", 400, "invDate")
  return day
}

/** fact_date: today, end of the day (= the balance right now); custom_date: the chosen day and time. */
async function resolveHeader(db: PgDb, input: Omit<StockInventoryInput, "items">, current?: InventoryRow): Promise<Header> {
  // The demo update form keeps the type (radio disabled).
  const type = current ? asType(current.type) : input.type
  const { name: warehouse, id: warehouseId } = await resolveWarehouse(db, input.warehouse, current)
  const comment = (input.comment ?? current?.comment ?? "").trim()
  if (type === "fact_date") {
    // A new count is today's balance (end of the day). The edit form («Изменение») may move it to another day, as
    // Linko's PUT created_date does; it keeps the stored «Время» (for_day_end), which Linko's form sends back unchanged.
    if (!current) return { type, warehouse, warehouseId, invDate: todayIso(), forDayEnd: true, comment }
    const moved = (input.invDate ?? "").slice(0, 10)
    const invDate = moved ? checkedDay(moved) : current.inv_date || todayIso()
    return { type, warehouse, warehouseId, invDate, forDayEnd: Number(current.for_day_end) === 1, comment }
  }
  const invDate = (input.invDate ?? "").slice(0, 10)
  if (!isIsoDay(invDate)) throw new StockInventoryError("Укажите дату", 400, "invDate")
  // Every document date has a year within 2000..2100 (lib/document-dates.ts).
  if (!docYearOk(invDate)) throw new StockInventoryError(DOC_DATE_INVALID, 400, "invDate")
  if (invDate > todayIso()) throw new StockInventoryError("Дата не может быть позже сегодняшнего дня", 400, "invDate")
  return { type, warehouse, warehouseId, invDate, forDayEnd: input.forDayEnd ?? false, comment }
}

/**
 * The header's warehouse under its stock lock, as it is now (rename race,
 * lib/internal-transfers-stock.ts lockDocumentWarehouses): a rename that committed since
 * resolveHeader read it gives the new name (`renamed`: the lines' legacy names and the
 * provisional snapshot belong to that name now); one still to come waits for this transaction
 * and then carries the inventory over too. Taken first in the transaction, before any row lock.
 * `current`: the edited inventory, whose own warehouse may stay even while inactive.
 */
async function lockHeaderWarehouse(tx: PgDb, header: Header, current?: InventoryRow): Promise<{ header: Header; renamed: boolean }> {
  const [locked] = await lockDocumentWarehouses(tx, [{ id: header.warehouseId, name: header.warehouse }])
  if (!locked) throw new StockInventoryError("Склад не найден", 400, "warehouse")
  // The edited inventory's own warehouse (also when it was renamed meanwhile: the same row).
  const kept = Boolean(current && [textKey(locked.name), textKey(header.warehouse)].includes(textKey(current.warehouse)))
  if (!locked.active && !kept) throw new StockInventoryError(INACTIVE_WAREHOUSE, 400, "warehouse")
  return { header: locked.name === header.warehouse ? header : { ...header, warehouse: locked.name }, renamed: locked.renamed }
}

/** "name:<name>" → the ledger's key of that name ('name:' + fin_key). */
const orphanKey = (key: string) => `name:${textKey(key.slice(5))}`

/** The non-catalog ("name:") keys that may be counted in `warehouse`: those its ledger
 * already has (document names that match no catalog item), plus the lines of the
 * inventory being edited. Anything else would create stock out of nothing. */
async function countableOrphans(db: PgDb, warehouse: string, currentId?: number): Promise<Set<string>> {
  const allowed = new Set<string>()
  const wanted = textKey(warehouse)
  for (const row of await getStockBalances({ warehouses: [warehouse] }, db)) {
    if (row.key.startsWith("name:") && textKey(row.warehouse) === wanted) allowed.add(row.key)
  }
  if (currentId) {
    const rows = (await db.prepare("SELECT item_key FROM stock_inventory_items WHERE inventory_id = ?").all(currentId)) as Array<{ item_key: string }>
    for (const row of rows) if (row.item_key.startsWith("name:")) allowed.add(orphanKey(row.item_key))
  }
  return allowed
}

/** stock_series rows of the given ids (id → product and display name); empty when the series catalog does not exist. */
async function loadSeries(db: PgDb, ids: number[]): Promise<Map<number, { productId: number; name: string }>> {
  const out = new Map<number, { productId: number; name: string }>()
  if (!ids.length) return out
  const exists = (await db.prepare("SELECT to_regclass('stock_series') IS NOT NULL AS ok").get()) as { ok: boolean } | undefined
  if (!exists?.ok) return out
  const rows = (await db.prepare("SELECT id, product_id, number, expiration_date FROM stock_series WHERE id = ANY(@ids::int[])").all({ ids })) as Array<{
    id: number
    product_id: number
    number: string | null
    expiration_date: string | null
  }>
  for (const row of rows) {
    // The display name lib/client-returns-series-repo.ts gives a series: its number, else its expiry day.
    const day = /^\d{4}-\d{2}-\d{2}/.exec(row.expiration_date ?? "")?.[0] ?? ""
    out.set(Number(row.id), { productId: Number(row.product_id), name: row.number || day || String(row.id) })
  }
  return out
}

/** The counted lines in their order. The same item may be counted on several lines (Linko's edit form adds lines
 * without merging them, e.g. one per series); snapshotLines then gives the system balance to its first line only, so
 * the differences still add up to counted − balance. A series must belong to the line's product. */
async function resolveLines(items: StockInventoryInput["items"], catalog: Map<string, StockCatalogItem>, db: PgDb, warehouse: string, currentId?: number): Promise<Line[]> {
  if (!items.length) throw new StockInventoryError("Вы еще не выбрали ни одного товара", 400, "items")
  const series = await loadSeries(db, [...new Set(items.map((item) => item.seriesId).filter((id): id is number => typeof id === "number"))])
  const keys = items.map((item) => {
    const key = item.key.trim()
    return key.startsWith("name:") && !catalog.has(key) ? orphanKey(key) : key
  })
  const orphanKeys = keys.filter((key) => key.startsWith("name:") && !catalog.has(key))
  const allowed = orphanKeys.length ? await countableOrphans(db, warehouse, currentId) : new Set<string>()
  // "name:<key>" lines (document names no catalog item matches) keep their original spelling.
  const orphans = await stockOrphanNames(orphanKeys, db)
  return items.map((item, index) => {
    const key = keys[index]
    const product = catalog.get(key)
    if (!product && !(key.startsWith("name:") && key.length > 5 && allowed.has(key))) throw new StockInventoryError("Товар не найден", 400, `items.${index}.key`)
    let seriesId: number | null = null
    let seriesName = (item.series ?? "").trim()
    if (typeof item.seriesId === "number") {
      const found = series.get(item.seriesId)
      if (!found) throw new StockInventoryError("Серия не найдена", 400, `items.${index}.seriesId`)
      if (found.productId !== productIdOf(key)) throw new StockInventoryError("Серия не относится к товару", 400, `items.${index}.seriesId`)
      seriesId = item.seriesId
      seriesName = found.name
    } else if (item.seriesId === null) {
      seriesName = ""
    }
    return { key, name: product?.name ?? orphans.get(key)?.name ?? nameFromKey(key), unit: product?.unit ?? "", amount: round6(item.amount), series: seriesName, seriesId, position: index }
  })
}

/** Provisional snapshot of a pending inventory (list "Сумма"); zeros when the core fails. */
async function trySnapshot(moment: BalanceMoment, lines: Line[]): Promise<LineSnapshot[]> {
  try {
    // Inside a transaction a failing read must not abort it (a savepoint; a plain call outside).
    return await isolated(() => snapshotLines(moment, lines))
  } catch (error) {
    console.error("stock inventories: snapshot", error)
    return lines.map(() => ({ balanceAmount: 0, diff: 0, cost: 0, totalPrice: 0 }))
  }
}

/** Weight and net weight of one unit of each product line (products.weight / net_weight, kg; 0 when unknown). */
async function unitWeights(db: PgDb, keys: string[]): Promise<Map<string, { weight: number; net: number }>> {
  const out = new Map<string, { weight: number; net: number }>()
  const ids = [...new Set(keys.map(productIdOf).filter((id): id is number => id !== null))]
  if (!ids.length) return out
  const rows = (await db
    .prepare("SELECT id, to_jsonb(p) ->> 'weight' AS weight, to_jsonb(p) ->> 'net_weight' AS net_weight FROM products p WHERE id = ANY(@ids::int[])")
    .all({ ids })) as Array<{ id: number; weight: string | null; net_weight: string | null }>
  for (const row of rows) out.set(`product:${row.id}`, { weight: leadingNumber(row.weight), net: leadingNumber(row.net_weight) })
  return out
}

/** Linko's total_weight / total_weight_netto of a line: its difference × the weight / net weight of one unit. */
async function lineWeights(db: PgDb, keys: string[], snapshot: LineSnapshot[]): Promise<{ weights: number[]; netto: number[] }> {
  const units = await unitWeights(db, keys)
  return {
    weights: keys.map((key, index) => round6(snapshot[index].diff * (units.get(key)?.weight ?? 0))),
    netto: keys.map((key, index) => round6(snapshot[index].diff * (units.get(key)?.net ?? 0))),
  }
}

async function insertLines(db: PgDb, inventoryId: number, lines: Line[], snapshot: LineSnapshot[]) {
  if (!lines.length) return
  const { weights, netto } = await lineWeights(
    db,
    lines.map((line) => line.key),
    snapshot,
  )
  await db
    .prepare(
      `INSERT INTO stock_inventory_items (inventory_id, item_key, item_name, unit, amount, balance_amount, diff, cost, total_price, series, series_id, position,
                                          total_weight, total_weight_netto)
       SELECT @inventoryId, t.k, t.n, t.u, t.a, t.b, t.d, t.c, t.tp, t.s, t.si, t.p, t.w, t.wn
       FROM unnest(@keys::text[], @names::text[], @units::text[], @amounts::float8[], @balances::float8[], @diffs::float8[],
                   @costs::float8[], @totals::float8[], @series::text[], @seriesIds::int[], @positions::int[], @weights::float8[], @netto::float8[])
            AS t(k, n, u, a, b, d, c, tp, s, si, p, w, wn)`,
    )
    .run({
      weights,
      netto,
      inventoryId,
      keys: lines.map((line) => line.key),
      names: lines.map((line) => line.name),
      units: lines.map((line) => line.unit),
      amounts: lines.map((line) => line.amount),
      balances: snapshot.map((line) => line.balanceAmount),
      diffs: snapshot.map((line) => line.diff),
      costs: snapshot.map((line) => line.cost),
      totals: snapshot.map((line) => line.totalPrice),
      series: lines.map((line) => line.series),
      seriesIds: lines.map((line) => line.seriesId),
      positions: lines.map((line) => line.position),
    })
}

const sumTotals = (snapshot: LineSnapshot[]) => round6(snapshot.reduce((sum, line) => sum + line.totalPrice, 0))

export async function createStockInventory(input: StockInventoryInput, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const checked = await resolveHeader(db, input)
  const catalog = await catalogOrFail(db)
  const checkedLines = await resolveLines(input.items, catalog, db, checked.warehouse)
  const checkedSnapshot = await trySnapshot({ warehouse: checked.warehouse, date: checked.invDate, forDayEnd: checked.forDayEnd }, checkedLines)
  const currency = (await loadCurrencyContext(db)).base
  const id = await withTransaction(async (tx) => {
    // Rename race: the name is written under the warehouse's stock lock, as it is now.
    const { header, renamed } = await lockHeaderWarehouse(tx, checked)
    const lines = renamed ? await resolveLines(input.items, catalog, tx, header.warehouse) : checkedLines
    const snapshot = renamed ? await trySnapshot({ warehouse: header.warehouse, date: header.invDate, forDayEnd: header.forDayEnd }, lines) : checkedSnapshot
    const result = await tx
      .prepare(
        `INSERT INTO stock_inventories (warehouse, inv_date, for_day_end, type, status, comment, currency, total_price, created_by)
         VALUES (@warehouse, @invDate, @forDayEnd, @type, 'pending', @comment, @currency, @total, @createdBy)`,
      )
      .run({ ...header, forDayEnd: header.forDayEnd ? 1 : 0, currency, total: sumTotals(snapshot), createdBy: userName(user) })
    await insertLines(tx, result.lastInsertRowid, lines, snapshot)
    return result.lastInsertRowid
  })
  return requireDetail(id)
}

/** Demo PUT stock/inventory/:id (InventoryForm "Изменение"): only while pending. */
export async function updateStockInventory(id: number, input: StockInventoryInput): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const current = (await db.prepare("SELECT * FROM stock_inventories WHERE id = ?").get(id)) as InventoryRow | undefined
  if (!current) throw new StockInventoryError(NOT_FOUND, 404)
  if (asStatus(current.status) !== "pending") throw new StockInventoryError("Изменять можно только инвентаризацию в ожидании", 409)
  const checked = await resolveHeader(db, input, current)
  const catalog = await catalogOrFail(db)
  const checkedLines = await resolveLines(input.items, catalog, db, checked.warehouse, id)
  const checkedSnapshot = await trySnapshot({ warehouse: checked.warehouse, date: checked.invDate, forDayEnd: checked.forDayEnd }, checkedLines)
  await withTransaction(async (tx) => {
    // Rename race (see createStockInventory); lock order (C1): the warehouse's stock lock before the row lock.
    const { header, renamed } = await lockHeaderWarehouse(tx, checked, current)
    const locked = await lockRow(tx, id)
    if (asStatus(locked.status) !== "pending") throw new StockInventoryError("Изменять можно только инвентаризацию в ожидании", 409)
    const lines = renamed ? await resolveLines(input.items, catalog, tx, header.warehouse, id) : checkedLines
    const snapshot = renamed ? await trySnapshot({ warehouse: header.warehouse, date: header.invDate, forDayEnd: header.forDayEnd }, lines) : checkedSnapshot
    await tx
      .prepare("UPDATE stock_inventories SET warehouse = @warehouse, inv_date = @invDate, for_day_end = @forDayEnd, comment = @comment, total_price = @total WHERE id = @id")
      .run({ id, warehouse: header.warehouse, invDate: header.invDate, forDayEnd: header.forDayEnd ? 1 : 0, comment: header.comment, total: sumTotals(snapshot) })
    await tx.prepare("DELETE FROM stock_inventory_items WHERE inventory_id = ?").run(id)
    await insertLines(tx, id, lines, snapshot)
  })
  return requireDetail(id)
}

/**
 * Linko's «Удаление» (DELETE stock/inventory/:id/ {comment}): a pending or a confirmed inventory (the card offers 🗑
 * unless it is cancelled). Deleting a confirmed one takes its differences out of the stock, like «Отменить»: refused
 * (409) while a surplus it booked has already left the warehouse. An imported inventory whose differences Linko booked
 * as separate documents (booked_by_documents) has no stock effect of its own. Who deleted it, the comment and a copy of
 * the document go to stock_inventory_deletions.
 */
export async function deleteStockInventory(id: number, comment: string | undefined, user: { displayName?: string; username?: string }): Promise<void> {
  await ensureStockInventoriesSchema()
  await ensureStockSchema()
  await withInventoryLocked(id, async (tx, row) => {
    const status = asStatus(row.status)
    if (status === "canceled") throw new StockInventoryError("Отмененную инвентаризацию нельзя удалить", 409)
    const items = (await tx.prepare("SELECT * FROM stock_inventory_items WHERE inventory_id = ? ORDER BY position, id").all(id)) as ItemRow[]
    if (status === "confirmed" && !Number(row.booked_by_documents)) {
      await requireStockFromInventoryDay(
        tx,
        row,
        items.map((item) => ({ key: item.item_key, name: item.item_name, unit: item.unit, qty: Number(item.diff) || 0 })),
        "Не возможно удалить. ",
      )
    }
    await tx
      .prepare("INSERT INTO stock_inventory_deletions (inventory_id, status, comment, deleted_by, document) VALUES (@id, @status, @comment, @user, @document::jsonb)")
      .run({ id, status, comment: (comment ?? "").trim(), user: userName(user), document: JSON.stringify({ ...row, items }) })
    await tx.prepare("DELETE FROM stock_inventories WHERE id = ?").run(id)
  })
}

/**
 * Demo POST stock/inventory/:id/confirm/ {comment}: pending → confirmed. In one
 * transaction (the warehouse's stock writers serialized, then the row locked) every
 * line gets its system balance at the inventory moment, diff = counted − balance, the
 * average cost and diff × cost; the header gets Σ. A second confirm gets 409, and so
 * does a shortage that later outflows (or Брак on hand) leave no good units for (no
 * day's good stock may go negative).
 */
export async function confirmStockInventory(id: number, comment: string | undefined, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  // The stock core's own DDL runs before the transaction (its checks read the core inside it).
  await ensureStockSchema()
  await withInventoryLocked(id, async (tx, row) => {
    const status = asStatus(row.status)
    if (status === "confirmed") throw new StockInventoryError("Инвентаризация уже подтверждена", 409)
    if (status !== "pending") throw new StockInventoryError("Отмененную инвентаризацию нельзя подтвердить", 409)
    // Booking the differences is a movement: an inactive warehouse takes none (a document-only
    // warehouse outside the registry keeps working).
    const warehouse = await findWarehouse(tx, row.warehouse)
    if (warehouse && !warehouse.active) throw new StockInventoryError(INACTIVE_WAREHOUSE, 400, "warehouse")
    const items = (await tx.prepare("SELECT * FROM stock_inventory_items WHERE inventory_id = ? ORDER BY position, id").all(id)) as ItemRow[]
    if (!items.length) throw new StockInventoryError("Вы еще не выбрали ни одного товара", 400, "items")
    let snapshot: LineSnapshot[]
    try {
      snapshot = await snapshotLines(momentOf(row, id), items.map((item) => ({ key: item.item_key, amount: Number(item.amount) || 0 })), tx)
    } catch (error) {
      console.error("stock inventories: confirm", error)
      throw new StockInventoryError("Не удалось рассчитать остатки склада", 503)
    }
    // A shortage leaves the warehouse (as good units) from the inventory day on: goods already
    // moved on by later documents, and Брак, cannot be counted out again.
    await requireStockFromInventoryDay(
      tx,
      row,
      items.map((item, index) => ({ key: item.item_key, name: item.item_name, unit: item.unit, qty: -snapshot[index].diff })),
      "Не возможно подтвердить. ",
    )
    const { weights, netto } = await lineWeights(
      tx,
      items.map((item) => item.item_key),
      snapshot,
    )
    await tx
      .prepare(
        `UPDATE stock_inventory_items AS it SET balance_amount = t.b, diff = t.d, cost = t.c, total_price = t.tp, total_weight = t.w, total_weight_netto = t.wn
         FROM unnest(@ids::int[], @balances::float8[], @diffs::float8[], @costs::float8[], @totals::float8[], @weights::float8[], @netto::float8[])
              AS t(id, b, d, c, tp, w, wn)
         WHERE it.id = t.id AND it.inventory_id = @inventoryId`,
      )
      .run({
        weights,
        netto,
        inventoryId: id,
        ids: items.map((item) => Number(item.id)),
        balances: snapshot.map((line) => line.balanceAmount),
        diffs: snapshot.map((line) => line.diff),
        costs: snapshot.map((line) => line.cost),
        totals: snapshot.map((line) => line.totalPrice),
      })
    const updated = await tx
      .prepare(
        `UPDATE stock_inventories SET status = 'confirmed', total_price = @total, confirmed_at = datetime('now'), confirmed_by = @user,
           comment = CASE WHEN @comment <> '' THEN @comment ELSE comment END
         WHERE id = @id AND status = 'pending'`,
      )
      .run({ id, total: sumTotals(snapshot), user: userName(user), comment: (comment ?? "").trim() })
    if (!updated.changes) throw new StockInventoryError("Инвентаризация уже подтверждена", 409)
  })
  return requireDetail(id)
}

/** Demo PUT stock/inventory/:id/cancel_accept/: confirmed → canceled (its stock effect disappears);
 * 409 while a surplus it booked has already left the warehouse. */
export async function cancelStockInventory(id: number, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  // The stock core's own DDL runs before the transaction (its checks read the core inside it).
  await ensureStockSchema()
  await withInventoryLocked(id, async (tx, row) => {
    const status = asStatus(row.status)
    if (status === "canceled") throw new StockInventoryError("Инвентаризация уже отменена", 409)
    if (status !== "confirmed") throw new StockInventoryError("Отменить можно только подтвержденную инвентаризацию", 409)
    // Undoing a surplus takes its good units out again from the inventory day on: they must still be there.
    const items = (await tx.prepare("SELECT item_key, item_name, unit, diff FROM stock_inventory_items WHERE inventory_id = ?").all(id)) as Array<
      Pick<ItemRow, "item_key" | "item_name" | "unit" | "diff">
    >
    await requireStockFromInventoryDay(
      tx,
      row,
      items.map((item) => ({ key: item.item_key, name: item.item_name, unit: item.unit, qty: Number(item.diff) || 0 })),
      "Не возможно отменить. ",
    )
    await tx
      .prepare("UPDATE stock_inventories SET status = 'canceled', canceled_at = datetime('now'), canceled_by = ? WHERE id = ? AND status = 'confirmed'")
      .run(userName(user), id)
  })
  return requireDetail(id)
}

/**
 * Demo POST stock/inventory/import_excel/: a pending inventory from the filled
 * template. Rows match the warehouse's balance list by article, then by name;
 * empty amounts are skipped, repeated items are summed. Unknown names or bad
 * amounts reject the whole file (400 with `missing` / `lines`).
 */
export async function importStockInventory(input: StockInventoryImportInput, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const header = await resolveHeader(db, input)
  let balanceRows
  try {
    balanceRows = (await getInventoryBalances({ warehouse: header.warehouse, date: header.invDate, forDayEnd: header.forDayEnd })).rows
  } catch (error) {
    console.error("stock inventories: import", error)
    throw new StockInventoryError("Не удалось загрузить остатки склада", 503)
  }
  const byArticle = new Map<string, string | null>()
  const byName = new Map<string, string>()
  for (const row of balanceRows) {
    const article = textKey(row.article)
    if (article) byArticle.set(article, byArticle.has(article) ? null : row.key)
    const name = textKey(row.name)
    // Products come first in the catalog: the first name wins.
    if (name && !byName.has(name)) byName.set(name, row.key)
  }
  const amounts = new Map<string, number>()
  const missing: string[] = []
  const badLines: number[] = []
  input.rows.forEach((row, index) => {
    const raw = typeof row.amount === "string" ? row.amount.replace(/[\s  ]/g, "").replace(",", ".") : row.amount
    if (raw === null || raw === undefined || raw === "") return
    const amount = Number(raw)
    const line = row.line ?? index + 2
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e9) {
      badLines.push(line)
      return
    }
    const key = byArticle.get(textKey(row.article)) || byName.get(textKey(row.name))
    if (!key) {
      const label = (row.name || row.article || "").trim()
      if (label) missing.push(label)
      else badLines.push(line)
      return
    }
    amounts.set(key, round6((amounts.get(key) ?? 0) + amount))
  })
  if (badLines.length) throw new StockInventoryError("Неверное количество в строках", 400, "rows", { lines: badLines.slice(0, 50) })
  if (missing.length) throw new StockInventoryError("Товары не найдены", 400, "rows", { missing: [...new Set(missing)].slice(0, 50) })
  if (!amounts.size) throw new StockInventoryError("В файле нет заполненных строк", 400, "rows")
  return createStockInventory({ ...input, items: [...amounts].map(([key, amount]) => ({ key, amount })) }, user)
}
