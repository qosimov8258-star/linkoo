import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { DOC_DATE_FUTURE, docDateError } from "@/lib/document-dates"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { getNetCostRecord, getNetCostRecordRow } from "@/lib/net-cost-repo"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import { syncNetCost } from "@/lib/net-cost-sync"
import type { NetCostEntryInput, NetCostImportResult, NetCostRecord } from "@/lib/net-cost-types"
import { refreshProductCostCache } from "@/lib/stock/costs"
import { nowLocalMoment } from "@/lib/stock/moments"

// Manual cost entries ("Добавить себестоимость" / "Изменить себестоимость" / delete,
// "Импортировать с excel"), in "Общий" or in one warehouse (which then keeps its own cost
// from then on). When an entry takes effect (lib/net-cost-ledger.ts):
//   - entered on its own day (today's date): from the moment it was entered — it revalues
//     the stock on hand at that moment, after the documents of that day registered
//     earlier, so a cost entered "now" is the cost now;
//   - back-dated (or an older entry dated ahead): from the start of its day, before that
//     day's documents.
// The date of an entry (form or Excel) is a real day of a year 2000..2100, not after today
// (lib/document-dates.ts: a typo such as 2062 would silently set the cost once that day
// comes); an edit may keep the day the entry already has.
// entered_at keeps that moment: set on create and when the date or warehouse change (the
// entry then takes effect anew). A new cost — an edit or a re-import of the same item, day
// and warehouse — corrects the entry where it was entered (the moment is kept), as does a
// comment edit. Older rows without entered_at keep the rule they were entered under: from
// the start of their day (lib/net-cost-sync.ts). Deleting an entry hands its documents to
// the previous cost record of the item (the ledger simply runs without it).
// products.cost (a cache of the cost of goods) is refreshed after every change.
// Messages are Russian i18n keys.

export type EntryError = { error: string; status: number; rows?: Array<{ row: number; error: string }> }

export const isEntryError = (value: unknown): value is EntryError => Boolean(value && typeof value === "object" && "error" in value)

type Resolved = { productId: number | null; rawId: number | null; label: string; key: string }

/** A live catalog item by key ("product:12" / "raw_material:3"). */
async function resolveItem(db: PgDb, key: string): Promise<Resolved | null> {
  const match = /^(product|raw_material):(\d+)$/.exec(key.trim())
  if (!match) return null
  const table = match[1] === "product" ? "products" : "raw_materials"
  const id = Number(match[2])
  const row = (await db.prepare(`SELECT id, name FROM ${table} WHERE id = @id AND COALESCE(deleted, 0) = 0`).get({ id })) as { id: number; name: string } | undefined
  if (!row) return null
  return { productId: match[1] === "product" ? id : null, rawId: match[1] === "raw_material" ? id : null, label: row.name, key: `${match[1]}:${id}` }
}

/** A live catalog item by name (products first, lowest id — the stock core's rule). */
async function resolveItemByName(db: PgDb, name: string): Promise<Resolved | null> {
  const row = (await db
    .prepare(
      `SELECT kind, id, name FROM (
         SELECT 'product' AS kind, 0 AS pri, id, name FROM products WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
         UNION ALL
         SELECT 'raw_material', 1, id, name FROM raw_materials WHERE fin_key(name) = fin_key(@name) AND COALESCE(deleted, 0) = 0
       ) x ORDER BY pri, id LIMIT 1`,
    )
    .get({ name })) as { kind: string; id: number; name: string } | undefined
  if (!row) return null
  return { productId: row.kind === "product" ? Number(row.id) : null, rawId: row.kind === "raw_material" ? Number(row.id) : null, label: row.name, key: `${row.kind}:${row.id}` }
}

/** '' (= Общий) or the warehouses table's spelling; null = unknown warehouse. */
async function resolveWarehouse(db: PgDb, name: string): Promise<string | null> {
  if (!name.trim()) return ""
  const row = (await db.prepare("SELECT name FROM warehouses WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })) as { name: string } | undefined
  return row ? row.name : null
}

/** Contract 3: money |x| ≤ 1e13 (a cost is never negative). */
function validCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1e13
}

async function duplicateOf(db: PgDb, item: Resolved, day: string, warehouse: string, exceptId: number): Promise<number | null> {
  const row = (await db
    .prepare(
      `SELECT id FROM net_cost_entries
       WHERE COALESCE(product_id, 0) = @pid AND COALESCE(raw_material_id, 0) = @rid AND entry_date = @day AND fin_key(warehouse) = fin_key(@warehouse) AND id <> @except
       ORDER BY id LIMIT 1`,
    )
    .get({ pid: item.productId ?? 0, rid: item.rawId ?? 0, day, warehouse, except: exceptId })) as { id: number } | undefined
  return row ? Number(row.id) : null
}

/** products.cost is a cache of the cost of goods: refresh it for the products whose entries
 * changed (committed). A failure is logged, not raised (the ledger is the source). */
async function refreshCachedCosts(keys: string[]): Promise<void> {
  const ids = keys.map((key) => /^product:(\d+)$/.exec(key)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]))
  if (!ids.length) return
  try {
    await withTransaction((tx) => refreshProductCostCache(tx, ids))
  } catch (error) {
    console.error("[net-cost-entries] products.cost refresh failed", error)
  }
}

async function recordOfEntry(entryId: number, key: string): Promise<NetCostRecord | null> {
  await refreshCachedCosts([key])
  await syncNetCost()
  const row = (await getDb().prepare("SELECT id FROM net_cost_records WHERE nk = @nk").get({ nk: `manual:${entryId}:${key}` })) as { id: number } | undefined
  return row ? getNetCostRecord(Number(row.id)) : null
}

/** Error key of an entry day (ISO "YYYY-MM-DD"): a real day of a year 2000..2100, not after
 * today unless it is `current` (the day an edited entry already has); null when it is fine. */
function entryDayError(day: string, current?: string): string | null {
  if (!day || !isIsoDay(day)) return "Некорректная дата"
  const error = docDateError(day, { current })
  return error === DOC_DATE_FUTURE ? DOC_DATE_FUTURE : error ? "Некорректная дата" : null
}

async function validate(db: PgDb, input: NetCostEntryInput, exceptId: number, fixedItem?: string): Promise<EntryError | { item: Resolved; warehouse: string }> {
  const item = await resolveItem(db, fixedItem ?? input.item)
  if (!item) return { error: "Товар не найден", status: 400 }
  if (!validCost(input.cost)) return { error: "Некорректная себестоимость", status: 400 }
  const current = exceptId
    ? ((await db.prepare("SELECT entry_date FROM net_cost_entries WHERE id = @id").get({ id: exceptId })) as { entry_date: string } | undefined)?.entry_date
    : undefined
  const dayError = entryDayError(input.date, current)
  if (dayError) return { error: dayError, status: 400 }
  const warehouse = await resolveWarehouse(db, input.warehouse)
  if (warehouse === null) return { error: "Склад не найден", status: 400 }
  if (await duplicateOf(db, item, input.date, warehouse, exceptId)) return { error: "Себестоимость на эту дату уже добавлена", status: 409 }
  return { item, warehouse }
}

export async function createNetCostEntry(input: NetCostEntryInput, userName: string): Promise<NetCostRecord | EntryError> {
  await ensureNetCostSchema()
  const created = await withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:net-cost-entries')) AS ok").get()
    const checked = await validate(tx, input, 0)
    if (isEntryError(checked)) return checked
    const result = await tx
      .prepare(
        `INSERT INTO net_cost_entries (product_id, raw_material_id, item_label, cost, entry_date, warehouse, comment, source, created_by, entered_at)
         VALUES (@pid, @rid, @label, @cost, @day, @warehouse, @comment, 'manual', @user, @at)`,
      )
      .run({ pid: checked.item.productId, rid: checked.item.rawId, label: checked.item.label, cost: input.cost, day: input.date, warehouse: checked.warehouse, comment: input.comment, user: userName, at: nowLocalMoment() })
    return { id: Number(result.lastInsertRowid), key: checked.item.key }
  })
  if (isEntryError(created)) return created
  return (await recordOfEntry(created.id, created.key)) ?? { error: "Себестоимость не найдена", status: 404 }
}

/** The manual entry behind a cost record. */
async function entryOfRecord(db: PgDb, recordId: number): Promise<{ entryId: number; key: string } | EntryError> {
  await ensureNetCostSchema()
  await syncNetCost()
  const row = await getNetCostRecordRow(db, recordId)
  if (!row) return { error: "Себестоимость не найдена", status: 404 }
  if (row.source_type !== "manual" || !row.entry_id) return { error: "Изменить можно только произвольную себестоимость", status: 400 }
  return { entryId: Number(row.entry_id), key: row.item_key }
}

/** "Изменить себестоимость": cost, date and warehouse (the product stays). */
export async function updateNetCostEntry(recordId: number, input: NetCostEntryInput): Promise<NetCostRecord | EntryError> {
  const found = await entryOfRecord(getDb(), recordId)
  if (isEntryError(found)) return found
  const updated = await withTransaction(async (tx) => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:net-cost-entries')) AS ok").get()
    const checked = await validate(tx, input, found.entryId, found.key)
    if (isEntryError(checked)) return checked
    // A new date / warehouse is entered now (entered_at); a new cost or comment corrects the
    // entry at the moment it was entered (a typo fix does not revalue later receipts).
    const result = await tx
      .prepare(
        `UPDATE net_cost_entries SET
           entered_at = CASE WHEN entry_date <> @day OR fin_key(warehouse) <> fin_key(@warehouse) THEN @at ELSE entered_at END,
           cost = @cost, entry_date = @day, warehouse = @warehouse, comment = @comment, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({ id: found.entryId, cost: input.cost, day: input.date, warehouse: checked.warehouse, comment: input.comment, at: nowLocalMoment() })
    return result.changes ? null : ({ error: "Себестоимость не найдена", status: 404 } as EntryError)
  })
  if (updated) return updated
  return (await recordOfEntry(found.entryId, found.key)) ?? { error: "Себестоимость не найдена", status: 404 }
}

export async function deleteNetCostEntry(recordId: number): Promise<{ ok: true } | EntryError> {
  const db = getDb()
  const found = await entryOfRecord(db, recordId)
  if (isEntryError(found)) return found
  await db.prepare("DELETE FROM net_cost_entries WHERE id = @id").run({ id: found.entryId })
  await refreshCachedCosts([found.key])
  await syncNetCost()
  return { ok: true }
}

// --- Excel ---------------------------------------------------------------------------------

/** Header text → field (lower-cased, punctuation dropped). */
const HEADERS: Array<[RegExp, "name" | "cost" | "date" | "warehouse"]> = [
  [/^(наименование|продукт|товар|name|product|nomi|mahsulot)/, "name"],
  [/^(себестоимость|cost|tannarx|цена)/, "cost"],
  [/^(дата|date|sana)/, "date"],
  [/^(склад|warehouse|ombor)/, "warehouse"],
]

const headerKey = (text: string) =>
  text
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-zа-яё0-9' ]+/gi, " ")
    .trim()

/** Excel serial day, "YYYY-MM-DD", "DD.MM.YYYY" / "DD/MM/YYYY" → ISO day; '' = invalid. */
export function excelDay(value: string): string {
  const text = value.trim()
  if (!text) return todayIso()
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    const date = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86_400_000)
    return date.toISOString().slice(0, 10)
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text)
  const dotted = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(text)
  const [y, m, d] = iso ? [iso[1], iso[2], iso[3]] : dotted ? [dotted[3], dotted[2], dotted[1]] : ["", "", ""]
  const day = y ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}` : ""
  return day && isIsoDay(day) ? day : ""
}

export function excelNumber(value: string): number {
  const text = value.replace(/[\s ]/g, "").replace(",", ".")
  return text ? Number(text) : Number.NaN
}

/** Imports manual entries: Наименование | Себестоимость | Дата | Склад (rows without a cost are skipped).
 * All rows or none: the reply lists the rows that could not be read. */
export async function importNetCostEntries(rows: string[][], userName: string): Promise<NetCostImportResult | EntryError> {
  await ensureNetCostSchema()
  const header = (rows[0] ?? []).map((cell) => headerKey(String(cell ?? "")))
  const column: Partial<Record<"name" | "cost" | "date" | "warehouse", number>> = {}
  header.forEach((text, index) => {
    const field = HEADERS.find(([pattern]) => pattern.test(text))?.[1]
    if (field && column[field] === undefined) column[field] = index
  })
  if (column.name === undefined || column.cost === undefined) return { error: "В файле нет колонок «Наименование» и «Себестоимость»", status: 400 }
  const keys = new Set<string>()
  const result = await withTransaction(async (tx): Promise<NetCostImportResult | EntryError> => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:net-cost-entries')) AS ok").get()
    const errors: Array<{ row: number; error: string }> = []
    let created = 0
    let updated = 0
    const seen = new Set<string>()
    const at = nowLocalMoment()
    for (let index = 1; index < rows.length; index += 1) {
      const cells = rows[index].map((cell) => String(cell ?? "").trim())
      const cell = (field: keyof typeof column) => (column[field] === undefined ? "" : (cells[column[field]!] ?? ""))
      const name = cell("name")
      const costText = cell("cost")
      if (!name && !costText) continue
      if (!costText) continue
      const rowNo = index + 1
      const item = name ? await resolveItemByName(tx, name) : null
      if (!item) {
        errors.push({ row: rowNo, error: "Товар не найден" })
        continue
      }
      const cost = excelNumber(costText)
      if (!validCost(cost)) {
        errors.push({ row: rowNo, error: "Некорректная себестоимость" })
        continue
      }
      const day = excelDay(cell("date"))
      const dayError = entryDayError(day)
      if (dayError) {
        errors.push({ row: rowNo, error: dayError })
        continue
      }
      const warehouse = await resolveWarehouse(tx, cell("warehouse"))
      if (warehouse === null) {
        errors.push({ row: rowNo, error: "Склад не найден" })
        continue
      }
      const unique = `${item.key}|${day}|${warehouse.toLowerCase()}`
      if (seen.has(unique)) {
        errors.push({ row: rowNo, error: "Себестоимость на эту дату уже добавлена" })
        continue
      }
      seen.add(unique)
      keys.add(item.key)
      const existing = await duplicateOf(tx, item, day, warehouse, 0)
      if (existing) {
        // The same item, day and warehouse: a new cost corrects the entry where it was entered.
        await tx.prepare("UPDATE net_cost_entries SET cost = @cost, updated_at = datetime('now') WHERE id = @id").run({ id: existing, cost })
        updated += 1
      } else {
        await tx
          .prepare(
            `INSERT INTO net_cost_entries (product_id, raw_material_id, item_label, cost, entry_date, warehouse, source, created_by, entered_at)
             VALUES (@pid, @rid, @label, @cost, @day, @warehouse, 'excel', @user, @at)`,
          )
          .run({ pid: item.productId, rid: item.rawId, label: item.label, cost, day, warehouse, user: userName, at })
        created += 1
      }
    }
    if (errors.length) throw Object.assign(new Error("rows"), { rows: errors })
    if (!created && !updated) return { error: "Не удалось найти товары для импорта в выбранном файле", status: 400 }
    return { created, updated }
  }).catch((error: unknown) => {
    const rowErrors = (error as { rows?: Array<{ row: number; error: string }> }).rows
    if (rowErrors) return { error: "Проверьте правильность заполнения полей", status: 400, rows: rowErrors.slice(0, 200) } as EntryError
    throw error
  })
  if (!isEntryError(result)) {
    await refreshCachedCosts([...keys])
    await syncNetCost()
  }
  return result
}
