import "server-only"

import { getDb } from "@/lib/db"
import type { Repricing } from "@/components/analytics/repricing-data"

type Row = {
  id: number
  created_by: string
  created_at_label: string
  price_list_id: number | null
  price_list_name: string | null
  product_id: number | null
  product_name: string | null
  amount: number
  currency: Repricing["currency"]
  status: Repricing["status"]
  user: string
}

const SELECT = `
  SELECT r.id, r.created_by, r.created_at_label, r.price_list_id, pl.name AS price_list_name,
         r.product_id, p.name AS product_name, r.amount, r.currency, r.status, r.user
  FROM repricings r
  LEFT JOIN price_lists pl ON pl.id = r.price_list_id
  LEFT JOIN products p ON p.id = r.product_id
`

function rowToRepricing(row: Row): Repricing {
  return {
    id: row.id,
    createdBy: row.created_by,
    createdAt: row.created_at_label,
    priceListId: row.price_list_id,
    priceList: row.price_list_name ?? "Не указано",
    productId: row.product_id,
    product: row.product_name ?? "Не указано",
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    user: row.user,
  }
}

export type RepricingInput = {
  priceListId: number | null
  productId: number | null
  amount: number
  currency: Repricing["currency"]
  status: Repricing["status"]
  createdBy: string
  user: string
}

const allowedCurrencies = new Set(["SUM", "USD", "Euro"])
const allowedStatuses = new Set(["проведен", "черновик"])

function monthLabel(date: Date): string {
  const months = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
  return `${String(date.getDate()).padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`
}

export function parseRepricingInput(body: unknown, fallbackUser: string): RepricingInput | null {
  if (!body || typeof body !== "object") return null
  const value = body as Record<string, unknown>

  const priceListId = typeof value.priceListId === "number" && Number.isFinite(value.priceListId) ? value.priceListId : null
  const productId = typeof value.productId === "number" && Number.isFinite(value.productId) ? value.productId : null
  const amount = typeof value.amount === "number" && Number.isFinite(value.amount) ? value.amount : 0
  if (priceListId === null || productId === null) return null

  const currency = typeof value.currency === "string" && allowedCurrencies.has(value.currency) ? (value.currency as Repricing["currency"]) : "SUM"
  const status = typeof value.status === "string" && allowedStatuses.has(value.status) ? (value.status as Repricing["status"]) : "проведен"
  const user = typeof value.user === "string" && value.user.trim() ? value.user.trim() : fallbackUser

  return { priceListId, productId, amount, currency, status, createdBy: fallbackUser, user }
}

export function listRepricings(): Repricing[] {
  const db = getDb()
  const rows = db.prepare(`${SELECT} ORDER BY r.id DESC`).all() as Row[]
  return rows.map(rowToRepricing)
}

export function getRepricing(id: number): Repricing | null {
  const db = getDb()
  const row = db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined
  return row ? rowToRepricing(row) : null
}

export function createRepricing(input: RepricingInput): Repricing {
  const db = getDb()
  const result = db
    .prepare(
      `INSERT INTO repricings (created_by, created_at_label, price_list_id, product_id, amount, currency, status, user)
       VALUES (@createdBy, @createdAtLabel, @priceListId, @productId, @amount, @currency, @status, @user)`,
    )
    .run({
      createdBy: input.createdBy,
      createdAtLabel: monthLabel(new Date()),
      priceListId: input.priceListId,
      productId: input.productId,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      user: input.user,
    })
  return getRepricing(Number(result.lastInsertRowid))!
}

export function updateRepricing(id: number, input: RepricingInput): Repricing | null {
  if (!getRepricing(id)) return null
  const db = getDb()
  db.prepare(
    `UPDATE repricings SET price_list_id = @priceListId, product_id = @productId, amount = @amount,
       currency = @currency, status = @status, user = @user, updated_at = datetime('now')
     WHERE id = @id`,
  ).run({ id, priceListId: input.priceListId, productId: input.productId, amount: input.amount, currency: input.currency, status: input.status, user: input.user })
  return getRepricing(id)
}

export function deleteRepricing(id: number): boolean {
  const db = getDb()
  const result = db.prepare("DELETE FROM repricings WHERE id = ?").run(id)
  return result.changes > 0
}
