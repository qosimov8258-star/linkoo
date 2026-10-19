import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { isIsoDay, todayIso } from "@/lib/finance/dates"
import { getNetCostRecord, getNetCostRecordRow } from "@/lib/net-cost-repo"
import { ensureNetCostSchema } from "@/lib/net-cost-schema"
import { syncNetCost } from "@/lib/net-cost-sync"
import type { NetCostEntryInput, NetCostImportResult, NetCostRecord } from "@/lib/net-cost-types"

// Manual cost entries ("Добавить себестоимость" / "Изменить себестоимость" / delete,
// "Импортировать с excel"). An entry sets the item's cost from the start of its day, in
// "Общий" or in one warehouse (which then keeps its own cost from that day). Deleting
// one hands its documents to the previous cost record of the item (the ledger simply
// runs without it). Messages are Russian i18n keys.

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

function validCost(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value < 1e15
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

async function recordOfEntry(entryId: number, key: string): Promise<NetCostRecord | null> {
  await syncNetCost()
  const row = (await getDb().prepare("SELECT id FROM net_cost_records WHERE nk = @nk").get({ nk: `manual:${entryId}:${key}` })) as { id: number } | undefined
  return row ? getNetCostRecord(Number(row.id)) : null
}

async function validate(db: PgDb, input: NetCostEntryInput, exceptId: number, fixedItem?: string): Promise<EntryError | { item: Resolved; warehouse: string }> {
  const item = await resolveItem(db, fixedItem ?? input.item)
  if (!item) return { error: "Товар не найден", status: 400 }
  if (!validCost(input.cost)) return { error: "Некорректная себестоимость", status: 400 }
  if (!isIsoDay(input.date)) return { error: "Некорректная дата", status: 400 }
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
        `INSERT INTO net_cost_entries (product_id, raw_material_id, item_label, cost, entry_date, warehouse, comment, source, created_by)
         VALUES (@pid, @rid, @label, @cost, @day, @warehouse, @comment, 'manual', @user)`,
      )
      .run({ pid: checked.item.productId, rid: checked.item.rawId, label: checked.item.label, cost: input.cost, day: input.date, warehouse: checked.warehouse, comment: input.comment, user: userName })
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
    const result = await tx
      .prepare("UPDATE net_cost_entries SET cost = @cost, entry_date = @day, warehouse = @warehouse, comment = @comment, updated_at = datetime('now') WHERE id = @id")
      .run({ id: found.entryId, cost: input.cost, day: input.date, warehouse: checked.warehouse, comment: input.comment })
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
  const result = await withTransaction(async (tx): Promise<NetCostImportResult | EntryError> => {
    await tx.prepare("SELECT pg_advisory_xact_lock(hashtext('linko:net-cost-entries')) AS ok").get()
    const errors: Array<{ row: number; error: string }> = []
    let created = 0
    let updated = 0
    const seen = new Set<string>()
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
      if (!day) {
        errors.push({ row: rowNo, error: "Некорректная дата" })
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
      const existing = await duplicateOf(tx, item, day, warehouse, 0)
      if (existing) {
        await tx.prepare("UPDATE net_cost_entries SET cost = @cost, updated_at = datetime('now') WHERE id = @id").run({ id: existing, cost })
        updated += 1
      } else {
        await tx
          .prepare(
            `INSERT INTO net_cost_entries (product_id, raw_material_id, item_label, cost, entry_date, warehouse, source, created_by)
             VALUES (@pid, @rid, @label, @cost, @day, @warehouse, 'excel', @user)`,
          )
          .run({ pid: item.productId, rid: item.rawId, label: item.label, cost, day, warehouse, user: userName })
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
  if (!isEntryError(result)) await syncNetCost()
  return result
}
