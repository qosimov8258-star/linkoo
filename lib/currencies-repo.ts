import "server-only"

import { getDb } from "@/lib/db"
import type { Currency } from "@/components/analytics/currencies-data"

type CurrencyRow = {
  id: number
  name: string
  code: string
  rate: number
  is_base: number
  created_at: string
}

function rowToCurrency(row: CurrencyRow): Currency {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    rate: row.rate,
    isBase: row.is_base === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type CurrencyInput = { name: string; code: string; rate: number; isBase: boolean }

export function listCurrencies(): Currency[] {
  const db = getDb()
  const rows = db.prepare("SELECT * FROM currencies ORDER BY is_base DESC, id ASC").all() as CurrencyRow[]
  return rows.map(rowToCurrency)
}

export function getCurrency(id: number): Currency | null {
  const db = getDb()
  const row = db.prepare("SELECT * FROM currencies WHERE id = ?").get(id) as CurrencyRow | undefined
  return row ? rowToCurrency(row) : null
}

export function createCurrency(input: CurrencyInput): Currency {
  const db = getDb()
  const rate = input.isBase ? 1 : input.rate

  const insertAndMaybeClearBase = db.transaction(() => {
    if (input.isBase) {
      db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1").run()
    }
    return db
      .prepare("INSERT INTO currencies (name, code, rate, is_base) VALUES (?, ?, ?, ?)")
      .run(input.name, input.code, rate, input.isBase ? 1 : 0)
  })

  const result = insertAndMaybeClearBase()
  return getCurrency(Number(result.lastInsertRowid))!
}

export type UpdateResult = { ok: true; currency: Currency } | { ok: false; error: "not_found" }

export function updateCurrency(id: number, input: CurrencyInput): UpdateResult {
  const db = getDb()
  const existing = getCurrency(id)
  if (!existing) return { ok: false, error: "not_found" }

  const rate = input.isBase ? 1 : input.rate

  db.transaction(() => {
    if (input.isBase) {
      db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1 AND id != ?").run(id)
    }
    db.prepare("UPDATE currencies SET name = ?, code = ?, rate = ?, is_base = ?, updated_at = datetime('now') WHERE id = ?").run(
      input.name,
      input.code,
      rate,
      input.isBase ? 1 : 0,
      id,
    )
  })()

  return { ok: true, currency: getCurrency(id)! }
}

export type DeleteResult = "deleted" | "not_found" | "is_base"

export function deleteCurrency(id: number): DeleteResult {
  const db = getDb()
  const existing = getCurrency(id)
  if (!existing) return "not_found"
  if (existing.isBase) return "is_base"
  db.prepare("DELETE FROM currencies WHERE id = ?").run(id)
  return "deleted"
}
