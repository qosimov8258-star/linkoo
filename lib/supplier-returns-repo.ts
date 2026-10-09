import "server-only"

import { getDb, withTransaction, type PgDb } from "@/lib/db"
import type { ReturnItem, SupplierReturn } from "@/components/analytics/supplier-returns-data"

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
  var __linkoReturnsSchemaReady: Promise<void> | undefined
}

async function returnsDb(): Promise<PgDb> {
  const db = getDb()
  if (!globalThis.__linkoReturnsSchemaReady) {
    globalThis.__linkoReturnsSchemaReady = db
      .exec(`
        ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS transferred_by TEXT NOT NULL DEFAULT '';
        ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS cancelled_at TEXT NOT NULL DEFAULT '';
        ALTER TABLE supplier_returns ADD COLUMN IF NOT EXISTS cancelled_by TEXT NOT NULL DEFAULT '';
      `)
      .catch((error) => {
        globalThis.__linkoReturnsSchemaReady = undefined
        throw error
      })
  }
  await globalThis.__linkoReturnsSchemaReady
  return db
}

function rowToReturn(row: Row): SupplierReturn {
  return {
    id: row.id,
    fromWhom: row.from_whom,
    warehouse: row.warehouse,
    addedBy: row.added_by,
    date: row.date,
    time: row.time,
    amount: row.amount,
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
    items: JSON.parse(row.items) as ReturnItem[],
  }
}

function formatToday() {
  const date = new Date()
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).replace(" г.", "")
}

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
  items: ReturnItem[]
}

export function parseSupplierReturnInput(body: unknown): SupplierReturnInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const fromWhom = typeof value.fromWhom === "string" ? value.fromWhom.trim() : ""
  const warehouse = typeof value.warehouse === "string" ? value.warehouse.trim() : ""
  const items = Array.isArray(value.items) ? (value.items as ReturnItem[]) : []
  if (!fromWhom || !warehouse || items.length === 0) return null
  return {
    fromWhom,
    warehouse,
    organization: typeof value.organization === "string" ? value.organization : "",
    branch: typeof value.branch === "string" ? value.branch : "",
    currency: typeof value.currency === "string" && value.currency ? value.currency : "SUM",
    priceList: typeof value.priceList === "string" ? value.priceList : "",
    paymentType: typeof value.paymentType === "string" ? value.paymentType : "",
    date: typeof value.date === "string" && value.date ? value.date : formatToday(),
    comment: typeof value.comment === "string" ? value.comment : "",
    items: items.map((item, index) => ({
      id: Number(item.id) || index + 1,
      product: String(item.product ?? ""),
      qty: Number(item.qty) || 0,
      series: String(item.series ?? ""),
      price: Number(item.price) || 0,
      total: (Number(item.qty) || 0) * (Number(item.price) || 0),
    })),
  }
}

function amountOf(input: SupplierReturnInput) {
  return input.items.reduce((sum, item) => sum + item.qty * item.price, 0)
}

export async function listSupplierReturns(): Promise<SupplierReturn[]> {
  const db = await returnsDb()
  return ((await db.prepare("SELECT * FROM supplier_returns ORDER BY id DESC").all()) as Row[]).map(rowToReturn)
}

export async function getSupplierReturn(id: number, executor?: PgDb): Promise<SupplierReturn | null> {
  const db = executor ?? (await returnsDb())
  const row = (await db.prepare("SELECT * FROM supplier_returns WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToReturn(row) : null
}

export async function createSupplierReturn(input: SupplierReturnInput, userName: string): Promise<SupplierReturn> {
  const db = await returnsDb()
  const time = new Date().toTimeString().slice(0, 5)
  const result = (await db
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
        time,
        amount: amountOf(input),
        organization: input.organization,
        currency: input.currency,
        paymentType: input.paymentType,
        priceList: input.priceList,
        branch: input.branch,
        reason: input.comment,
        items: JSON.stringify(input.items),
      }))
  return (await getSupplierReturn(Number(result.lastInsertRowid)))!
}

export type ReturnChange = SupplierReturn | "not_found" | "locked"

/** Only a return that hasn't been handed over yet can be edited. */
export async function updateSupplierReturn(id: number, input: SupplierReturnInput): Promise<ReturnChange> {
  const db = await returnsDb()
  const current = await getSupplierReturn(id, db)
  if (!current) return "not_found"
  if (current.status !== "в процессе") return "locked"
  await db.prepare(
        `UPDATE supplier_returns SET
       from_whom = @fromWhom, warehouse = @warehouse, date = @date, amount = @amount,
       organization = @organization, currency = @currency, payment_type = @paymentType,
       price_list = @priceList, branch = @branch, reason = @reason, items = @items,
       updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
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
  return (await getSupplierReturn(id, db))!
}

export async function deleteSupplierReturn(id: number): Promise<"ok" | "not_found" | "locked"> {
  const db = await returnsDb()
  const current = await getSupplierReturn(id, db)
  if (!current) return "not_found"
  if (current.status === "завершен") return "locked"
  await db.prepare("DELETE FROM supplier_returns WHERE id = ?").run(id)
  return "ok"
}

/** "Передать" hands the goods over (they leave the warehouse); "Отменить"
 * cancels a return that is in progress or undoes a completed one. */
export async function changeSupplierReturnStatus(id: number, action: "give" | "cancel", userName: string): Promise<ReturnChange> {
  await returnsDb()
  return withTransaction(async (db) => {
    const locked = (await db.prepare("SELECT id FROM supplier_returns WHERE id = ? FOR UPDATE").get(id)) as { id: number } | undefined
    if (!locked) return "not_found"
    const current = (await getSupplierReturn(id, db))!
    const now = new Date()
    const stamp = `${now.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" }).replace(" г.", "")}, ${now.toTimeString().slice(0, 5)}`
    if (action === "give") {
      if (current.status !== "в процессе") return "locked"
      await db
        .prepare("UPDATE supplier_returns SET status = 'завершен', transfer_time = ?, transferred_by = ?, updated_at = datetime('now') WHERE id = ?")
        .run(stamp, userName, id)
    } else {
      if (current.status === "отменен") return "locked"
      await db
        .prepare("UPDATE supplier_returns SET status = 'отменен', cancelled_at = ?, cancelled_by = ?, updated_at = datetime('now') WHERE id = ?")
        .run(stamp, userName, id)
    }
    return (await getSupplierReturn(id, db))!
  })
}
