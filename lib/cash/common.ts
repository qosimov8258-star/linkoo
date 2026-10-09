import "server-only"

import type { PgDb } from "@/lib/db"
import { loadCurrencyContext, type CurrencyContext } from "@/lib/finance/context"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso, parseAnyDate } from "@/lib/finance/dates"
import { nameKey, placeName } from "@/lib/finance/entities"
import { normalizeOptions, optionsOfParameter, type CashPaymentType, type CategoryOptionKey, type ConvertResult } from "@/lib/cash/types"
import { rateOf } from "@/lib/cash/rates"

// Shared helpers of the cash core: the error type every operation throws,
// date normalisation and the lookups that validate referenced rows.

/** Thrown by lib/cash operations; routes map it to { error, field } with `status`. */
export class CashError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    /** Form field the demo maps the error onto (cashbox, client, provider, amount, …). */
    readonly field?: string,
  ) {
    super(message)
  }
}

/** Input date ("YYYY-MM-DD" or local date-time) → local "YYYY-MM-DDTHH:mm:ss".
 * A day without time gets the current local time of day (keeps the entry order
 * of one day). Empty → now. Invalid → CashError(date). */
export function localDateTime(value: string | null | undefined, field = "date"): string {
  const text = String(value ?? "").trim()
  const now = nowLocalIso()
  if (!text) return now
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    if (!parseAnyDate(text)) throw new CashError("Неверная дата", 400, field)
    return `${text}T${now.slice(11, 19)}`
  }
  const parsed = parseAnyDate(text)
  if (!parsed) throw new CashError("Неверная дата", 400, field)
  return parsed
}

/** Optional ISO day ("" when empty). */
export function isoDayOrEmpty(value: string | null | undefined, field: string): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const parsed = parseAnyDate(text)
  if (!parsed) throw new CashError("Неверная дата", 400, field)
  return parsed.slice(0, 10)
}

export function paymentKind(value: unknown): CashPaymentType {
  return /^(банк|bank|card|карт|переч|o'tkaz|otkaz|transfer)/.test(nameKey(value)) ? "bank" : "cash"
}

export function num(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export type CashboxInfo = { id: number; name: string; currency: string; type: CashPaymentType; branch: string; vansell: boolean }

export async function loadCashbox(db: PgDb, id: number | null | undefined, base: string, field = "cashbox"): Promise<CashboxInfo> {
  const row = id
    ? ((await db.prepare("SELECT id, name, currency, payment_type, branch, vansell FROM cashboxes WHERE id = @id").get({ id })) as
        | { id: number; name: string; currency: string; payment_type: string; branch: string; vansell: number }
        | undefined)
    : undefined
  if (!row) throw new CashError("Касса не найдена", 404, field)
  return {
    id: row.id,
    name: row.name,
    currency: normCurrency(row.currency, base),
    type: paymentKind(row.payment_type),
    branch: placeName(row.branch),
    vansell: Boolean(row.vansell),
  }
}

export type CategoryInfo = {
  id: number
  name: string
  kind: "income" | "expense"
  options: CategoryOptionKey[]
  /** expense_categories.direct (demo internal_transfer, "Внутренний расход"). */
  internal: boolean
  /** expense_categories.exclude_from_pnl (demo disable_pl). */
  excludeFromPnl: boolean
  parentId: number | null
}

type CategoryRow = { id: number; name: string; parameter: string; options: string | null; direct?: number; exclude_from_pnl?: number; parent_id?: number | null }

function toCategory(row: CategoryRow, kind: "income" | "expense"): CategoryInfo {
  const stored = row.options === null || row.options === undefined ? null : normalizeOptions(row.options)
  return {
    id: row.id,
    name: row.name,
    kind,
    options: stored ?? optionsOfParameter(row.parameter),
    internal: Boolean(row.direct),
    excludeFromPnl: Boolean(row.exclude_from_pnl),
    parentId: row.parent_id ?? null,
  }
}

/** Every income and expense category with its options (requires ensureCashSchema). */
export async function loadCategories(db: PgDb): Promise<CategoryInfo[]> {
  const income = (await db.prepare("SELECT id, name, parameter, options FROM income_categories ORDER BY id").all()) as CategoryRow[]
  const expense = (await db
    .prepare("SELECT id, name, parameter, options, direct, exclude_from_pnl, parent_id FROM expense_categories ORDER BY id")
    .all()) as CategoryRow[]
  return [...income.map((row) => toCategory(row, "income")), ...expense.map((row) => toCategory(row, "expense"))]
}

export async function loadCategory(db: PgDb, kind: "income" | "expense", id: number | null | undefined): Promise<CategoryInfo> {
  const table = kind === "income" ? "income_categories" : "expense_categories"
  const extra = kind === "expense" ? ", direct, exclude_from_pnl, parent_id" : ""
  const row = id ? ((await db.prepare(`SELECT id, name, parameter, options${extra} FROM ${table} WHERE id = @id`).get({ id })) as CategoryRow | undefined) : undefined
  if (!row) throw new CashError("Категория не найдена", 404, kind === "income" ? "incomeCategory" : "expenseCategory")
  return toCategory(row, kind)
}

export type ClientInfo = { id: number; name: string; code: string | null }

export async function loadClient(db: PgDb, id: number | null | undefined, field = "client"): Promise<ClientInfo> {
  const row = id ? ((await db.prepare("SELECT * FROM clients WHERE id = @id").get({ id })) as { id: number; name: string; code?: string | null } | undefined) : undefined
  if (!row) throw new CashError("Клиент не найден", 404, field)
  return { id: row.id, name: row.name, code: row.code || null }
}

/** Client by display name (lowest id), as orders reference clients. */
export async function findClientByName(db: PgDb, name: string): Promise<ClientInfo | null> {
  const row = (await db.prepare("SELECT * FROM clients WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })) as
    | { id: number; name: string; code?: string | null }
    | undefined
  return row ? { id: row.id, name: row.name, code: row.code || null } : null
}

export type SupplierInfo = { id: number | null; name: string }

export async function loadSupplier(db: PgDb, id: number | null | undefined, field = "provider"): Promise<SupplierInfo> {
  const row = id ? ((await db.prepare("SELECT id, name FROM suppliers WHERE id = @id").get({ id })) as { id: number; name: string } | undefined) : undefined
  if (!row) throw new CashError("Поставщик не найден", 404, field)
  return { id: row.id, name: row.name }
}

export async function findSupplierByName(db: PgDb, name: string): Promise<SupplierInfo> {
  const row = (await db.prepare("SELECT id, name FROM suppliers WHERE fin_key(name) = fin_key(@name) ORDER BY id LIMIT 1").get({ name })) as
    | { id: number; name: string }
    | undefined
  return row ? { id: row.id, name: row.name } : { id: null, name: name.trim() }
}

export type EmployeeInfo = { id: number; name: string }

export async function loadEmployee(db: PgDb, id: number | null | undefined, field = "responsibleDeliveryMan"): Promise<EmployeeInfo> {
  const row = id
    ? ((await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = @id").get({ id })) as { id: number; first_name: string; last_name: string } | undefined)
    : undefined
  if (!row) throw new CashError("Сотрудник не найден", 404, field)
  return { id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() }
}

export async function loadEmployees(db: PgDb, ids: number[], field = "staffs"): Promise<Map<number, EmployeeInfo>> {
  const unique = [...new Set(ids)]
  const rows = unique.length
    ? ((await db.prepare("SELECT id, first_name, last_name FROM employees WHERE id = ANY(@ids::int[])").all({ ids: unique })) as Array<{
        id: number
        first_name: string
        last_name: string
      }>)
    : []
  const map = new Map(rows.map((row) => [row.id, { id: row.id, name: `${row.first_name ?? ""} ${row.last_name ?? ""}`.trim() }]))
  if (map.size !== unique.length) throw new CashError("Сотрудник не найден", 404, field)
  return map
}

export type SupplyInfo = { id: number; supplier: string; status: string; currency: string; amount: number }

export async function loadSupply(db: PgDb, id: number | null | undefined, base: string): Promise<SupplyInfo> {
  const row = id
    ? ((await db.prepare("SELECT * FROM supplier_incomings WHERE id = @id").get({ id })) as
        | { id: number; supplier: string; status: string; currency?: string; amount: number }
        | undefined)
    : undefined
  if (!row) throw new CashError("Поставка не найдена", 404, "supply")
  return { id: row.id, supplier: row.supplier, status: row.status, currency: normCurrency(row.currency, base), amount: num(row.amount) }
}

export type SupplyExpenseInfo = { id: number; incomingId: number; description: string; amount: number; currency: string }

export async function loadSupplyExpense(db: PgDb, id: number | null | undefined, base: string): Promise<SupplyExpenseInfo> {
  const exists = (await db.prepare("SELECT to_regclass('supplier_incoming_expenses') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row =
    id && exists.ok
      ? ((await db.prepare("SELECT id, incoming_id, description, amount, currency FROM supplier_incoming_expenses WHERE id = @id").get({ id })) as
          | { id: number; incoming_id: number; description: string; amount: number; currency: string }
          | undefined)
      : undefined
  if (!row) throw new CashError("Доп. расход не найден", 404, "supplyExpense")
  return { id: row.id, incomingId: row.incoming_id, description: row.description, amount: num(row.amount), currency: normCurrency(row.currency, base) }
}

export type ContractInfo = { id: number; label: string }

export async function loadContract(db: PgDb, id: number | null | undefined): Promise<ContractInfo | null> {
  if (!id) return null
  const exists = (await db.prepare("SELECT to_regclass('contracts') IS NOT NULL AS ok").get()) as { ok: boolean }
  const row = exists.ok
    ? ((await db.prepare("SELECT id, official_name, organization, year FROM contracts WHERE id = @id").get({ id })) as
        | { id: number; official_name: string; organization: string; year: number | null }
        | undefined)
    : undefined
  if (!row) throw new CashError("Договор не найден", 404, "contract")
  const label = [`№ ${row.id}`, row.official_name, row.organization, row.year ? String(row.year) : ""].filter(Boolean).join(" · ")
  return { id: row.id, label }
}

/** Currency context (base + current rates). */
export async function currencyContext(db: PgDb): Promise<CurrencyContext> {
  return loadCurrencyContext(db)
}

/** Base units per 1 unit of `code` (custom when > 0, else the current rate); null = unknown. */
export function pickRate(code: string, cc: CurrencyContext, custom?: number | null): number | null {
  if (normCurrency(code, cc.base) === cc.base) return 1
  if (custom && custom > 0) return custom
  return rateOf(code, cc.rates, cc.base)
}

/** Conversion result (demo finance/convert): rates are base units per 1 unit; custom ones win. */
export function convertMoneyFor(amount: number, from: string, to: string, cc: CurrencyContext, fromCustom?: number | null, toCustom?: number | null): ConvertResult {
  const fromCode = normCurrency(from, cc.base)
  const toCode = normCurrency(to, cc.base)
  const fromRate = pickRate(fromCode, cc, fromCustom)
  const toRate = pickRate(toCode, cc, toCustom)
  const missing = [fromRate ? "" : fromCode, toRate ? "" : toCode].filter(Boolean)
  const same = fromCode === toCode
  const result = same ? amount : fromRate && toRate ? (amount * fromRate) / toRate : null
  return {
    from: fromCode,
    to: toCode,
    amount,
    result: result === null ? null : roundMoney(result, 5),
    rate: same ? 1 : fromRate && toRate ? fromRate / toRate : null,
    fromRate,
    toRate,
    baseCurrency: cc.base,
    missing: same ? [] : [...new Set(missing)],
  }
}

/** Loyalty card currency spelling (sum / usd / euro). */
export function loyaltyCurrency(code: string): string {
  const canonical = normCurrency(code)
  return canonical === "EUR" ? "euro" : canonical.toLowerCase()
}
