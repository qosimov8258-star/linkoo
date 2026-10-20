import "server-only"

import { isUniqueViolation } from "@/lib/auth-request"
import { getDb, withTransaction, type PgDb } from "@/lib/db"
import { discoverReferences, usageOf, type Usage } from "@/lib/platform-refs"
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
    rate: Number(row.rate),
    isBase: row.is_base === 1,
    createdDate: new Date(row.created_at).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }),
  }
}

export type CurrencyInput = { name: string; code: string; rate: number; isBase: boolean }

export type CurrencyUsage = Usage

/** Validation / conflict errors with the HTTP status the routes answer. */
export class CurrencyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly usage?: CurrencyUsage[],
  ) {
    super(message)
  }
}

const DUPLICATE = "Валюта с таким кодом уже существует"

// Spellings the documents use for the same currency (the finance core's fin_cur()).
const ALIASES: string[][] = [
  ["SUM", "UZS", "СУМ", "СЎМ", "SO'M", "SOM"],
  ["USD", "$"],
  ["EUR", "EURO", "€", "ЕВРО"],
  ["RUB", "RUR", "РУБ"],
]

export function currencyAliases(code: string): string[] {
  const upper = code.trim().toUpperCase()
  return ALIASES.find((group) => group.includes(upper)) ?? [upper]
}

/** Columns that store a currency code: `currency` and `*_currency` text columns. */
function currencyReferences(db: PgDb) {
  return discoverReferences(db, `c.column_name = 'currency' OR c.column_name LIKE '%\\_currency'`, "code", "currencies")
}

/** Cashboxes, branches, price lists, payments, documents … that use the currency. */
export async function currencyUsage(db: PgDb, currency: { id: number; code: string }): Promise<CurrencyUsage[]> {
  const refs = (await currencyReferences(db)).filter((ref) => ref.kind === "code")
  return usageOf(db, refs, { id: currency.id, codes: currencyAliases(currency.code) })
}

export async function listCurrencies(): Promise<Currency[]> {
  const db = getDb()
  const rows = (await db.prepare("SELECT * FROM currencies ORDER BY is_base DESC, id ASC").all()) as CurrencyRow[]
  return rows.map(rowToCurrency)
}

export async function getCurrency(id: number): Promise<Currency | null> {
  const db = getDb()
  const row = (await db.prepare("SELECT * FROM currencies WHERE id = ?").get(id)) as CurrencyRow | undefined
  return row ? rowToCurrency(row) : null
}

async function assertCodeFree(db: PgDb, code: string, exceptId: number) {
  const twin = await db.prepare("SELECT id FROM currencies WHERE upper(btrim(code)) = upper(btrim(?)) AND id <> ?").get(code, exceptId)
  if (twin) throw new CurrencyError(DUPLICATE, 409)
}

function duplicateGuard(error: unknown): never {
  if (isUniqueViolation(error)) throw new CurrencyError(DUPLICATE, 409)
  throw error
}

export async function createCurrency(input: CurrencyInput): Promise<Currency> {
  const rate = input.isBase ? 1 : input.rate
  try {
    const result = await withTransaction(async (db) => {
      await db.prepare("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE").run()
      await assertCodeFree(db, input.code, 0)
      if (input.isBase) {
        await db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1").run()
      }
      return db
        .prepare("INSERT INTO currencies (name, code, rate, is_base) VALUES (?, ?, ?, ?)")
        .run(input.name, input.code, rate, input.isBase ? 1 : 0)
    })
    return (await getCurrency(Number(result.lastInsertRowid)))!
  } catch (error) {
    return duplicateGuard(error)
  }
}

export type UpdateResult = { ok: true; currency: Currency } | { ok: false; error: "not_found" }

/** Updates the currency. Its code cannot change while anything uses it (the
 * documents store the code as text), and the base currency stays base until
 * another currency is made base. */
export async function updateCurrency(id: number, input: CurrencyInput): Promise<UpdateResult> {
  try {
    const found = await withTransaction(async (db) => {
      await db.prepare("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE").run()
      const current = (await db.prepare("SELECT * FROM currencies WHERE id = ?").get(id)) as CurrencyRow | undefined
      if (!current) return false
      const codeChanged = current.code.trim().toUpperCase() !== input.code
      if (codeChanged) {
        await assertCodeFree(db, input.code, id)
        const usage = await currencyUsage(db, current)
        if (usage.length) throw new CurrencyError("Нельзя изменить код валюты, которая используется", 409, usage)
      }
      if (current.is_base === 1 && !input.isBase) {
        throw new CurrencyError("Нельзя снять признак базовой валюты: сделайте базовой другую валюту", 400)
      }
      const isBase = input.isBase
      if (isBase) await db.prepare("UPDATE currencies SET is_base = 0 WHERE is_base = 1 AND id != ?").run(id)
      await db
        .prepare("UPDATE currencies SET name = ?, code = ?, rate = ?, is_base = ?, updated_at = datetime('now') WHERE id = ?")
        .run(input.name, input.code, isBase ? 1 : input.rate, isBase ? 1 : 0, id)
      return true
    })
    if (!found) return { ok: false, error: "not_found" }
    return { ok: true, currency: (await getCurrency(id))! }
  } catch (error) {
    return duplicateGuard(error)
  }
}

export type DeleteResult = "deleted" | "not_found" | "is_base"

/** Refused for the base currency and (409 with the usage list) while any
 * cashbox, branch, price list, payment or document uses the currency. */
export async function deleteCurrency(id: number): Promise<DeleteResult> {
  return withTransaction(async (db) => {
    await db.prepare("LOCK TABLE currencies IN SHARE ROW EXCLUSIVE MODE").run()
    const current = (await db.prepare("SELECT * FROM currencies WHERE id = ?").get(id)) as CurrencyRow | undefined
    if (!current) return "not_found"
    if (current.is_base === 1) return "is_base"
    const usage = await currencyUsage(db, current)
    if (usage.length) throw new CurrencyError("Удаление невозможно из-за связи с другими данными", 409, usage)
    await db.prepare("DELETE FROM currencies WHERE id = ?").run(id)
    return "deleted"
  })
}
