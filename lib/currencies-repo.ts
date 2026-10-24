import "server-only"

import { getDb, withTransaction } from "@/lib/db"
import { ensureRatesSchema } from "@/lib/currency-rates-repo"
import type { Currency } from "@/components/analytics/currencies-data"

type CurrencyRow = {
  id: number
  name: string
  code: string
  rate: number
  is_base: number
  created_at: string
  updated_at: string
  rate_date: string | null
}

function rowToCurrency(row: CurrencyRow): Currency {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    rate: row.rate,
    isBase: row.is_base === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
    rateDate: row.rate_date ?? row.updated_at,
  }
}

const SELECT = "SELECT c.*, (SELECT MAX(r.created_at) FROM currency_rates r WHERE r.currency_id = c.id) AS rate_date FROM currencies c"

export type CurrencyInput = { name: string; code: string; rate: number; isBase: boolean }

export async function listCurrencies(): Promise<Currency[]> {
  await ensureRatesSchema()
  const db = getDb()
  const rows = (await db.prepare(`${SELECT} ORDER BY lower(c.name), c.id`).all()) as CurrencyRow[]
  return rows.map(rowToCurrency)
}

export async function getCurrency(id: number): Promise<Currency | null> {
  const db = getDb()
  await ensureRatesSchema()
  const row = (await db.prepare(`${SELECT} WHERE c.id = ?`).get(id)) as CurrencyRow | undefined
  return row ? rowToCurrency(row) : null
}

export async function createCurrency(input: CurrencyInput): Promise<Currency> {
  const rate = input.isBase ? 1 : input.rate

  const result = await withTransaction(async (db) => {
    if (input.isBase) {
      await db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1").run()
    }
    return db
      .prepare("INSERT INTO currencies (name, code, rate, is_base) VALUES (?, ?, ?, ?)")
      .run(input.name, input.code, rate, input.isBase ? 1 : 0)
  })

  return (await getCurrency(Number(result.lastInsertRowid)))!
}

export type UpdateResult = { ok: true; currency: Currency } | { ok: false; error: "not_found" }

export async function updateCurrency(id: number, input: CurrencyInput): Promise<UpdateResult> {
  const existing = (await getCurrency(id))
  if (!existing) return { ok: false, error: "not_found" }

  const rate = input.isBase ? 1 : input.rate

  await withTransaction(async (db) => {
    if (input.isBase) {
      await db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1 AND id != ?").run(id)
    }
    await db.prepare("UPDATE currencies SET name = ?, code = ?, rate = ?, is_base = ?, updated_at = datetime('now') WHERE id = ?").run(
      input.name,
      input.code,
      rate,
      input.isBase ? 1 : 0,
      id,
    )
  })

  return { ok: true, currency: (await getCurrency(id))! }
}

export type DeleteResult = "deleted" | "not_found" | "is_base"

export async function deleteCurrency(id: number): Promise<DeleteResult> {
  const db = getDb()
  const existing = (await getCurrency(id))
  if (!existing) return "not_found"
  if (existing.isBase) return "is_base"
  await db.prepare("DELETE FROM currencies WHERE id = ?").run(id)
  return "deleted"
}
