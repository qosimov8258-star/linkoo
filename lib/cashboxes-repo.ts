import "server-only"

import { getDb } from "@/lib/db"
import type { Cashbox } from "@/components/analytics/cashboxes-data"

type CashboxRow = {
  id: number
  name: string
  currency: string
  cashier: string
  branch: string
  payment_type: string
  vansell: number
  order_number: number
}

function rowToCashbox(row: CashboxRow): Cashbox {
  return {
    id: row.id,
    name: row.name,
    currency: row.currency,
    cashier: row.cashier,
    branch: row.branch,
    paymentType: row.payment_type,
    vansell: row.vansell === 1,
    orderNumber: row.order_number,
  }
}

export type CashboxInput = Omit<Cashbox, "id">

export function parseCashboxInput(body: unknown): CashboxInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const name = typeof value.name === "string" ? value.name.trim() : ""
  const currency = typeof value.currency === "string" ? value.currency.trim() : ""
  const cashier = typeof value.cashier === "string" ? value.cashier.trim() : ""
  const paymentType = typeof value.paymentType === "string" ? value.paymentType.trim() : ""
  const orderNumberRaw = typeof value.orderNumber === "number" ? value.orderNumber : Number(value.orderNumber)
  if (!name || !currency || !cashier || !paymentType || !Number.isFinite(orderNumberRaw)) return null

  return {
    name,
    currency,
    cashier,
    branch: typeof value.branch === "string" ? value.branch.trim() : "",
    paymentType,
    vansell: value.vansell === true,
    orderNumber: orderNumberRaw,
  }
}

export async function listCashboxes(search?: string): Promise<Cashbox[]> {
  const db = getDb()
  const rows = search
    ? ((await db.prepare("SELECT * FROM cashboxes WHERE name LIKE ? ORDER BY id DESC").all(`%${search}%`)) as CashboxRow[])
    : ((await db.prepare("SELECT * FROM cashboxes ORDER BY id DESC").all()) as CashboxRow[])
  return rows.map(rowToCashbox)
}

export async function getCashbox(id: number): Promise<Cashbox | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM cashboxes WHERE id = ?").get(id)) as CashboxRow | undefined
  return row ? rowToCashbox(row) : null
}

export async function createCashbox(input: CashboxInput): Promise<Cashbox> {
  const db = getDb()
  const result = (await db
      .prepare(
        `INSERT INTO cashboxes (name, currency, cashier, branch, payment_type, vansell, order_number)
       VALUES (@name, @currency, @cashier, @branch, @paymentType, @vansell, @orderNumber)`,
      )
      .run({
        name: input.name,
        currency: input.currency,
        cashier: input.cashier,
        branch: input.branch,
        paymentType: input.paymentType,
        vansell: input.vansell ? 1 : 0,
        orderNumber: input.orderNumber,
      }))
  return (await getCashbox(Number(result.lastInsertRowid)))!
}

export async function updateCashbox(id: number, input: CashboxInput): Promise<Cashbox | null> {
  const existing = (await getCashbox(id))
  if (!existing) return null

  const db = getDb()
  await db.prepare(
        `UPDATE cashboxes SET name = @name, currency = @currency, cashier = @cashier, branch = @branch,
       payment_type = @paymentType, vansell = @vansell, order_number = @orderNumber, updated_at = datetime('now')
     WHERE id = @id`,
      ).run({
        id,
        name: input.name,
        currency: input.currency,
        cashier: input.cashier,
        branch: input.branch,
        paymentType: input.paymentType,
        vansell: input.vansell ? 1 : 0,
        orderNumber: input.orderNumber,
      })
  return (await getCashbox(id))
}

export async function deleteCashbox(id: number): Promise<boolean> {
  const db = getDb()
  const result = (await db.prepare("DELETE FROM cashboxes WHERE id = ?").run(id))
  return result.changes > 0
}
