import "server-only"

import type { PgDb } from "@/lib/db"
import { DOC_DATE_INVALID, DOC_MAX_YEAR, DOC_MIN_YEAR, docDateError, docYearOk, parseDocInput } from "@/lib/document-dates"
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

// --- input bounds (shared by every lib/cash parser and writer) ---------------------

/** Largest value of an INTEGER (int4) column: ids above it never exist and make Postgres fail. */
export const MAX_DB_ID = 2_147_483_647
/** |money| upper bound of every amount input (contract 3). */
export const MAX_MONEY = 1e13
/** Upper bound of a currency rate input (contract 3). */
export const MAX_RATE = 1e9
export const MAX_PAGE = 1_000_000
export const MAX_PAGE_SIZE = 5000
/** Business dates of money documents must fall in this year range (fin_ts reads 1900..2200);
 * the shared document-date rule (lib/document-dates.ts). */
export const CASH_MIN_YEAR = DOC_MIN_YEAR
export const CASH_MAX_YEAR = DOC_MAX_YEAR

/** A positive id an INTEGER column can hold. */
export function isDbId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_DB_ID
}

/** Page number / size of a list: page 1..MAX_PAGE, size 1..maxSize, 0 = all (when allowed). */
export function pageOf(page: number | undefined, pageSize: number | undefined, defaultSize = 25, maxSize = MAX_PAGE_SIZE): { page: number; pageSize: number } {
  const rawSize = Number.isFinite(pageSize) ? Math.floor(pageSize!) : defaultSize
  const size = rawSize === 0 ? 0 : Math.min(maxSize, Math.max(1, rawSize))
  const rawPage = Number.isFinite(page) ? Math.floor(page!) : 1
  return { page: Math.min(MAX_PAGE, Math.max(1, rawPage)), pageSize: size }
}

function checkYear(local: string, field: string): string {
  if (!docYearOk(local)) throw new CashError(DOC_DATE_INVALID, 400, field)
  return local
}

/** Input date ("YYYY-MM-DD" or local date-time) → local "YYYY-MM-DDTHH:mm:ss".
 * A day without time gets the current local time of day (keeps the entry order
 * of one day). Empty → now. Invalid (impossible day, year outside
 * CASH_MIN_YEAR..CASH_MAX_YEAR) or later than today (a money document, see
 * lib/document-dates.ts) → CashError(date); a typed date is never replaced.
 * `current` = the date the edited document already has (keeping its day is allowed). */
export function localDateTime(value: string | null | undefined, field = "date", current?: unknown): string {
  const text = String(value ?? "").trim()
  const now = nowLocalIso()
  if (!text) return now
  const local = /^\d{4}-\d{2}-\d{2}$/.test(text) ? (parseAnyDate(text) ? `${text}T${now.slice(11, 19)}` : null) : parseDocInput(text)
  const error = docDateError(local, { current })
  if (error) throw new CashError(error, 400, field)
  return local!
}

/** Optional ISO day ("" when empty). */
export function isoDayOrEmpty(value: string | null | undefined, field: string): string {
  const text = String(value ?? "").trim()
  if (!text) return ""
  const parsed = parseDocInput(text)
  if (!parsed) throw new CashError("Неверная дата", 400, field)
  return checkYear(parsed, field).slice(0, 10)
}

/** A business day "YYYY-MM-DD" of a money document (real calendar day, sane year), else null. */
export function cashDayOrNull(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null
  const day = value.trim()
  return parseAnyDate(day) && docYearOk(day) ? day : null
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

/** Default expense category of payments created without one (money request
 * payments, cashback payouts): the first category with the wanted option. */
export async function defaultExpenseCategory(db: PgDb, wanted: CategoryOptionKey[]): Promise<CategoryInfo | null> {
  const expense = (await loadCategories(db)).filter((category) => category.kind === "expense")
  for (const key of wanted) {
    const found = expense.find((category) => category.options[0] === key) ?? expense.find((category) => category.options.includes(key))
    if (found) return found
  }
  return null
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

export type SupplyExpenseInfo = {
  id: number
  incomingId: number
  description: string
  amount: number
  currency: string
  /** The rate of its currency frozen when the expense was added (contract 2); null on older rows. */
  rateToBase: number | null
}

export async function loadSupplyExpense(db: PgDb, id: number | null | undefined, base: string): Promise<SupplyExpenseInfo> {
  const exists = (await db.prepare("SELECT to_regclass('supplier_incoming_expenses') IS NOT NULL AS ok").get()) as { ok: boolean }
  // FOR UPDATE: this runs inside the cash write transaction (resolvePlan(tx, …)). It serialises
  // the payments of one expense (the second one waits and then sees the first, so the unpaid rest
  // check cannot be raced; a FOR SHARE taken by both would deadlock on the transaction_id stamp),
  // and it holds off a concurrent deleteIncomingExpense / supply cancel (FOR UPDATE) until the
  // payment commits, so they then see the payment (409).
  const row =
    id && exists.ok
      ? ((await db
          // to_jsonb: rate_to_base is added lazily by lib/supplier-incomings-repo.ts.
          .prepare(
            `SELECT e.id, e.incoming_id, e.description, e.amount, e.currency, (to_jsonb(e) ->> 'rate_to_base')::float8 AS rate_to_base
             FROM supplier_incoming_expenses e WHERE e.id = @id FOR UPDATE`,
          )
          .get({ id })) as { id: number; incoming_id: number; description: string; amount: number; currency: string; rate_to_base: number | null } | undefined)
      : undefined
  if (!row) throw new CashError("Доп. расход не найден", 404, "supplyExpense")
  const rate = numOrNull(row.rate_to_base)
  return {
    id: row.id,
    incomingId: row.incoming_id,
    description: row.description,
    amount: num(row.amount),
    currency: normCurrency(row.currency, base),
    rateToBase: rate !== null && rate > 0 ? rate : null,
  }
}

export type ContractInfo = { id: number; label: string }

export async function loadContract(db: PgDb, id: number | null | undefined): Promise<ContractInfo | null> {
  if (!id) return null
  const exists = (await db.prepare("SELECT to_regclass('contracts') IS NOT NULL AS ok").get()) as { ok: boolean }
  // to_jsonb: the number/prefix/suffix columns are added lazily by lib/contracts-repo.ts.
  const found = exists.ok
    ? ((await db.prepare("SELECT to_jsonb(c) AS row FROM contracts c WHERE c.id = @id").get({ id })) as { row: Record<string, unknown> } | undefined)
    : undefined
  if (!found) throw new CashError("Договор не найден", 404, "contract")
  const row = found.row
  const text = (value: unknown) => (value == null ? "" : String(value))
  const number = `${text(row.contract_prefix)}${text(row.contract_number) || text(row.id)}${text(row.contract_suffix)}`
  const label = [`№ ${number}`, text(row.official_name), text(row.organization), text(row.year)].filter(Boolean).join(" · ")
  return { id: Number(row.id), label }
}

/** Whether contract `contractId` covers `client` — the same rule as the contract select of the
 * payment dialogs (lib/contracts-repo.ts listContractOptions): a link to the client (or to a client
 * of the same name), or, for a legacy contract without links, its stored client name. */
export async function contractCoversClient(db: PgDb, contractId: number, client: ClientInfo): Promise<boolean> {
  // contract_clients is created by lib/contracts-repo.ts; without it every contract is a legacy one.
  const links = await tableExists(db, "contract_clients")
  const linkSql = links
    ? `EXISTS (SELECT 1 FROM contract_clients cc WHERE cc.contract_id = k.id
         AND (cc.client_id = @clientId::int OR cc.client_id IN (SELECT id FROM clients WHERE fin_key(name) = fin_key(@name::text))))`
    : "false"
  const linkedSql = links ? "EXISTS (SELECT 1 FROM contract_clients cc WHERE cc.contract_id = k.id)" : "false"
  const row = (await db
    .prepare(
      `SELECT (${linkSql}) OR (NOT (${linkedSql}) AND fin_key(COALESCE(to_jsonb(k) ->> 'client', '')) = fin_key(@name::text)) AS ok
       FROM contracts k WHERE k.id = @id::int`,
    )
    .get({ id: contractId, clientId: client.id, name: client.name })) as { ok: boolean } | undefined
  return Boolean(row?.ok)
}

/** Advisory lock that serialises everything that depends on the live payments of supply `supplyId`:
 * its payments (lib/cash/write.ts) and the supply's cancel / delete (lib/supplier-incomings-repo.ts).
 * Always taken before the supplier_incomings row lock (the payment writer locks that row last, in
 * recomputeSupplyPaid), so the order is the same everywhere. */
export async function lockSupplyPayments(db: PgDb, supplyId: number): Promise<void> {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext(@key)) AS ok").get({ key: `linko-supply-pay:${supplyId}` })
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

// --- cashback balance (Накопительная карта) --------------------------------------------

/** Advisory lock namespace that serialises cashback checks of one client
 * (loyalty page, cash payouts, cashback requests): pg_advisory_xact_lock(key, clientId). */
const CASHBACK_CLIENT_LOCK = 72120903

export async function lockClientCashback(tx: PgDb, clientId: number): Promise<void> {
  await tx.prepare("SELECT pg_advisory_xact_lock(@key::int, @clientId::int)").get({ key: CASHBACK_CLIENT_LOCK, clientId })
}

/** Client's cashback balance in `currency` (Σ loyalty_card_transactions), optionally
 * without the rows linked to cash entry `excludeEntryId` (the payout being edited). */
export async function clientCashbackBalance(db: PgDb, clientId: number, currency: string, base: string, excludeEntryId: number | null = null): Promise<number> {
  const exists = (await db.prepare("SELECT to_regclass('loyalty_card_transactions') IS NOT NULL AS ok").get()) as { ok: boolean }
  if (!exists.ok) return 0
  const row = (await db
    .prepare(
      `SELECT COALESCE(SUM(amount::double precision), 0) AS amount FROM loyalty_card_transactions
       WHERE client_id = @clientId::int AND COALESCE(fin_cur(currency), @base::text) = @cur::text
         AND (@exclude::int IS NULL OR transaction_id IS DISTINCT FROM @exclude::int)`,
    )
    .get({ clientId, cur: normCurrency(currency, base), base, exclude: excludeEntryId })) as { amount: number | string }
  return roundMoney(Number(row.amount ?? 0), 5)
}

/** Locks the client's cashback and refuses a payout / write-off above the balance. */
export async function assertCashbackAvailable(
  tx: PgDb,
  p: { clientId: number; amount: number; currency: string; base: string; excludeEntryId?: number | null; field?: string },
): Promise<void> {
  await lockClientCashback(tx, p.clientId)
  const balance = await clientCashbackBalance(tx, p.clientId, p.currency, p.base, p.excludeEntryId ?? null)
  if (p.amount > balance + 0.005) throw new CashError("Недостаточно кэшбэка у клиента", 400, p.field ?? "amount")
}

// --- organization of a money document ------------------------------------------------------

export type OrganizationHints = {
  orderId?: number | null
  contractId?: number | null
  supplierId?: number | null
  supplyId?: number | null
  supplyExpenseId?: number | null
  moneyRequestId?: number | null
  clientId?: number | null
  /** Employee whose single organization applies (collecting agent). */
  employeeName?: string | null
  cashboxId?: number | null
}

async function tableExists(db: PgDb, table: string): Promise<boolean> {
  return ((await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean }).ok
}

function organizationsOfEmployee(raw: unknown): string[] {
  let list: unknown = raw
  if (typeof raw === "string") {
    try {
      list = JSON.parse(raw)
    } catch {
      list = raw.split(",")
    }
  }
  return [...new Set((Array.isArray(list) ? list : []).map((item) => placeName(item)).filter(Boolean))]
}

function single(values: unknown[]): string {
  const names = [...new Map(values.map((value) => placeName(value)).filter(Boolean).map((name) => [nameKey(name), name])).values()]
  return names.length === 1 ? names[0] : ""
}

/** Organization (division) of a cash / payment document. An explicit name must
 * be a known organization (canonical spelling returned). Otherwise it is taken
 * from the counterparty: order → contract → supply / money request / supplier →
 * the client's contracts (one organization) → the collecting employee → the
 * cashbox's cashier (one organization) → the only organization. "" when unknown. */
export async function resolveOrganization(db: PgDb, explicit: string | null | undefined, hints: OrganizationHints = {}, field = "division"): Promise<string> {
  const known = (await tableExists(db, "organizations"))
    ? ((await db.prepare("SELECT name FROM organizations ORDER BY id").all()) as Array<{ name: string }>).map((row) => row.name)
    : []
  const wanted = placeName(explicit)
  if (wanted) {
    if (!known.length) return wanted
    const match = known.find((name) => nameKey(name) === nameKey(wanted))
    if (!match) throw new CashError("Организация не найдена", 400, field)
    return match
  }
  const first = async (sql: string, params: Record<string, unknown>, table: string): Promise<string> => {
    if (!(await tableExists(db, table))) return ""
    const row = (await db.prepare(sql).get(params)) as { org: string | null } | undefined
    return placeName(row?.org)
  }
  const tries: Array<() => Promise<string>> = []
  if (hints.orderId) tries.push(() => first("SELECT to_jsonb(o) ->> 'organization' AS org FROM orders o WHERE o.id = @id", { id: hints.orderId }, "orders"))
  if (hints.contractId) tries.push(() => first("SELECT to_jsonb(k) ->> 'organization' AS org FROM contracts k WHERE k.id = @id", { id: hints.contractId }, "contracts"))
  if (hints.supplyExpenseId)
    tries.push(() =>
      first(
        `SELECT to_jsonb(si) ->> 'organization' AS org FROM supplier_incoming_expenses e JOIN supplier_incomings si ON si.id = e.incoming_id WHERE e.id = @id`,
        { id: hints.supplyExpenseId },
        "supplier_incoming_expenses",
      ),
    )
  if (hints.supplyId) {
    tries.push(() => first("SELECT to_jsonb(si) ->> 'organization' AS org FROM supplier_incomings si WHERE si.id = @id", { id: hints.supplyId }, "supplier_incomings"))
    tries.push(() =>
      first(
        "SELECT to_jsonb(s) ->> 'organization' AS org FROM supplier_incomings si JOIN suppliers s ON fin_key(s.name) = fin_key(si.supplier) WHERE si.id = @id ORDER BY s.id LIMIT 1",
        { id: hints.supplyId },
        "supplier_incomings",
      ),
    )
  }
  if (hints.moneyRequestId) {
    tries.push(() => first("SELECT to_jsonb(t) ->> 'organization' AS org FROM supplier_balance_transactions t WHERE t.id = @id", { id: hints.moneyRequestId }, "supplier_balance_transactions"))
    tries.push(() =>
      first(
        "SELECT to_jsonb(s) ->> 'organization' AS org FROM supplier_balance_transactions t JOIN suppliers s ON s.id = t.supplier_id WHERE t.id = @id",
        { id: hints.moneyRequestId },
        "supplier_balance_transactions",
      ),
    )
  }
  if (hints.supplierId) tries.push(() => first("SELECT to_jsonb(s) ->> 'organization' AS org FROM suppliers s WHERE s.id = @id", { id: hints.supplierId }, "suppliers"))
  if (hints.clientId) {
    tries.push(async () => {
      if (!(await tableExists(db, "contracts"))) return ""
      const rows = (await db
        .prepare(
          `SELECT to_jsonb(k) ->> 'organization' AS org FROM contracts k JOIN clients c ON fin_key(c.name) = fin_key(to_jsonb(k) ->> 'client')
           WHERE c.id = @id AND COALESCE(to_jsonb(k) ->> 'status', '') <> 'cancelled'`,
        )
        .all({ id: hints.clientId })) as Array<{ org: string }>
      return single(rows.map((row) => row.org))
    })
  }
  if (hints.employeeName?.trim()) {
    tries.push(async () => {
      const row = (await db
        .prepare("SELECT to_jsonb(e) -> 'organizations' AS organizations FROM employees e WHERE fin_key(e.first_name || ' ' || e.last_name) = fin_key(@name) ORDER BY e.id LIMIT 1")
        .get({ name: hints.employeeName })) as { organizations: unknown } | undefined
      return single(organizationsOfEmployee(row?.organizations))
    })
  }
  if (hints.cashboxId) {
    tries.push(async () => {
      // cashier_id is added lazily by lib/cashboxes-repo.ts: read it through to_jsonb.
      const row = (await db
        .prepare(
          `SELECT to_jsonb(e) -> 'organizations' AS organizations FROM cashboxes cb
           JOIN employees e ON e.id = (to_jsonb(cb) ->> 'cashier_id')::int
             OR ((to_jsonb(cb) ->> 'cashier_id') IS NULL AND fin_key(e.first_name || ' ' || e.last_name) = fin_key(cb.cashier))
           WHERE cb.id = @id ORDER BY e.id LIMIT 1`,
        )
        .get({ id: hints.cashboxId })) as { organizations: unknown } | undefined
      return single(organizationsOfEmployee(row?.organizations))
    })
  }
  for (const attempt of tries) {
    const found = await attempt()
    if (found) {
      // Keep the canonical spelling of a known organization.
      return known.find((name) => nameKey(name) === nameKey(found)) ?? found
    }
  }
  return known.length === 1 ? known[0] : ""
}
