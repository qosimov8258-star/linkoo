import "server-only"

import { NextResponse } from "next/server"
import { z, type ZodType } from "zod"

import { dbErrorResponse } from "@/lib/db-errors"
import type { PgDb } from "@/lib/db"
import { loadCurrencyContext } from "@/lib/finance/context"
import { normCurrency } from "@/lib/finance/currency"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { cleanJsonText, zodErrorBody, zodIssueMessage } from "@/lib/validation"
import { strictNum } from "@/lib/strict-number"

// Shared plumbing of the procurement documents (Поставщики, Категории
// поставщиков, Приход от поставщиков, Возврат поставщикам, Баланс
// поставщиков): route ids, errors, body parsing, bounds, and lookups of the
// master data a document must reference (suppliers, warehouses, branches,
// organizations, currencies) by the finance name key (fin_key).

/** Contract bounds of money / quantity / rate inputs. */
export const MAX_MONEY = 1e13
export const MAX_QTY = 1e9
export const MAX_RATE = 1e9

const emptyToUndefined = (value: unknown) => (value === null || value === "" ? undefined : value)

/** Optional free text ('' / null → undefined). */
export const optionalText = (max: number) => z.preprocess(emptyToUndefined, z.string().max(max, `Не более ${max} символов`).optional())

/** Optional non-negative number (Блок, Кг., Вес нетто); '' / null → undefined. */
export const optionalAmount = z.preprocess(
  emptyToUndefined,
  strictNum(z.number({ error: "Должно быть числом" }).min(0, "Не может быть отрицательным").max(MAX_QTY, "Слишком большое значение").optional(), "Должно быть числом"),
)

/** A document line quantity: 0 < x ≤ 1e9. */
export const quantitySchema = strictNum(z.number({ error: "Количество должно быть числом" }).gt(0, "Количество должно быть больше 0").max(MAX_QTY, "Слишком большое количество"), "Количество должно быть числом")

/** A unit price / cost: 0 ≤ x ≤ 1e13. */
export const priceSchema = strictNum(z.number({ error: "Цена должна быть числом" }).min(0, "Цена не может быть отрицательной").max(MAX_MONEY, "Слишком большая цена"), "Цена должна быть числом")

/** Route param → positive int4 id, or null (non-numeric, 0, negative, too large). */
export function parseRouteId(value: string | undefined | null): number | null {
  const text = String(value ?? "").trim()
  if (!/^\d+$/.test(text)) return null
  const id = Number(text)
  return Number.isInteger(id) && id > 0 && id <= 2_147_483_647 ? id : null
}

export type ProcurementUsage = { table: string; label: string; count: number }

/** A refused procurement write: message (Russian i18n key), HTTP status, field errors and extras. */
export class ProcurementError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly fields?: Record<string, string>,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export function fieldError(field: string, message: string, status = 400): ProcurementError {
  return new ProcurementError(message, status, { [field]: message })
}

/** JSON response of a ProcurementError ({error, fields?, …extra}); null for other errors. */
export function procurementErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ProcurementError)) return dbErrorResponse(error)
  return NextResponse.json({ error: error.message, ...(error.fields ? { fields: error.fields } : {}), ...(error.extra ?? {}) }, { status: error.status })
}

/** Runs a route body and maps ProcurementError to its response. */
export async function procurementWrite(fn: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await fn()
  } catch (error) {
    const response = procurementErrorResponse(error)
    if (response) return response
    throw error
  }
}

export type ParsedProcurementBody<T> = { data: T; error?: undefined } | { data?: undefined; error: NextResponse }

/** Reads and validates a JSON body; a validation failure answers 400 with the first
 * issue as `error` (a readable Russian message), every issue in `fields` ("items.0.qty")
 * and zod's flattened `details`. */
export async function parseProcurementBody<T>(request: Request, schema: ZodType<T>): Promise<ParsedProcurementBody<T>> {
  let json: unknown
  try {
    json = await request.json()
  } catch {
    return { error: NextResponse.json({ error: "Тело запроса не является JSON" }, { status: 400 }) }
  }
  // Zero-width / bidi characters are dropped from every text; NUL and broken Unicode answer 400.
  const cleaned = cleanJsonText(json)
  if (cleaned.issue) {
    const field = cleaned.issue.field || "_"
    return { error: NextResponse.json({ error: cleaned.issue.message, fields: { [field]: cleaned.issue.message } }, { status: 400 }) }
  }
  const result = schema.safeParse(cleaned.value)
  if (result.success) return { data: result.data }
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join(".") || "_"
    if (!(path in fields)) fields[path] = zodIssueMessage(issue)
  }
  const body = zodErrorBody(result.error)
  return {
    error: NextResponse.json({ error: body.error, fields, details: body.details }, { status: 400 }),
  }
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** JS twin of SQL fin_key(): lower-cased, trimmed, inner whitespace collapsed. */
export function nameKey(value: unknown): string {
  return String(value ?? "")
    .replace(/[  ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

const PLACEHOLDER_KEYS = new Set(["", "-", "—", "не указано", "не указан", "не указана"])

/** "" / "Не указано" / "-" — a reference left empty on purpose. */
export function isPlaceholder(value: unknown): boolean {
  return PLACEHOLDER_KEYS.has(nameKey(value))
}

export async function tableExists(db: PgDb, table: string): Promise<boolean> {
  const row = (await db.prepare("SELECT to_regclass(@t) IS NOT NULL AS ok").get({ t: table })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** Existing columns of the given tables (lazily created ones included when present). */
export async function tableColumns(db: PgDb, tables: string[]): Promise<Map<string, Set<string>>> {
  const rows = (await db
    .prepare("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ANY(@tables::text[])")
    .all({ tables })) as Array<{ table_name: string; column_name: string }>
  const map = new Map<string, Set<string>>()
  for (const row of rows) {
    let columns = map.get(row.table_name)
    if (!columns) map.set(row.table_name, (columns = new Set()))
    columns.add(row.column_name)
  }
  return map
}

/** fin_key() and the other finance SQL helpers the lookups use. */
export async function ensureProcurementFunctions(db: PgDb): Promise<void> {
  await ensureFinanceSchema(db)
}

/** The row of `table` whose name matches (fin_key), lowest id first; null when none. */
async function namedRow(db: PgDb, table: "suppliers" | "warehouses" | "branches" | "organizations" | "supplier_categories", name: string): Promise<{ id: number; name: string } | null> {
  if (!nameKey(name) || !(await tableExists(db, table))) return null
  const row = (await db.prepare(`SELECT id, name FROM ${table} WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1`).get({ name })) as
    | { id: number; name: string }
    | undefined
  return row ? { id: Number(row.id), name: row.name } : null
}

/** The supplier owning the name (the ledger maps a name to the lowest id). */
export function findSupplier(db: PgDb, name: string) {
  return namedRow(db, "suppliers", name)
}

export function findWarehouse(db: PgDb, name: string) {
  return namedRow(db, "warehouses", name)
}

export function findBranch(db: PgDb, name: string) {
  return namedRow(db, "branches", name)
}

export function findOrganization(db: PgDb, name: string) {
  return namedRow(db, "organizations", name)
}

export function findSupplierCategory(db: PgDb, name: string) {
  return namedRow(db, "supplier_categories", name)
}

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

export type CurrencyInfo = {
  /** Canonical code (SUM, USD, …). */
  code: string
  /** Base units per 1 unit (1 for the base currency); null when not set. */
  rate: number | null
  base: string
}

/** A configured currency of the currencies table; null when unknown (always while the table is empty). */
export async function findCurrency(db: PgDb, code: string | null | undefined): Promise<CurrencyInfo | null> {
  const ctx = await loadCurrencyContext(db)
  const wanted = normCurrency(code, ctx.base)
  const currency = ctx.currencies.find((item) => item.code === wanted)
  if (!currency) return null
  const rate = currency.code === ctx.base ? 1 : currency.rate && currency.rate > 0 ? Number(currency.rate) : null
  return { code: currency.code, rate, base: ctx.base }
}

/** Live rates of every configured currency (base = 1), for converting stored amounts. */
export async function currencyRates(db: PgDb): Promise<{ base: string; rateOf: (code: string | null | undefined) => number | null }> {
  const ctx = await loadCurrencyContext(db)
  return {
    base: ctx.base,
    rateOf: (code) => {
      const canonical = normCurrency(code, ctx.base)
      if (canonical === ctx.base) return 1
      const rate = ctx.rates[canonical]
      return rate && rate > 0 ? Number(rate) : null
    },
  }
}

/** The rate snapshot written on a foreign-currency document (contract: rate_to_base). */
export async function rateToBase(db: PgDb, code: string | null | undefined): Promise<number> {
  const currency = await findCurrency(db, code)
  if (!currency) throw fieldError("currency", "Неизвестная валюта")
  if (!currency.rate || !(currency.rate > 0) || currency.rate > MAX_RATE) {
    throw new ProcurementError("Не задан курс валюты", 409, { currency: "Не задан курс валюты" }, { currency: currency.code })
  }
  return currency.rate
}
