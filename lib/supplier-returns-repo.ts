import "server-only"

import { z } from "zod"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { ReturnItem, SupplierReturn } from "@/components/analytics/supplier-returns-data"
import { nowLocalIso, parseAnyDay } from "@/lib/finance/dates"
import { catalogIndex, findShortages, lockWarehouseStock, resolveLine, shortageMessage, warehouseStock, type CatalogIndex } from "@/lib/internal-transfers-stock"
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
// Every reference must exist (supplier, warehouse, branch, organization,
// currency, catalog products) and lines must have qty > 0, price ≥ 0; a hand-over
// is refused while the warehouse does not hold the goods. On hand-over the
// currency rate is kept in rate_to_base (contract 2).

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
}

declare global {
  // V2: + rate_to_base, amount DOUBLE PRECISION.
  var __linkoReturnsSchemaReadyV2: Promise<void> | undefined
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
  if (!globalThis.__linkoReturnsSchemaReadyV2) {
    globalThis.__linkoReturnsSchemaReadyV2 = installSchema().catch((error) => {
      globalThis.__linkoReturnsSchemaReadyV2 = undefined
      throw error
    })
  }
  await globalThis.__linkoReturnsSchemaReadyV2
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

function rowToReturn(row: Row): SupplierReturn {
  return {
    id: row.id,
    fromWhom: row.from_whom,
    warehouse: row.warehouse,
    addedBy: row.added_by,
    date: row.date,
    time: row.time,
    amount: Number(row.amount) || 0,
    status: row.status as SupplierReturn["status"],
    organization: row.organization,
    currency: row.currency,
    paymentType: row.payment_type,
    priceList: row.price_list,
    branch: row.branch,
    transferTime: row.transfer_time,
    transferredBy: row.transferred_by,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    reason: row.reason,
    items: parseItems(row.items),
  }
}

const RU_MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]

/** "19 октября 2026" of a YYYY-MM-DD day (the format the page shows). */
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
    /** Any parseable date (default today). */
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
        price: item.price,
        total: Math.round(item.qty * item.price * 1e6) / 1e6,
      }
    }),
  }
}

/** Canonical references; a 400 ProcurementError with every field error otherwise. */
async function resolveReturn(tx: PgDb, input: SupplierReturnInput, index: CatalogIndex): Promise<SupplierReturnInput> {
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
  let date = input.date
  if (!date) date = ruDay(nowLocalIso().slice(0, 10))
  else if (!parseAnyDay(date)) fields.date = "Неверная дата"
  const items = input.items.map((item, position) => {
    const line = resolveLine(index, { key: item.key, product: item.product })
    if (!line.item) fields[`items.${position}.product`] = "Товар не найден в каталоге"
    const rest = { ...item }
    delete rest.key
    return { ...rest, product: line.item ? line.item.name : item.product }
  })
  const messages = Object.values(fields)
  if (messages.length) throw new ProcurementError(messages[0], 400, fields)
  return { ...input, fromWhom: supplier!.name, warehouse: warehouse!.name, branch, organization, currency: currency!.code, date, items }
}

function amountOf(input: SupplierReturnInput) {
  return Math.round(input.items.reduce((sum, item) => sum + item.qty * item.price, 0) * 1e6) / 1e6
}

// ---------------------------------------------------------------------------
// Reads / writes
// ---------------------------------------------------------------------------

export async function listSupplierReturns(): Promise<SupplierReturn[]> {
  const db = await returnsDb()
  return ((await db.prepare("SELECT * FROM supplier_returns ORDER BY id DESC").all()) as Row[]).map(rowToReturn)
}

export async function getSupplierReturn(id: number, executor?: PgDb): Promise<SupplierReturn | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const db = executor ?? (await returnsDb())
  const row = (await db.prepare("SELECT * FROM supplier_returns WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToReturn(row) : null
}

async function lockReturn(tx: PgDb, id: number): Promise<SupplierReturn | null> {
  if (!Number.isInteger(id) || id <= 0 || id > 2_147_483_647) return null
  const row = (await tx.prepare("SELECT * FROM supplier_returns WHERE id = ? FOR UPDATE").get(id)) as Row | undefined
  return row ? rowToReturn(row) : null
}

/** Throws a 400 ProcurementError for unknown references / bad lines. */
export async function createSupplierReturn(draft: SupplierReturnInput, userName: string): Promise<SupplierReturn> {
  await returnsDb()
  return withTransaction(async (tx) => {
    await lockWarehouseStock(tx, [draft.warehouse])
    const input = await resolveReturn(tx, draft, await catalogIndex(tx))
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

/** Only a return that hasn't been handed over yet can be edited. */
export async function updateSupplierReturn(id: number, draft: SupplierReturnInput): Promise<ReturnChange> {
  await returnsDb()
  return withTransaction(async (tx) => {
    const current = await lockReturn(tx, id)
    if (!current) return "not_found"
    if (current.status !== "в процессе") return "locked"
    await lockWarehouseStock(tx, [draft.warehouse])
    const input = await resolveReturn(tx, draft, await catalogIndex(tx))
    await tx
      .prepare(
        `UPDATE supplier_returns SET
           from_whom = @fromWhom, warehouse = @warehouse, date = @date, amount = @amount,
           organization = @organization, currency = @currency, payment_type = @paymentType,
           price_list = @priceList, branch = @branch, reason = @reason, items = @items,
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
      })
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

/** "Передать" hands the goods over (they leave the warehouse; 409 while it does not
 * hold them); "Отменить" cancels a return that is in progress or undoes a completed one. */
export async function changeSupplierReturnStatus(id: number, action: "give" | "cancel", userName: string): Promise<ReturnChange> {
  await returnsDb()
  return withTransaction(async (tx) => {
    const current = await lockReturn(tx, id)
    if (!current) return "not_found"
    const stamp = ruStamp()
    if (action === "give") {
      if (current.status !== "в процессе") return "locked"
      await lockWarehouseStock(tx, [current.warehouse])
      const index = await catalogIndex(tx)
      assertGivable(current, index)
      if (!(await findSupplier(tx, current.fromWhom))) throw new ProcurementError("Поставщик не найден", 409, { fromWhom: "Поставщик не найден" })
      const stock = await warehouseStock(current.warehouse, undefined, tx)
      const shortages = findShortages(
        current.items.map((item) => ({ product: item.product, quantity: Number(item.qty) || 0 })),
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
      await tx
        .prepare("UPDATE supplier_returns SET status = 'отменен', cancelled_at = @stamp, cancelled_by = @by, rate_to_base = NULL, updated_at = datetime('now') WHERE id = @id")
        .run({ id, stamp, by: userName })
    }
    return (await getSupplierReturn(id, tx))!
  })
}
