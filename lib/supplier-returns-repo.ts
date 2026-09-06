import "server-only"

import { getDb } from "@/lib/db"
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
  reason: string
  items: string
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
    reason: row.reason,
    items: JSON.parse(row.items) as ReturnItem[],
  }
}

function formatToday() {
  const date = new Date()
  return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "long", year: "numeric" })
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
  const db = getDb()
  return ((await db.prepare("SELECT * FROM supplier_returns ORDER BY id DESC").all()) as Row[]).map(rowToReturn)
}

export async function getSupplierReturn(id: number): Promise<SupplierReturn | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM supplier_returns WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToReturn(row) : null
}

export async function createSupplierReturn(input: SupplierReturnInput): Promise<SupplierReturn> {
  const db = getDb()
  const time = new Date().toTimeString().slice(0, 5)
  const result = (await db
      .prepare(
        `INSERT INTO supplier_returns (
        from_whom, warehouse, added_by, date, time, amount, status, organization, currency,
        payment_type, price_list, branch, transfer_time, reason, items, updated_at
      ) VALUES (
        @fromWhom, @warehouse, 'Admin Ritm', @date, @time, @amount, 'в процессе', @organization, @currency,
        @paymentType, @priceList, @branch, @transferTime, @reason, @items, datetime('now')
      )`,
      )
      .run({
        fromWhom: input.fromWhom,
        warehouse: input.warehouse,
        date: input.date,
        time,
        amount: amountOf(input),
        organization: input.organization,
        currency: input.currency,
        paymentType: input.paymentType,
        priceList: input.priceList,
        branch: input.branch,
        transferTime: `${input.date}, ${time}`,
        reason: input.comment,
        items: JSON.stringify(input.items),
      }))
  return (await getSupplierReturn(Number(result.lastInsertRowid)))!
}

export async function updateSupplierReturn(id: number, input: SupplierReturnInput): Promise<SupplierReturn | null> {
  const db = getDb()
  if (!(await getSupplierReturn(id))) return null
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
  return (await getSupplierReturn(id))
}

export async function deleteSupplierReturn(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM supplier_returns WHERE id = ?").run(id)).changes > 0
}
