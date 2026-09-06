import "server-only"

import { getDb } from "@/lib/db"
import type { Incoming, IncomingItem } from "@/components/analytics/supplier-incomings-data"

type Row = {
  id: number
  supplier: string
  warehouse: string
  date: string
  payment_type: string
  contract_number: string
  amount: number
  status: string
  invoice_number: string
  organization: string
  branch: string
  phone: string
  email: string
  initiator: string
  paid: number
  time: string
  comment: string
  items: string
}

function rowToIncoming(row: Row): Incoming {
  return {
    id: row.id,
    supplier: row.supplier,
    warehouse: row.warehouse,
    date: row.date,
    paymentType: row.payment_type as Incoming["paymentType"],
    contractNumber: row.contract_number,
    amount: row.amount,
    status: row.status as Incoming["status"],
    invoiceNumber: row.invoice_number,
    organization: row.organization,
    branch: row.branch,
    phone: row.phone,
    email: row.email,
    initiator: row.initiator,
    paid: row.paid,
    time: row.time,
    comment: row.comment,
    items: JSON.parse(row.items) as IncomingItem[],
  }
}

const monthNames = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"]
function formatToday() {
  const date = new Date()
  return `${String(date.getDate()).padStart(2, "0")} ${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

export type IncomingInput = {
  supplier: string
  warehouse: string
  branch: string
  organization: string
  paymentType: Incoming["paymentType"]
  date: string
  contractNumber: string
  invoiceNumber: string
  comment: string
  items: IncomingItem[]
}

export function parseIncomingInput(body: unknown): IncomingInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>
  const supplier = typeof value.supplier === "string" ? value.supplier.trim() : ""
  const warehouse = typeof value.warehouse === "string" ? value.warehouse.trim() : ""
  const items = Array.isArray(value.items) ? (value.items as IncomingItem[]) : []
  if (!supplier || !warehouse || items.length === 0) return null
  const paymentTypeValue = typeof value.paymentType === "string" ? value.paymentType : "Банковский счет"
  return {
    supplier,
    warehouse,
    branch: typeof value.branch === "string" ? value.branch : "",
    organization: typeof value.organization === "string" ? value.organization : "",
    paymentType: (["Банковский счет", "Наличный"].includes(paymentTypeValue) ? paymentTypeValue : "Банковский счет") as Incoming["paymentType"],
    date: typeof value.date === "string" && value.date ? value.date : formatToday(),
    contractNumber: typeof value.contractNumber === "string" ? value.contractNumber : "",
    invoiceNumber: typeof value.invoiceNumber === "string" ? value.invoiceNumber : "",
    comment: typeof value.comment === "string" ? value.comment : "",
    items: items.map((item, index) => ({
      id: Number(item.id) || index + 1,
      product: String(item.product ?? ""),
      expiry: String(item.expiry ?? ""),
      qty: Number(item.qty) || 0,
      block: Number(item.block) || 0,
      kg: Number(item.kg) || 0,
      netWeight: Number(item.netWeight) || 0,
      cost: Number(item.cost) || 0,
      total: (Number(item.qty) || 0) * (Number(item.cost) || 0),
    })),
  }
}

function amountOf(input: IncomingInput) {
  return input.items.reduce((sum, item) => sum + item.qty * item.cost, 0)
}

export async function listIncomings(): Promise<Incoming[]> {
  const db = getDb()
  return ((await db.prepare("SELECT * FROM supplier_incomings ORDER BY id DESC").all()) as Row[]).map(rowToIncoming)
}

export async function getIncoming(id: number): Promise<Incoming | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM supplier_incomings WHERE id = ?").get(id)) as Row | undefined
  return row ? rowToIncoming(row) : null
}

export async function createIncoming(input: IncomingInput): Promise<Incoming> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO supplier_incomings (
        supplier, warehouse, date, payment_type, contract_number, amount, status, invoice_number,
        organization, branch, phone, email, initiator, paid, time, comment, items, updated_at
      ) VALUES (
        @supplier, @warehouse, @date, @paymentType, @contractNumber, @amount, 'ожидает', @invoiceNumber,
        @organization, @branch, 'Не указан', 'Не указан', 'Admin Ritm', 0, @time, @comment, @items, datetime('now')
      )`,
      )
      .run({
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        time: `${input.date}, ${new Date().toTimeString().slice(0, 5)}`,
        comment: input.comment,
        items: JSON.stringify(input.items),
      }))
  return (await getIncoming(Number(result.lastInsertRowid)))!
}

export async function updateIncoming(id: number, input: IncomingInput): Promise<Incoming | null> {
  const db = getDb()
  if (!(await getIncoming(id))) return null
  await db.prepare(
        `UPDATE supplier_incomings SET
       supplier = @supplier, warehouse = @warehouse, date = @date, payment_type = @paymentType,
       contract_number = @contractNumber, amount = @amount, invoice_number = @invoiceNumber,
       organization = @organization, branch = @branch, comment = @comment, items = @items,
       updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        supplier: input.supplier,
        warehouse: input.warehouse,
        date: input.date,
        paymentType: input.paymentType,
        contractNumber: input.contractNumber,
        amount: amountOf(input),
        invoiceNumber: input.invoiceNumber,
        organization: input.organization,
        branch: input.branch,
        comment: input.comment,
        items: JSON.stringify(input.items),
      })
  return (await getIncoming(id))
}

export async function deleteIncoming(id: number): Promise<boolean> {
  const db = getDb()
  return (await db.prepare("DELETE FROM supplier_incomings WHERE id = ?").run(id)).changes > 0
}

export async function cancelIncoming(id: number): Promise<Incoming | null> {
  const db = getDb()
  if (!(await getIncoming(id))) return null
  await db.prepare("UPDATE supplier_incomings SET status = 'отменен', updated_at = datetime('now') WHERE id = ?").run(id)
  return (await getIncoming(id))
}

export async function applyIncomingMarkup(id: number, percent: number): Promise<Incoming | null> {
  const db = getDb()
  const existing = (await getIncoming(id))
  if (!existing) return null
  const items = existing.items.map((item) => {
    const cost = Math.round(item.cost * (1 + percent / 100) * 100) / 100
    return { ...item, cost, total: Math.round(cost * item.qty * 100) / 100 }
  })
  const amount = items.reduce((sum, item) => sum + item.total, 0)
  await db.prepare("UPDATE supplier_incomings SET items = ?, amount = ?, updated_at = datetime('now') WHERE id = ?").run(
        JSON.stringify(items),
        amount,
        id,
      )
  return (await getIncoming(id))
}
