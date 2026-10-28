import "server-only"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { docYearOk, parseDocInput } from "@/lib/document-dates"
import { isIsoDay, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import { getStockBalances } from "@/lib/stock/ledger"
import { nowLocalMoment } from "@/lib/stock/moments"
import { ensureStockSchema } from "@/lib/stock/schema"
import { jsonLines } from "@/lib/stock/sources"
import {
  catalogIndex,
  countedByInventory,
  documentKeys,
  findShortages,
  findWarehouse,
  lockDocumentWarehouses,
  lockWarehousesOf,
  lockWarehouseStock,
  resolveLine,
  round6,
  shortageMessage,
  textKey,
  warehouseStock,
  WarehouseRenamedError,
  type CatalogIndex,
  type ItemStock,
  type WarehouseRef,
} from "@/lib/internal-transfers-stock"
import type { StockShortage } from "@/lib/internal-transfers-types"
import {
  WRITE_OFF_STATUSES,
  WRITE_OFF_TRANSITIONS,
  type WriteOff,
  type WriteOffAction,
  type WriteOffItem,
  type WriteOffListResult,
  type WriteOffOptions,
  type WriteOffStatus,
} from "@/lib/write-offs-types"

// "Списание" storage: write_offs (+ lazy finished / cancelled who-when
// columns). A write-off is created finished ("закрыт", demo "Списать") or
// pending, for a registered active warehouse, dated today or earlier;
// finishing is refused when the warehouse lacks the goods on any day from the
// write-off day on (stock core; lines flagged "defect" take Брак, up to the
// defective units on hand); a finished one can be cancelled unless a confirmed
// inventory of the same warehouse counted its items after they left. Line costs are the cost of goods
// (lib/stock/costs.ts) of the write-off day.

/** Contract 3 bound. */
export const MAX_WRITE_OFF_QTY = 1e9

declare global {
  var __linkoWriteOffsSchemaV1: Promise<void> | undefined
}

export async function ensureWriteOffsSchema(): Promise<void> {
  if (!globalThis.__linkoWriteOffsSchemaV1) {
    globalThis.__linkoWriteOffsSchemaV1 = outsideTransaction(async () => {
      await ensureStockSchema()
      await getDb().exec(`
        ALTER TABLE write_offs ADD COLUMN IF NOT EXISTS finished_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE write_offs ADD COLUMN IF NOT EXISTS finished_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE write_offs ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE write_offs ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
      `)
    }).catch((error) => {
      globalThis.__linkoWriteOffsSchemaV1 = undefined
      throw error
    })
  }
  await globalThis.__linkoWriteOffsSchemaV1
}

type WriteOffRow = {
  id: number
  creator: string
  warehouse: string
  date: string
  status: string
  comment: string
  reason: string
  items: string
  created_at: string
  finished_at: string
  finished_by: string
  cancelled_at: string
  cancelled_by: string
}

/** Series arrive either as a plain string or as the reference's series object ({ display_name, number, ... }). */
function seriesLabel(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    return String(record.display_name ?? record.number ?? "")
  }
  const text = String(value ?? "")
  return text === "-" ? "" : text
}

function parseItems(text: string): WriteOffItem[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text || "[]")
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  return parsed
    .filter((line): line is Record<string, unknown> => Boolean(line) && typeof line === "object")
    .map((line, index) => {
      const qty = Number(String(line.qty ?? 0).replace(",", ".")) || 0
      const cost = Number(String(line.cost ?? 0).replace(",", ".")) || 0
      return {
        id: Number(line.id) || index + 1,
        key: String(line.key ?? ""),
        product: String(line.product ?? ""),
        code: String(line.code ?? "") === "-" ? "" : String(line.code ?? ""),
        unit: String(line.unit ?? ""),
        series: seriesLabel(line.series),
        block: Number(line.block) || 0,
        qty,
        cost,
        sum: round6(qty * cost),
        ...(line.defect === true ? { defect: true } : {}),
      }
    })
}

/** Legacy "открыт" (and anything unknown) reads as pending. */
const statusOf = (value: string): WriteOffStatus => ((WRITE_OFF_STATUSES as string[]).includes(value) ? (value as WriteOffStatus) : "ожидает")

function rowToWriteOff(row: WriteOffRow): WriteOff {
  const items = parseItems(row.items)
  return {
    id: row.id,
    creator: row.creator,
    warehouse: row.warehouse,
    date: (row.date && parseAnyDate(row.date)) || parseAnyDate(row.created_at, true) || row.date,
    status: statusOf(row.status),
    comment: row.comment,
    reason: row.reason,
    items,
    total: round6(items.reduce((sum, item) => sum + item.sum, 0)),
    createdAt: parseAnyDate(row.created_at, true) ?? row.created_at,
    finishedAt: row.finished_at ?? "",
    finishedBy: row.finished_by ?? "",
    cancelledAt: row.cancelled_at ?? "",
    cancelledBy: row.cancelled_by ?? "",
  }
}

export async function getWriteOff(id: number, db?: PgDb): Promise<WriteOff | null> {
  await ensureWriteOffsSchema()
  const row = (await (db ?? getDb()).prepare("SELECT * FROM write_offs WHERE id = @id").get({ id })) as WriteOffRow | undefined
  return row ? rowToWriteOff(row) : null
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

export type WriteOffListQuery = {
  search: string
  ordering: string
  page: number
  pageSize: number
  warehouse: string[]
  creator: string[]
  status: WriteOffStatus[]
  fromDate: string
  toDate: string
}

const DATE_TS = "COALESCE(fin_ts(w.date), fin_ts(w.created_at, true))"
const ORDERING: Record<string, string> = { id: "w.id", created_date: DATE_TS, warehouse: "w.warehouse", creator: "w.creator", status: "w.status" }
export const WRITE_OFF_SORT_KEYS = Object.keys(ORDERING)

export async function listWriteOffs(query: WriteOffListQuery): Promise<WriteOffListResult> {
  await ensureWriteOffsSchema()
  const parts: string[] = []
  const params: Record<string, unknown> = {}
  const names = (column: string, param: string, values: string[]) => {
    if (!values.length) return
    parts.push(`fin_key(${column}) IN (SELECT fin_key(x) FROM unnest(@${param}::text[]) AS x)`)
    params[param] = values
  }
  names("w.warehouse", "whs", query.warehouse)
  names("w.creator", "creators", query.creator)
  if (query.status.length) {
    // Legacy "открыт" is pending.
    parts.push("(CASE WHEN w.status IN ('закрыт', 'отменен') THEN w.status ELSE 'ожидает' END) = ANY(@statuses::text[])")
    params.statuses = query.status
  }
  if (query.fromDate) {
    parts.push(`(${DATE_TS})::date >= @from_day::date`)
    params.from_day = query.fromDate
  }
  if (query.toDate) {
    parts.push(`(${DATE_TS})::date <= @to_day::date`)
    params.to_day = query.toDate
  }
  const search = query.search.trim()
  if (search) {
    params.search = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`
    params.search_id = /^\d{1,9}$/.test(search) ? Number(search) : -1
    // Lines by product name only (not the raw JSON: costs, blocks and ids would match digits).
    parts.push(`(w.id = @search_id OR w.warehouse ILIKE @search OR w.creator ILIKE @search OR w.comment ILIKE @search
      OR EXISTS (SELECT 1 FROM jsonb_array_elements(${jsonLines("w.items")}) AS l(j) WHERE l.j ->> 'product' ILIKE @search))`)
  }
  const where = parts.length ? `WHERE ${parts.join(" AND ")}` : ""
  const desc = query.ordering.startsWith("-")
  const expr = ORDERING[query.ordering.replace(/^-/, "")]
  const order = expr ? `ORDER BY ${expr} ${desc ? "DESC" : "ASC"} NULLS LAST, w.id DESC` : "ORDER BY w.id DESC"
  const pageSize = Math.max(0, query.pageSize)
  const page = Math.max(1, query.page)
  const limit = pageSize ? `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const db = getDb()
  // The db shim binds a lone object only when the SQL has @names.
  const args = Object.keys(params).length ? [params] : []
  const count = (await db.prepare(`SELECT count(*)::int AS n FROM write_offs w ${where}`).get(...args)) as { n: number }
  const rows = (await db.prepare(`SELECT w.* FROM write_offs w ${where} ${order} ${limit}`).all(...args)) as WriteOffRow[]
  return { count: Number(count?.n) || 0, page, pageSize, results: rows.map(rowToWriteOff) }
}

/** Legacy GET /api/write-offs (no paging params): every write-off, newest first. */
export async function listAllWriteOffs(): Promise<WriteOff[]> {
  await ensureWriteOffsSchema()
  return ((await getDb().prepare("SELECT * FROM write_offs ORDER BY id DESC").all()) as WriteOffRow[]).map(rowToWriteOff)
}

export async function writeOffOptions(): Promise<WriteOffOptions> {
  await ensureWriteOffsSchema()
  const db = getDb()
  const [warehouses, users] = await Promise.all([
    db.prepare("SELECT name FROM warehouses WHERE btrim(name) <> '' AND COALESCE(active, 1) = 1 UNION SELECT warehouse FROM write_offs WHERE btrim(warehouse) <> '' ORDER BY 1").all() as Promise<Array<{ name: string }>>,
    db.prepare("SELECT DISTINCT creator AS name FROM write_offs WHERE btrim(creator) <> '' ORDER BY 1").all() as Promise<Array<{ name: string }>>,
  ])
  const unique = (rows: Array<{ name: string }>) => [...new Map(rows.map((row) => [row.name.replace(/\s+/g, " ").trim().toLowerCase(), row.name.trim()])).values()]
  return { warehouses: unique(warehouses), users: unique(users) }
}

// ---------------------------------------------------------------------------
// Create / actions
// ---------------------------------------------------------------------------

export type WriteOffLineInput = { key?: string; product?: string; qty: number; series?: string; defect?: boolean }

export type WriteOffInput = {
  warehouse: string
  /** "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm" (local); '' = now. */
  date: string
  comment: string
  reason: string
  /** 'закрыт' (default, demo "Списать") or 'ожидает'. */
  status: "закрыт" | "ожидает"
  items: WriteOffLineInput[]
}

export type WriteOffError = { error: string; status: 400 | 404 | 409; shortages?: StockShortage[]; field?: string }
export type WriteOffChange = WriteOff | WriteOffError

export function isWriteOffError(value: unknown): value is WriteOffError {
  return Boolean(value) && typeof value === "object" && "error" in (value as object) && "status" in (value as object)
}

class WriteOffAbort extends Error {
  constructor(readonly result: WriteOffError) {
    super(result.error)
  }
}

async function inTransaction(fn: (tx: PgDb) => Promise<WriteOffChange>): Promise<WriteOffChange> {
  try {
    return await withTransaction(fn)
  } catch (error) {
    if (error instanceof WriteOffAbort) return error.result
    if (error instanceof WarehouseRenamedError) return { error: error.message, status: 409 }
    throw error
  }
}

/** Local date-time of the write-off (milliseconds: the cost ledger orders the day's
 * movements by it): now; a chosen time; or the end of an earlier chosen day. */
function momentOf(value: string): string | null {
  const text = value.trim()
  const now = nowLocalMoment()
  if (!text) return now
  if (isIsoDay(text)) return saneYear(text) ? (text >= now.slice(0, 10) ? `${text}${now.slice(10)}` : `${text}T23:59:59`) : null
  const parsed = parseDocInput(text)
  return parsed && saneYear(parsed) ? parsed : null
}

/** Years a write-off can sensibly carry (0001-01-01 or 9999-12-31 are typos → 400): the shared document rule. */
function saneYear(moment: string): boolean {
  return docYearOk(moment)
}

/** Lines with the canonical product, unit, blocks and the cost of goods of the day;
 * an invalid line is refused (400 with its `field`), never dropped. */
function buildLines(
  lines: WriteOffLineInput[],
  index: CatalogIndex,
  stock: Map<string, ItemStock>,
  orphans: Set<string>,
): WriteOffItem[] | WriteOffError {
  if (!lines.length) return { error: "Добавьте товары", status: 400, field: "items" }
  const items: WriteOffItem[] = []
  for (const [position, line] of lines.entries()) {
    const field = `items.${position}`
    if (!String(line.key ?? "").trim() && !String(line.product ?? "").trim()) return { error: "Выберите товар", status: 400, field: `${field}.key` }
    const qty = round6(Number(line.qty))
    if (!Number.isFinite(Number(line.qty)) || !(qty > 0)) return { error: "Количество должно быть больше 0", status: 400, field: `${field}.qty` }
    if (qty > MAX_WRITE_OFF_QTY) return { error: "Слишком большое количество", status: 400, field: `${field}.qty` }
    const resolved = resolveLine(index, line)
    let key = resolved.key
    if (!resolved.item) {
      // Only goods the warehouse holds under a legacy document name may be written off by name.
      key = `name:${textKey(key.startsWith("name:") ? key.slice(5) : resolved.name)}`
      if (!resolved.name || key === "name:" || !orphans.has(key)) return { error: "Товар не найден", status: 400, field: `${field}.key` }
    }
    const cost = round6(stock.get(key)?.cost ?? resolved.item?.fallbackCost ?? 0)
    const box = resolved.item?.boxSize ?? 0
    items.push({
      id: items.length + 1,
      key,
      product: resolved.name,
      code: resolved.item?.article ?? "",
      unit: resolved.item?.unit ?? "",
      series: String(line.series ?? "").trim(),
      block: box > 0 ? round6(qty / box) : 0,
      qty,
      // Брак carries no cost (the batch's raw cost belongs to its good output).
      cost: line.defect ? 0 : cost,
      sum: line.defect ? 0 : round6(qty * cost),
      ...(line.defect ? { defect: true } : {}),
    })
  }
  return items
}

/** Non-catalog ("name:") keys the warehouse's ledger has (legacy document names). */
async function ledgerOrphans(db: PgDb, warehouse: string, lines: WriteOffLineInput[], index: CatalogIndex): Promise<Set<string>> {
  if (lines.every((line) => resolveLine(index, line).item)) return new Set()
  const wanted = textKey(warehouse)
  const keys = new Set<string>()
  for (const row of await getStockBalances({ warehouses: [warehouse] }, db)) if (row.key.startsWith("name:") && textKey(row.warehouse) === wanted) keys.add(row.key)
  return keys
}

/** Refuses lines the warehouse does not have on every day from the write-off day on
 * (that day, each later day, today and the documents dated ahead): no day may go negative. */
async function checkStock(tx: PgDb, warehouse: string, day: string, items: WriteOffItem[], index: CatalogIndex) {
  const stock = await warehouseStock(warehouse, day, tx)
  const shortages = findShortages(
    items.map((item) => ({ product: item.product, quantity: item.qty, unit: item.unit, defect: item.defect })),
    index,
    stock,
  )
  if (shortages.length) throw new WriteOffAbort({ error: shortageMessage(warehouse, shortages), status: 409, shortages })
  return stock
}

/** The registered, active warehouse of a write-off (the registry's spelling). */
async function writeOffWarehouse(db: PgDb, name: string): Promise<WarehouseRef | WriteOffError> {
  const found = await findWarehouse(db, name)
  if (!found) return { error: "Склад не найден", status: 400, field: "warehouse" }
  if (!found.active) return { error: "Склад неактивен", status: 400, field: "warehouse" }
  return found
}

export async function createWriteOff(input: WriteOffInput, userName: string): Promise<WriteOffChange> {
  await ensureWriteOffsSchema()
  if (!input.warehouse.trim()) return { error: "Склад не выбран", status: 400, field: "warehouse" }
  const db = getDb()
  const checked = await writeOffWarehouse(db, input.warehouse)
  if (isWriteOffError(checked)) return checked
  const date = momentOf(input.date)
  if (!date) return { error: "Неверная дата", status: 400, field: "date" }
  if (date.slice(0, 10) > todayIso()) return { error: "Дата не может быть позже сегодняшнего дня", status: 400, field: "date" }
  const index = await catalogIndex(db)
  const checkedOrphans = await ledgerOrphans(db, checked.name, input.items, index)
  return inTransaction(async (tx) => {
    // Rename race: the warehouse's stock lock, then its name as it is now (lockDocumentWarehouses) —
    // a rename committed meanwhile is written off from under its new name, whose stock it is.
    const [locked] = await lockDocumentWarehouses(tx, [checked])
    if (!locked) return { error: "Склад не найден", status: 400, field: "warehouse" }
    if (!locked.active) return { error: "Склад неактивен", status: 400, field: "warehouse" }
    const warehouse = locked.name
    const orphans = locked.renamed ? await ledgerOrphans(tx, warehouse, input.items, index) : checkedOrphans
    const stock = await warehouseStock(warehouse, date.slice(0, 10), tx)
    const items = buildLines(input.items, index, stock, orphans)
    if (isWriteOffError(items)) return items
    if (input.status === "закрыт") await checkStock(tx, warehouse, date.slice(0, 10), items, index)
    const finished = input.status === "закрыт"
    const result = await tx
      .prepare(
        `INSERT INTO write_offs (creator, warehouse, date, status, comment, reason, items, finished_at, finished_by, updated_at)
         VALUES (@creator, @warehouse, @date, @status, @comment, @reason, @items, @finished_at, @finished_by, datetime('now'))`,
      )
      .run({
        creator: userName,
        warehouse,
        date,
        status: input.status,
        comment: input.comment.trim(),
        reason: input.reason.trim(),
        items: JSON.stringify(items),
        finished_at: finished ? nowLocalMoment() : "",
        finished_by: finished ? userName : "",
      })
    return (await getWriteOff(Number(result.lastInsertRowid), tx))!
  })
}

/** A confirmed inventory of the warehouse counted the written-off goods after they left
 * (a later day, or an end-of-day count of that day confirmed after the write-off) —
 * only counts of the write-off's own items, confirmed after it was finished. */
async function linkedInventory(tx: PgDb, writeOff: WriteOff, index: CatalogIndex): Promise<boolean> {
  const day = parseAnyDay(writeOff.date) ?? writeOff.date.slice(0, 10)
  // The goods left when it was finished (that day), else at its date.
  const finished = parseAnyDate(writeOff.finishedAt)
  const moment = finished && finished.slice(0, 10) === day ? finished : (parseAnyDate(writeOff.date) ?? `${day}T00:00:00`)
  return countedByInventory(tx, writeOff.warehouse, day, moment, documentKeys(index, writeOff.items), { registeredAt: finished })
}

/** POST /api/write-offs/[id]/action: finish (ожидает → закрыт) / cancel (→ отменен). */
export async function writeOffAction(id: number, action: WriteOffAction, userName: string): Promise<WriteOffChange> {
  await ensureWriteOffsSchema()
  const index = await catalogIndex()
  return inTransaction(async (tx) => {
    // Lock order (C1): the warehouse's stock lock before the row lock.
    if (action === "finish") await lockWarehousesOf(tx, "SELECT warehouse FROM write_offs WHERE id = @id", { id })
    const locked = (await tx.prepare("SELECT * FROM write_offs WHERE id = @id FOR UPDATE").get({ id })) as WriteOffRow | undefined
    if (!locked) return { error: "Списание не найдено", status: 404 }
    const current = rowToWriteOff(locked)
    const transition = WRITE_OFF_TRANSITIONS[action]
    if (!transition.from.includes(current.status)) return { error: `Действие недоступно для текущего статуса списания (${current.status})`, status: 409 }
    const now = nowLocalMoment()
    if (action === "finish") {
      const warehouse = await writeOffWarehouse(tx, current.warehouse)
      if (isWriteOffError(warehouse)) return warehouse
      await lockWarehouseStock(tx, [current.warehouse])
      const day = parseAnyDay(current.date) ?? now.slice(0, 10)
      const stock = await checkStock(tx, current.warehouse, day, current.items, index)
      // Cost of goods when the goods actually leave (Брак carries none).
      const items = current.items.map((item) => {
        const cost = item.defect ? 0 : round6(stock.get(item.key)?.cost ?? item.cost)
        return { ...item, cost, sum: round6(item.qty * cost) }
      })
      await tx
        .prepare("UPDATE write_offs SET status = 'закрыт', items = @items, finished_at = @at, finished_by = @by, updated_at = datetime('now') WHERE id = @id")
        .run({ id, items: JSON.stringify(items), at: now, by: userName })
    } else {
      if (current.status === "закрыт" && (await linkedInventory(tx, current, index))) {
        return { error: "Отменение невозможно из-за связи с другими данными", status: 409 }
      }
      await tx.prepare("UPDATE write_offs SET status = 'отменен', cancelled_at = @at, cancelled_by = @by, updated_at = datetime('now') WHERE id = @id").run({ id, at: now, by: userName })
    }
    return (await getWriteOff(id, tx))!
  })
}

/** Hard delete of a write-off without stock effect (pending / cancelled). */
export async function deleteWriteOff(id: number): Promise<"ok" | "not_found" | "locked"> {
  await ensureWriteOffsSchema()
  // The status is read from the locked row, so a delete racing "finish" can never
  // remove a write-off that has just been closed.
  return withTransaction(async (tx) => {
    const locked = (await tx.prepare("SELECT status FROM write_offs WHERE id = @id FOR UPDATE").get({ id })) as { status: string } | undefined
    if (!locked) return "not_found"
    if (locked.status === "закрыт") return "locked"
    await tx.prepare("DELETE FROM write_offs WHERE id = @id").run({ id })
    return "ok"
  })
}
