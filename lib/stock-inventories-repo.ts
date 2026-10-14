import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { isIsoDay, parseAnyDate, todayIso } from "@/lib/finance/dates"
import { getStockBalances } from "@/lib/stock/ledger"
import { stockOrphanNames } from "@/lib/stock/level"
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
// create / update / delete while pending, confirm (pending → confirmed: the
// system balance, diff, cost and sum of every line are frozen from the stock
// core in one transaction) and cancel (confirmed → canceled: the core reads
// confirmed inventories only, so the stock goes back). Demo rules: edit and
// confirm only while pending, "Отменить" (cancel_accept) only once confirmed.

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
  position: number
}

type Line = { key: string; name: string; unit: string; amount: number; series: string; position: number }

const NOT_FOUND = "Инвентаризация не найдена"
const WAREHOUSE_KEY_SQL = "regexp_replace(lower(btrim(i.warehouse)), '\\s+', ' ', 'g')"

const ORDER_BY: Record<StockInventoryListQuery["ordering"], string> = {
  id: "i.id ASC",
  "-id": "i.id DESC",
  created_date: "i.inv_date ASC, i.created_at ASC, i.id ASC",
  "-created_date": "i.inv_date DESC, i.created_at DESC, i.id DESC",
  total_price: "i.total_price ASC, i.id ASC",
  "-total_price": "i.total_price DESC, i.id DESC",
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

function toItem(row: ItemRow, catalog: Map<string, StockCatalogItem> | null, live: LineSnapshot | null): StockInventoryItem {
  const amount = round6(Number(row.amount) || 0)
  return {
    id: Number(row.id),
    key: row.item_key,
    name: row.item_name,
    article: catalog?.get(row.item_key)?.article ?? "",
    unit: row.unit || catalog?.get(row.item_key)?.unit || "",
    series: row.series ?? "",
    amount,
    balanceAmount: live ? live.balanceAmount : round6(Number(row.balance_amount) || 0),
    diff: live ? live.diff : round6(Number(row.diff) || 0),
    cost: live ? live.cost : round6(Number(row.cost) || 0),
    totalPrice: live ? live.totalPrice : round6(Number(row.total_price) || 0),
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
  const where = `
    (@needle = '' OR strpos(lower(i.id::text || ' ' || i.warehouse || ' ' || i.comment || ' ' || i.created_by), @needle) > 0
      OR EXISTS (SELECT 1 FROM stock_inventory_items s WHERE s.inventory_id = i.id AND strpos(lower(s.item_name), @needle) > 0))
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
       ORDER BY ${ORDER_BY[query.ordering]} ${paging}`,
    )
    .all(params)) as InventoryRow[]
  return { count: Number(countRow?.n ?? 0), results: rows.map(toRow) }
}

/** Detail; while pending the lines carry the live system balance / diff / sum. */
export async function getStockInventory(id: number): Promise<StockInventoryDetail | null> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM stock_inventories WHERE id = ?").get(id)) as InventoryRow | undefined
  if (!row) return null
  const items = (await db.prepare("SELECT * FROM stock_inventory_items WHERE inventory_id = ? ORDER BY position, id").all(id)) as ItemRow[]
  const pending = asStatus(row.status) === "pending"
  let catalog: Map<string, StockCatalogItem> | null = null
  let live: LineSnapshot[] | null = null
  let liveError = ""
  try {
    catalog = await loadCatalogMap(db)
    if (pending && items.length) live = await snapshotLines(momentOf(row), items.map((item) => ({ key: item.item_key, amount: Number(item.amount) || 0 })), db)
  } catch (error) {
    console.error("stock inventories: live balances", error)
    liveError = "Не удалось загрузить остатки склада"
  }
  const lines = items.map((item, index) => toItem(item, catalog, live ? live[index] : null))
  const base = toRow({ ...row, item_count: items.length })
  return {
    ...base,
    totalPrice: live ? round6(lines.reduce((sum, line) => sum + line.totalPrice, 0)) : base.totalPrice,
    confirmedAt: localTime(row.confirmed_at),
    confirmedBy: row.confirmed_by ?? "",
    canceledAt: localTime(row.canceled_at),
    canceledBy: row.canceled_by ?? "",
    live: Boolean(live) || (pending && !items.length),
    liveError,
    items: lines,
  }
}

async function requireDetail(id: number): Promise<StockInventoryDetail> {
  const detail = await getStockInventory(id)
  if (!detail) throw new StockInventoryError(NOT_FOUND, 404)
  return detail
}

/** Warehouses (select / filter), creators ("Создал" filter) and the base currency. */
export async function getStockInventoryOptions(): Promise<StockInventoryOptions> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const warehouses = (await db
    .prepare("SELECT name FROM warehouses WHERE btrim(name) <> '' UNION SELECT warehouse FROM stock_inventories WHERE btrim(warehouse) <> ''")
    .all()) as Array<{ name: string }>
  const users = (await db
    .prepare("SELECT display_name AS name FROM users WHERE btrim(display_name) <> '' UNION SELECT created_by FROM stock_inventories WHERE btrim(created_by) <> ''")
    .all()) as Array<{ name: string }>
  const unique = (names: string[]) => {
    const seen = new Map<string, string>()
    for (const name of names) if (!seen.has(textKey(name))) seen.set(textKey(name), name.trim())
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  const currency = (await loadCurrencyContext(db)).base
  return { warehouses: unique([...warehouses.map((row) => row.name), ...(await documentWarehouses(db))]), users: unique(users.map((row) => row.name)), currency }
}

export { getInventoryBalances }

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

type Header = { type: StockInventoryType; warehouse: string; invDate: string; forDayEnd: boolean; comment: string }

/** Warehouse names that only appear on documents (not in the warehouses table), from the stock core. */
async function documentWarehouses(db: PgDb): Promise<string[]> {
  try {
    return [...new Set((await getStockBalances({}, db)).map((row) => row.warehouse.trim()).filter(Boolean))]
  } catch (error) {
    console.error("stock inventories: warehouses", error)
    return []
  }
}

/** The warehouses-table spelling of `name` (or a document-only warehouse the core knows). */
async function resolveWarehouse(db: PgDb, name: string, current?: InventoryRow): Promise<string> {
  const wanted = textKey(name)
  const rows = (await db.prepare("SELECT name FROM warehouses").all()) as Array<{ name: string }>
  const match = rows.find((row) => textKey(row.name) === wanted)
  if (match) return match.name.trim()
  if (current && textKey(current.warehouse) === wanted) return current.warehouse
  const known = (await documentWarehouses(db)).find((warehouse) => textKey(warehouse) === wanted)
  if (known) return known
  throw new StockInventoryError("Склад не найден", 400, "warehouse")
}

/** fact_date: today, end of the day (= the balance right now); custom_date: the chosen day and time. */
async function resolveHeader(db: PgDb, input: Omit<StockInventoryInput, "items">, current?: InventoryRow): Promise<Header> {
  // The demo update form keeps the type (radio disabled).
  const type = current ? asType(current.type) : input.type
  const warehouse = await resolveWarehouse(db, input.warehouse, current)
  const comment = (input.comment ?? current?.comment ?? "").trim()
  if (type === "fact_date") return { type, warehouse, invDate: current?.inv_date || todayIso(), forDayEnd: true, comment }
  const invDate = (input.invDate ?? "").slice(0, 10)
  if (!isIsoDay(invDate)) throw new StockInventoryError("Укажите дату", 400, "invDate")
  if (invDate > todayIso()) throw new StockInventoryError("Дата не может быть позже сегодняшнего дня", 400, "invDate")
  return { type, warehouse, invDate, forDayEnd: input.forDayEnd ?? false, comment }
}

async function resolveLines(items: StockInventoryInput["items"], catalog: Map<string, StockCatalogItem>, db: PgDb): Promise<Line[]> {
  if (!items.length) throw new StockInventoryError("Вы еще не выбрали ни одного товара", 400, "items")
  const seen = new Set<string>()
  // "name:<key>" lines (document names no catalog item matches) keep their original spelling.
  const orphans = await stockOrphanNames(items.map((item) => item.key.trim()).filter((key) => key.startsWith("name:") && !catalog.has(key)), db)
  return items.map((item, index) => {
    const key = item.key.trim()
    if (seen.has(key)) throw new StockInventoryError("Товар повторяется в списке", 400, `items.${index}.key`)
    seen.add(key)
    const product = catalog.get(key)
    if (!product && !(key.startsWith("name:") && key.length > 5)) throw new StockInventoryError("Товар не найден", 400, `items.${index}.key`)
    return { key, name: product?.name ?? orphans.get(key)?.name ?? nameFromKey(key), unit: product?.unit ?? "", amount: round6(item.amount), series: (item.series ?? "").trim(), position: index }
  })
}

/** Provisional snapshot of a pending inventory (list "Сумма"); zeros when the core fails. */
async function trySnapshot(moment: BalanceMoment, lines: Line[]): Promise<LineSnapshot[]> {
  try {
    return await snapshotLines(moment, lines)
  } catch (error) {
    console.error("stock inventories: snapshot", error)
    return lines.map(() => ({ balanceAmount: 0, diff: 0, cost: 0, totalPrice: 0 }))
  }
}

async function insertLines(db: PgDb, inventoryId: number, lines: Line[], snapshot: LineSnapshot[]) {
  if (!lines.length) return
  await db
    .prepare(
      `INSERT INTO stock_inventory_items (inventory_id, item_key, item_name, unit, amount, balance_amount, diff, cost, total_price, series, position)
       SELECT @inventoryId, t.k, t.n, t.u, t.a, t.b, t.d, t.c, t.tp, t.s, t.p
       FROM unnest(@keys::text[], @names::text[], @units::text[], @amounts::float8[], @balances::float8[], @diffs::float8[],
                   @costs::float8[], @totals::float8[], @series::text[], @positions::int[]) AS t(k, n, u, a, b, d, c, tp, s, p)`,
    )
    .run({
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
      positions: lines.map((line) => line.position),
    })
}

const sumTotals = (snapshot: LineSnapshot[]) => round6(snapshot.reduce((sum, line) => sum + line.totalPrice, 0))

export async function createStockInventory(input: StockInventoryInput, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  const db = getDb()
  const header = await resolveHeader(db, input)
  const lines = await resolveLines(input.items, await catalogOrFail(db), db)
  const snapshot = await trySnapshot({ warehouse: header.warehouse, date: header.invDate, forDayEnd: header.forDayEnd }, lines)
  const currency = (await loadCurrencyContext(db)).base
  const id = await withTransaction(async (tx) => {
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
  const header = await resolveHeader(db, input, current)
  const lines = await resolveLines(input.items, await catalogOrFail(db), db)
  const snapshot = await trySnapshot({ warehouse: header.warehouse, date: header.invDate, forDayEnd: header.forDayEnd }, lines)
  await withTransaction(async (tx) => {
    const locked = await lockRow(tx, id)
    if (asStatus(locked.status) !== "pending") throw new StockInventoryError("Изменять можно только инвентаризацию в ожидании", 409)
    await tx
      .prepare("UPDATE stock_inventories SET warehouse = @warehouse, inv_date = @invDate, for_day_end = @forDayEnd, comment = @comment, total_price = @total WHERE id = @id")
      .run({ id, warehouse: header.warehouse, invDate: header.invDate, forDayEnd: header.forDayEnd ? 1 : 0, comment: header.comment, total: sumTotals(snapshot) })
    await tx.prepare("DELETE FROM stock_inventory_items WHERE inventory_id = ?").run(id)
    await insertLines(tx, id, lines, snapshot)
  })
  return requireDetail(id)
}

/** Only a pending inventory can be deleted (a confirmed one is cancelled instead, which keeps its history). */
export async function deleteStockInventory(id: number): Promise<void> {
  await ensureStockInventoriesSchema()
  await withTransaction(async (tx) => {
    const row = await lockRow(tx, id)
    if (asStatus(row.status) !== "pending") throw new StockInventoryError("Удалить можно только инвентаризацию в ожидании", 409)
    await tx.prepare("DELETE FROM stock_inventories WHERE id = ?").run(id)
  })
}

/**
 * Demo POST stock/inventory/:id/confirm/ {comment}: pending → confirmed. In one
 * transaction (row locked, confirms of the same warehouse serialized) every line
 * gets its system balance at the inventory moment, diff = counted − balance, the
 * average cost and diff × cost; the header gets Σ. A second confirm gets 409.
 */
export async function confirmStockInventory(id: number, comment: string | undefined, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  await withTransaction(async (tx) => {
    const row = await lockRow(tx, id)
    const status = asStatus(row.status)
    if (status === "confirmed") throw new StockInventoryError("Инвентаризация уже подтверждена", 409)
    if (status !== "pending") throw new StockInventoryError("Отмененную инвентаризацию нельзя подтвердить", 409)
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext(?)) AS locked").get(`stock_inventory:${textKey(row.warehouse)}`)
    const items = (await tx.prepare("SELECT * FROM stock_inventory_items WHERE inventory_id = ? ORDER BY position, id").all(id)) as ItemRow[]
    if (!items.length) throw new StockInventoryError("Вы еще не выбрали ни одного товара", 400, "items")
    let snapshot: LineSnapshot[]
    try {
      snapshot = await snapshotLines(momentOf(row, id), items.map((item) => ({ key: item.item_key, amount: Number(item.amount) || 0 })), tx)
    } catch (error) {
      console.error("stock inventories: confirm", error)
      throw new StockInventoryError("Не удалось рассчитать остатки склада", 503)
    }
    await tx
      .prepare(
        `UPDATE stock_inventory_items AS it SET balance_amount = t.b, diff = t.d, cost = t.c, total_price = t.tp
         FROM unnest(@ids::int[], @balances::float8[], @diffs::float8[], @costs::float8[], @totals::float8[]) AS t(id, b, d, c, tp)
         WHERE it.id = t.id AND it.inventory_id = @inventoryId`,
      )
      .run({
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

/** Demo PUT stock/inventory/:id/cancel_accept/: confirmed → canceled (its stock effect disappears). */
export async function cancelStockInventory(id: number, user: { displayName?: string; username?: string }): Promise<StockInventoryDetail> {
  await ensureStockInventoriesSchema()
  await withTransaction(async (tx) => {
    const row = await lockRow(tx, id)
    const status = asStatus(row.status)
    if (status === "canceled") throw new StockInventoryError("Инвентаризация уже отменена", 409)
    if (status !== "confirmed") throw new StockInventoryError("Отменить можно только подтвержденную инвентаризацию", 409)
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
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12) {
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
