import "server-only"

import { z } from "zod"

import { getDb, outsideTransaction, withTransaction, type PgDb } from "@/lib/db"
import { returnPaymentType, type ReturnItem, type SupplierReturn } from "@/components/analytics/supplier-returns-data"
import { parseDocDay, type DocDate } from "@/lib/document-dates"
import { nowLocalIso, parseAnyDate, parseAnyDay, todayIso } from "@/lib/finance/dates"
import {
  catalogIndex,
  countedByInventory,
  documentKeys,
  findShortages,
  ledgerKey,
  lockDocumentWarehouses,
  lockNamedWarehouse,
  lockWarehousesOf,
  lockWarehouseStock,
  resolveLine,
  round6,
  shortageMessage,
  textKey,
  warehouseStock,
  type CatalogIndex,
} from "@/lib/internal-transfers-stock"
import type { StockShortage } from "@/lib/internal-transfers-types"
import { ensureStockSchema } from "@/lib/stock/schema"
import {
  ensureProcurementFunctions,
  findBranch,
  findCurrency,
  findOrganization,
  findSupplier,
  findWarehouse,
  isPlaceholder,
  MAX_MONEY,
  MAX_QTY,
  optionalText,
  priceSchema,
  ProcurementError,
  quantitySchema,
} from "@/lib/supplier-refs"

// "Возврат поставщикам". A return is created "в процессе", handed over
// ("завершен": the goods leave the warehouse and the supplier owes us) or
// cancelled ("отменен"; cancelling a completed return brings the goods back).
// Like Linko, a return of any status can be edited (except one copied from Linko's
// old base): a completed one keeps booking its goods on its (new) date, so the edit
// is refused when it would take more out of the warehouse than it holds, and an edit
// or a cancel that moves its goods is refused once a confirmed inventory has counted
// them since (assertNotCounted). A line may
// carry a series of the shared series catalog (stock_series), stored by id.
// Every reference must exist (supplier, warehouse, branch, organization,
// currency, catalog products) and lines must have qty > 0, price ≥ 0; a hand-over
// is refused while the warehouse does not hold the goods. On hand-over the
// currency rate is kept in rate_to_base (contract 2). The return date is stored as
// "YYYY-MM-DD" like supplies (any typed format is accepted on input; year 2000..2100,
// not after today — lib/document-dates.ts); older rows typed as "19.10.2026" or
// "20 октября 2026" are read back as "YYYY-MM-DD" too (the stored text is not rewritten).

type Row = {
  id: number
  from_whom: string
  warehouse: string
  added_by: string
  date: string
  time: string
  amount: number
  status: string
  organization: string
  currency: string
  payment_type: string
  price_list: string
  branch: string
  transfer_time: string
  transferred_by: string
  cancelled_at: string
  cancelled_by: string
  reason: string
  items: string
  from_old_base?: number | string | boolean | null
}

declare global {
  // V2: + rate_to_base, amount DOUBLE PRECISION. V3: + from_old_base.
  var __linkoReturnsSchemaReadyV3: Promise<void> | undefined
}

async function installSchema(): Promise<void> {
  await ensureProcurementFunctions(getDb())
  await withTransaction(async (tx) => {
    await tx.exec("SELECT pg_advisory_xact_lock(hashtext('linko:supplier_returns:schema'))")
    await tx.exec(`
      ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS transferred_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
      ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS rate_to_base DOUBLE PRECISION;
      -- Linko's return_from_old_base (lines from its old base): such a return is never edited.
      ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS from_old_base INTEGER NOT NULL DEFAULT 0;

      -- amount was REAL (float4): widen it once and recompute it from the lines.
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = current_schema() AND table_name = 'supplier_returns'
                     AND column_name = 'amount' AND data_type = 'real') THEN
          ALTER TABLE supplier_returns ALTER COLUMN amount TYPE double precision;
          UPDATE supplier_returns r SET amount = t.total
            FROM (SELECT x.id, SUM(CASE WHEN jsonb_typeof(e -> 'qty') = 'number' AND jsonb_typeof(e -> 'price') = 'number'
                                        THEN (e ->> 'qty')::double precision * (e ->> 'price')::double precision END) AS total
                    FROM supplier_returns x
                    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN pg_input_is_valid(x.items, 'jsonb')
                      THEN CASE WHEN jsonb_typeof(x.items::jsonb) = 'array' THEN x.items::jsonb END END) e
                   GROUP BY x.id
                  HAVING bool_and(jsonb_typeof(e -> 'qty') = 'number' AND jsonb_typeof(e -> 'price') = 'number')) t
           WHERE t.id = r.id AND abs(r.amount - t.total) <= greatest(1, abs(t.total) * 1e-6);
        END IF;
      END $$;
    `)
  })
}

async function returnsDb(): Promise<PgDb> {
  if (!globalThis.__linkoReturnsSchemaReadyV3) {
    globalThis.__linkoReturnsSchemaReadyV3 = outsideTransaction(installSchema).catch((error) => {
      globalThis.__linkoReturnsSchemaReadyV3 = undefined
      throw error
    })
  }
  await globalThis.__linkoReturnsSchemaReadyV3
  // The stock core's own DDL runs outside the transactions that read it (hand-over check).
  await ensureStockSchema()
  return getDb()
}

function parseItems(value: string): ReturnItem[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown
    return Array.isArray(parsed) ? (parsed as ReturnItem[]) : []
  } catch {
    return []
  }
}

const truthy = (value: unknown) => value === true || ["1", "true", "t"].includes(String(value ?? "").trim().toLowerCase())

/** A series' name as Linko shows it (displayName): its number, else its expiry day, else its id. */
type SeriesRow = { id: number; product_id: number; number: string | null; expiration_date: string | null }
const seriesName = (row: SeriesRow) => row.number || /^\d{4}-\d{2}-\d{2}/.exec(row.expiration_date ?? "")?.[0] || String(row.id)

/** The catalog series by id (none when the catalog table does not exist yet). */
async function seriesByIds(db: PgDb, ids: number[]): Promise<Map<number, SeriesRow>> {
  const wanted = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0 && id <= 2_147_483_647))]
  if (!wanted.length) return new Map()
  const table = (await db.prepare("SELECT to_regclass('stock_series') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!table.ok) return new Map()
  const rows = (await db.prepare("SELECT id, product_id, number, expiration_date FROM stock_series WHERE id = ANY(?::int[])").all(wanted)) as SeriesRow[]
  return new Map(rows.map((row) => [Number(row.id), { ...row, id: Number(row.id), product_id: Number(row.product_id) }]))
}

/** Lines with their series' current names from the catalog. */
async function withSeriesNames(db: PgDb, rows: SupplierReturn[]): Promise<SupplierReturn[]> {
  const ids = rows.flatMap((row) => row.items.map((item) => Number(item.seriesId)).filter((id) => id > 0))
  if (!ids.length) return rows
  const series = await seriesByIds(db, ids)
  return rows.map((row) => ({
    ...row,
    items: row.items.map((item) => {
      const found = item.seriesId ? series.get(Number(item.seriesId)) : undefined
      return found ? { ...item, series: seriesName(found) } : item
    }),
  }))
}

function rowToReturn(row: Row): SupplierReturn {
  return {
    id: row.id,
    fromWhom: row.from_whom,
    warehouse: row.warehouse,
    addedBy: row.added_by,
    // Older rows keep the typed text ("19.10.2026", "20 октября 2026"): read back as YYYY-MM-DD.
    date: parseAnyDay(row.date) ?? row.date,
    time: row.time,
    amount: Number(row.amount) || 0,
    status: row.status as SupplierReturn["status"],
    organization: row.organization,
    currency: row.currency,
    paymentType: returnPaymentType(row.payment_type),
    priceList: row.price_list,
    branch: row.branch,
    transferTime: row.transfer_time,
    transferredBy: row.transferred_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    reason: row.reason,
    fromOldBase: truthy(row.from_old_base),
    items: parseItems(row.items),
  }
}

const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** "19 октября 2026" of a YYYY-MM-DD day (the hand-over / cancel stamps). */
function ruDay(day: string): string {
  const [y, m, d] = day.split("-")
  return `${d} ${RU_MONTHS[Number(m) - 1] ?? ""} ${y}`
}

/** Local (Asia/Tashkent) "19 октября 2026, 14:05". */
function ruStamp(): string {
  const now = nowLocalIso()
  return `${ruDay(now.slice(0, 10))}, ${now.slice(11, 16)}`
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

const returnItemSchema = z
  .object({
    id: z.unknown().optional(),
    /** Catalog key from a picker, optional. */
    key: optionalText(200),
    product: z.string({ error: "Выберите товар" }).trim().min(1, "Выберите товар").max(500, "Не более 500 символов"),
    qty: quantitySchema,
    series: optionalText(200),
    /** A series of the shared catalog (stock_series.id) for the line's product. */
    seriesId: z.number({ error: "Серия не найдена" }).int("Серия не найдена").min(1, "Серия не найдена").max(2_147_483_647, "Серия не найдена").nullable().optional(),
    price: priceSchema,
    total: z.unknown().optional(),
  })
  .refine((item) => item.qty * item.price <= MAX_MONEY, { message: "Слишком большая сумма строки", path: ["price"] })

/** POST /api/supplier-returns, PUT /api/supplier-returns/[id]. */
export const supplierReturnSchema = z
  .object({
    fromWhom: z.string({ error: "Выберите поставщика" }).trim().min(1, "Выберите поставщика").max(255, "Не более 255 символов"),
    warehouse: z.string({ error: "Выберите склад" }).trim().min(1, "Выберите склад").max(255, "Не более 255 символов"),
    organization: optionalText(255),
    branch: optionalText(255),
    currency: optionalText(12),
    priceList: optionalText(255),
    paymentType: optionalText(100),
    /** Any parseable date (default today); stored as YYYY-MM-DD. */
    date: optionalText(60),
    comment: optionalText(2000),
    items: z.array(returnItemSchema, { error: "Добавьте товары" }).min(1, "Добавьте товары").max(1000, "Не более 1000 строк"),
  })
  .refine((body) => body.items.reduce((sum, item) => sum + item.qty * item.price, 0) <= MAX_MONEY, { message: "Слишком большая сумма возврата", path: ["items"] })

export type SupplierReturnBody = z.infer<typeof supplierReturnSchema>

export type SupplierReturnInput = {
  fromWhom: string
  warehouse: string
  organization: string
  branch: string
  currency: string
  priceList: string
  paymentType: string
  date: string
  comment: string
  items: Array<ReturnItem & { key?: string }>
}

export function parseSupplierReturnInput(body: SupplierReturnBody): SupplierReturnInput {
  return {
    fromWhom: body.fromWhom.trim(),
    warehouse: body.warehouse.trim(),
    organization: body.organization?.trim() ?? "",
    branch: body.branch?.trim() ?? "",
    currency: body.currency?.trim() ?? "",
    priceList: body.priceList?.trim() ?? "",
    paymentType: body.paymentType?.trim() ?? "",
    date: body.date?.trim() ?? "",
    comment: body.comment ?? "",
    items: body.items.map((item, index) => {
      const id = Number(item.id)
      return {
        id: Number.isInteger(id) && id > 0 ? id : index + 1,
        key: item.key?.trim() || undefined,
        product: item.product.trim(),
        qty: item.qty,
        series: item.series?.trim() ?? "",
        seriesId: item.seriesId ?? null,
        price: item.price,
        total: Math.round(item.qty * item.price * 1e6) / 1e6,
      }
    }),
  }
}

/** Canonical references; a 400 ProcurementError with every field error otherwise. */
async function resolveReturn(tx: PgDb, input: SupplierReturnInput, index: CatalogIndex, keepDate?: string): Promise<SupplierReturnInput> {
  const fields: Record<string, string> = {}
  const supplier = await findSupplier(tx, input.fromWhom)
  if (!supplier) fields.fromWhom = "Поставщик не найден"
  const warehouse = await findWarehouse(tx, input.warehouse)
  if (!warehouse) fields.warehouse = "Склад не найден"
  let branch = input.branch
  if (!isPlaceholder(branch)) {
    const found = await findBranch(tx, branch)
    if (found) branch = found.name
    else fields.branch = "Филиал не найден"
  }
  let organization = input.organization
  if (!isPlaceholder(organization)) {
    const found = await findOrganization(tx, organization)
    if (found) organization = found.name
    else fields.organization = "Организация не найдена"
  }
  const currency = await findCurrency(tx, input.currency || null)
  if (!currency) fields.currency = "Неизвестная валюта"
  // A supply document: any typed format, stored as "YYYY-MM-DD" (default today); year 2000..2100
  // and never after today, except an edit keeping its own day (lib/document-dates.ts).
  const day: DocDate = input.date ? parseDocDay(input.date, { current: keepDate }) : { ok: true, date: todayIso() }
  if (!day.ok) fields.date = day.error
  const series = await seriesByIds(tx, input.items.map((item) => Number(item.seriesId)))
  const items = input.items.map((item, position) => {
    const line = resolveLine(index, { key: item.key, product: item.product })
    if (!line.item) fields[`items.${position}.product`] = "Товар не найден в каталоге"
    const rest: ReturnItem = { ...item }
    delete rest.key
    // The catalog key stays on the line: the stock ledger books the line under it.
    if (line.item) rest.key = line.item.key
    if (item.seriesId) {
      const found = series.get(Number(item.seriesId))
      // A series belongs to one product: the line's own (a product of the catalog, "product:<id>").
      if (!found || !line.item || line.item.key !== `product:${found.product_id}`) fields[`items.${position}.series`] = "Серия не найдена"
      else {
        rest.seriesId = found.id
        rest.series = seriesName(found)
      }
    } else delete rest.seriesId
    return { ...rest, product: line.item ? line.item.name : item.product }
  })
  const messages = Object.values(fields)
  if (messages.length) throw new ProcurementError(messages[0], 400, fields)
  return { ...input, fromWhom: supplier!.name, warehouse: warehouse!.name, branch, organization, currency: currency!.code, paymentType: returnPaymentType(input.paymentType), date: day.ok ? day.date : "", items }
}

function amountOf(input: SupplierReturnInput) {
  return Math.round(input.items.reduce((sum, item) => sum + item.qty * item.price, 0) * 1e6) / 1e6
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export async function listSupplierReturns(): Promise<SupplierReturn[]> {
  const db = await returnsDb()
  return withSeriesNames(db, ((await db.prepare("SELECT * FROM supplier_returns ORDER BY id DESC").all()) as Row[]).map(rowToReturn))
}

export async function getSupplierReturn(id: number, executor?: PgDb): Promise<SupplierReturn | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const db = executor ?? (await returnsDb())
  const row = (await db.prepare("SELECT * FROM supplier_returns WHERE id = ?").get(id)) as Row | undefined
  return row ? (await withSeriesNames(db, [rowToReturn(row)]))[0] : null
}

async function lockReturn(tx: PgDb, id: number): Promise<SupplierReturn | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const row = (await tx.prepare("SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
  return row ? rowToReturn(row) : null
}

/** Throws a 400 ProcurementError for unknown references / bad lines. */
export async function createSupplierReturn(draft: SupplierReturnInput, userName: string): Promise<SupplierReturn> {
  await returnsDb()
  // The warehouse as the request found it, read again under its lock below (rename race).
  const seen = await findWarehouse(getDb(), draft.warehouse)
  return withTransaction(async (tx) => {
    // The warehouse's stock lock (as the rename takes it): a rename that committed since `seen`
    // resolves to the new name, one still to come waits for this return (lockNamedWarehouse).
    const warehouse = await lockNamedWarehouse(tx, draft.warehouse, seen)
    const input = await resolveReturn(tx, { ...draft, warehouse }, await catalogIndex(tx))
    const result = await tx
      .prepare(
        `INSERT INTO supplier_returns (
          from_whom, warehouse, added_by, date, time, amount, status, organization, currency,
          payment_type, price_list, branch, transfer_time, reason, items, updated_at
        ) VALUES (
          @fromWhom, @warehouse, @addedBy, @date, @time, @amount, 'в процессе', @organization, @currency,
          @paymentType, @priceList, @branch, '', @reason, @items, datetime('now')
        )`,
      )
      .run({
        fromWhom: input.fromWhom,
        warehouse: input.warehouse,
        addedBy: userName,
        date: input.date,
        time: nowLocalIso().slice(11, 16),
        amount: amountOf(input),
        organization: input.organization,
        currency: input.currency,
        paymentType: input.paymentType,
        priceList: input.priceList,
        branch: input.branch,
        reason: input.comment,
        items: JSON.stringify(input.items),
      })
    return (await getSupplierReturn(Number(result.lastInsertRowid), tx))!
  })
}

export type ReturnChange = SupplierReturn | "not_found" | "locked"

/** What an edit of a completed return may not do: leave less in its warehouse than there is (any day from its
 * booking day on). `before` / `after`: the warehouse's stock before and after the edit; an item that was short
 * already is refused only when the edit takes even more of it. */
function editShortages(lines: ReturnItem[], index: CatalogIndex, before: Map<string, { available: number }>, after: Map<string, { available: number }>): StockShortage[] {
  const need = new Map<string, { product: string; required: number }>()
  for (const line of lines) {
    const key = ledgerKey(index, line.product, line.key)
    const entry = need.get(key) ?? { product: line.product, required: 0 }
    entry.required += Number(line.qty) || 0
    need.set(key, entry)
  }
  const shortages: StockShortage[] = []
  for (const [key, entry] of need) {
    const now = after.get(key)?.available ?? 0
    const was = before.get(key)?.available ?? 0
    if (now >= -1e-9 || now >= was - 1e-9) continue
    shortages.push({ key, product: entry.product, unit: index.byKey.get(key)?.unit ?? "", required: round6(entry.required), available: round6(Math.max(0, now + entry.required)) })
  }
  return shortages
}

/** The day the stock ledger books a completed return on: the earlier of its date and its hand-over (lib/stock/sources.ts). */
function bookingDay(date: string, transferTime: string): string | undefined {
  return [parseAnyDay(date), parseAnyDay(transferTime)].filter((day): day is string => Boolean(day)).sort()[0]
}

/** The quantities a return's lines move, by stock ledger key. */
function movedByKey(index: CatalogIndex, lines: ReturnItem[]): Map<string, number> {
  const moved = new Map<string, number>()
  for (const line of lines) {
    const key = ledgerKey(index, line.product, line.key)
    if (key && key !== "name:") moved.set(key, (moved.get(key) ?? 0) + (Number(line.qty) || 0))
  }
  return moved
}

const COUNTED = { edit: "Изменение невозможно из-за связи с другими данными", cancel: "Отменение невозможно из-за связи с другими данными" }

/** A completed return took its goods out of its warehouse on its booking day. Changing what left, where or when
 * (an edit) or bringing it all back (a cancel) is refused once a confirmed inventory has counted those items since,
 * as the supply and the transfer edits do: the stock would no longer match that count. Counts confirmed before the
 * hand-over never saw the return and do not matter. `next` = the edited return (none for a cancel). */
async function assertNotCounted(tx: PgDb, current: SupplierReturn, index: CatalogIndex, next?: SupplierReturnInput): Promise<void> {
  const oldDay = bookingDay(current.date, current.transferTime)
  if (!oldDay) return
  const moment = parseAnyDate(current.transferTime) ?? `${oldDay}T00:00:00`
  const options = { registeredAt: moment }
  const refuse = () => new ProcurementError(next ? COUNTED.edit : COUNTED.cancel, 409, undefined, { reason: "inventory" })
  if (!next) {
    if (await countedByInventory(tx, current.warehouse, oldDay, moment, documentKeys(index, current.items), options)) throw refuse()
    return
  }
  const newDay = bookingDay(next.date, current.transferTime) ?? oldDay
  if (textKey(current.warehouse) === textKey(next.warehouse) && newDay === oldDay) {
    // Same place and day: only the items whose quantity changes.
    const before = movedByKey(index, current.items)
    const after = movedByKey(index, next.items)
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter((key) => Math.abs((before.get(key) ?? 0) - (after.get(key) ?? 0)) > 1e-9)
    if (changed.length && (await countedByInventory(tx, current.warehouse, oldDay, moment, changed, options))) throw refuse()
    return
  }
  // Moved to another warehouse or day: the old booking goes away and the new one appears.
  if (await countedByInventory(tx, current.warehouse, oldDay, moment, documentKeys(index, current.items), options)) throw refuse()
  const newMoment = newDay === oldDay ? moment : `${newDay}T00:00:00`
  if (await countedByInventory(tx, next.warehouse, newDay, newMoment, documentKeys(index, next.items), options)) throw refuse()
}

/** Every return can be edited, except one from Linko's old base ("locked"). A completed return books its new lines
 * right away (the stock ledger reads the row), so its warehouses are locked and the new lines must fit the stock. */
export async function updateSupplierReturn(id: number, draft: SupplierReturnInput): Promise<ReturnChange> {
  await returnsDb()
  const seen = await findWarehouse(getDb(), draft.warehouse)
  // The stored warehouse as read before the transaction (read again under its lock below).
  const stored = (await getDb().prepare("SELECT warehouse FROM supplier_returns WHERE id = ?").get(id)) as { warehouse: string } | undefined
  const storedRef = stored ? await findWarehouse(getDb(), stored.warehouse) : null
  return withTransaction(async (tx) => {
    // Lock order (C1): the stock locks (the new and the stored warehouse, sorted) before the row lock.
    const [locked] = await lockDocumentWarehouses(tx, [seen ?? { name: draft.warehouse }, ...(stored ? [storedRef ?? { name: stored.warehouse }] : [])])
    const warehouse = locked ? locked.name : draft.warehouse
    const current = await lockReturn(tx, id)
    if (!current) return "not_found"
    if (current.fromOldBase) return "locked"
    // A warehouse renamed or changed meanwhile: its lock too (re-entrant for the ones already held).
    await lockWarehouseStock(tx, [current.warehouse])
    const index = await catalogIndex(tx)
    const input = await resolveReturn(tx, { ...draft, warehouse }, index, current.date)
    const completed = current.status === "завершен"
    if (completed) await assertNotCounted(tx, current, index, input)
    // The stock check starts at the earlier of the old and the new booking day.
    const days = [parseAnyDay(current.date), parseAnyDay(input.date)].filter((day): day is string => Boolean(day)).sort()
    const before = completed ? await warehouseStock(input.warehouse, days[0], tx) : null
    let rate: number | null | undefined
    if (completed && textKey(input.currency) !== textKey(current.currency)) rate = (await findCurrency(tx, input.currency))?.rate ?? null
    await tx
      .prepare(
        `UPDATE supplier_returns SET
           from_whom = @fromWhom, warehouse = @warehouse, date = @date, amount = @amount,
           organization = @organization, currency = @currency, payment_type = @paymentType,
           price_list = @priceList, branch = @branch, reason = @reason, items = @items,
           ${rate !== undefined ? "rate_to_base = @rate," : ""}
           updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        fromWhom: input.fromWhom,
        warehouse: input.warehouse,
        date: input.date,
        amount: amountOf(input),
        organization: input.organization,
        currency: input.currency,
        paymentType: input.paymentType,
        priceList: input.priceList,
        branch: input.branch,
        reason: input.comment,
        items: JSON.stringify(input.items),
        ...(rate !== undefined ? { rate } : {}),
      })
    if (before) {
      const after = await warehouseStock(input.warehouse, days[0], tx)
      const shortages = editShortages(input.items, index, before, after)
      if (shortages.length) throw new ProcurementError(shortageMessage(input.warehouse, shortages), 409, undefined, { shortages })
    }
    return (await getSupplierReturn(id, tx))!
  })
}

/** Hard delete of a return that never left the warehouse. Locked (FOR UPDATE) so a
 * concurrent hand-over either wins (→ "locked") or waits for the delete. */
export async function deleteSupplierReturn(id: number): Promise<"ok" | "not_found" | "locked"> {
  await returnsDb()
  return withTransaction(async (tx) => {
    const current = await lockReturn(tx, id)
    if (!current) return "not_found"
    if (current.status === "завершен") return "locked"
    await tx.prepare("DELETE FROM supplier_returns WHERE id = ?").run(id)
    return "ok"
  })
}

/** Lines a hand-over may book: catalog items, qty > 0, price ≥ 0 (legacy rows included). */
function assertGivable(current: SupplierReturn, index: CatalogIndex) {
  const fields: Record<string, string> = {}
  if (!current.items.length) fields.items = "Добавьте товары"
  current.items.forEach((item, position) => {
    const qty = Number(item.qty)
    const price = Number(item.price)
    if (!(Number.isFinite(qty) && qty > 0 && qty <= MAX_QTY)) fields[`items.${position}.qty`] = "Количество должно быть больше 0"
    if (!(Number.isFinite(price) && price >= 0 && price <= MAX_MONEY)) fields[`items.${position}.price`] = "Цена не может быть отрицательной"
    if (!resolveLine(index, { product: item.product }).item) fields[`items.${position}.product`] = "Товар не найден в каталоге"
  })
  const messages = Object.values(fields)
  if (messages.length) throw new ProcurementError(messages[0], 409, fields)
}

/** "Принять" (give) hands the goods over (they leave the warehouse; 409 while it does not
 * hold them on every day from the return's date on), on `date` (YYYY-MM-DD, Linko's «Дата»
 * of the confirmation) or now; "Отменить" cancels a return that is in progress or undoes a
 * completed one. */
export async function changeSupplierReturnStatus(id: number, action: "give" | "cancel", userName: string, date?: string): Promise<ReturnChange> {
  await returnsDb()
  return withTransaction(async (tx) => {
    // Lock order (C1): a hand-over, and the cancel of a completed return, move stock — the warehouse's stock lock
    // before the row lock.
    await lockWarehousesOf(tx, "SELECT warehouse FROM supplier_returns WHERE id = @id", { id })
    const current = await lockReturn(tx, id)
    if (!current) return "not_found"
    const stamp = date && action === "give" ? `${ruDay(date)}, ${nowLocalIso().slice(11, 16)}` : ruStamp()
    if (action === "give") {
      if (current.status !== "в процессе") return "locked"
      await lockWarehouseStock(tx, [current.warehouse])
      const index = await catalogIndex(tx)
      assertGivable(current, index)
      if (!(await findSupplier(tx, current.fromWhom))) throw new ProcurementError("Поставщик не найден", 409, { fromWhom: "Поставщик не найден" })
      // The stock core books the hand-over on the return's date (never after the hand-over
      // itself), so the goods must be there from that day on — every later day included.
      const stock = await warehouseStock(current.warehouse, [parseAnyDay(current.date), date].filter((day): day is string => Boolean(day)).sort()[0], tx)
      const shortages = findShortages(
        current.items.map((item) => ({ product: item.product, quantity: Number(item.qty) || 0, key: item.key })),
        index,
        stock,
      )
      if (shortages.length) throw new ProcurementError(shortageMessage(current.warehouse, shortages), 409, undefined, { shortages })
      const currency = await findCurrency(tx, current.currency)
      await tx
        .prepare("UPDATE supplier_returns SET status = 'завершен', transfer_time = @stamp, transferred_by = @by, rate_to_base = @rate, updated_at = datetime('now') WHERE id = @id")
        .run({ id, stamp, by: userName, rate: currency?.rate ?? null })
    } else {
      if (current.status === "отменен") return "locked"
      if (current.status === "завершен") await assertNotCounted(tx, current, await catalogIndex(tx))
      await tx
        .prepare("UPDATE supplier_returns SET status = 'отменен', cancelled_at = @stamp, cancelled_by = @by, rate_to_base = NULL, updated_at = datetime('now') WHERE id = @id")
        .run({ id, stamp, by: userName })
    }
    return (await getSupplierReturn(id, tx))!
  })
}
