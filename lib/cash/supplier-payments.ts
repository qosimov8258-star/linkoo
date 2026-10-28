import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { isIsoDay } from "@/lib/finance/dates"
import { nameKey } from "@/lib/finance/entities"
import { currencyContext, isDbId, MAX_PAGE, MAX_PAGE_SIZE, num, numOrNull, pageOf, pickRate } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import type {
  SupplierPaymentItem,
  SupplierPaymentsOptions,
  SupplierPaymentsResult,
  SupplierPaymentsTotal,
  SupplyPaymentItem,
  SupplyPaymentsResult,
} from "@/components/analytics/supplier-payments-data"

// Read model of "Оплаты поставщикам" (demo #/provider-transaction, GET
// finance/provider_transactions/?type=1 + /total/) and of the supply card
// "Оплачено" / "Список оплат по поставке №N" (demo provider_debt_separations).
//
// Source: supplier_payments, the one table the cash core writes supplier money
// to (cash page «Расход» with a provider / supply category, paid money
// requests). Listed: every live payment (is_deleted = 0) except provider
// refunds (op 4, demo type 8 is not a PAYMENT). Unverified payments are listed
// but, like in the ledger, never counted: totals, supply "Оплачено" and the
// supplier / cashbox balances use verified rows only. No writer here — the demo
// page is read-only; payments are created / edited / deleted on the cash page.

export type SupplierPaymentsQuery = {
  /** ISO days on the payment date (fin_ts(paid_at)), inclusive. */
  from?: string
  to?: string
  /** Organization (division) names, strict. */
  organizations?: string[]
  /** Branch names: the payment branch, else the cashbox branch. */
  branches?: string[]
  supplierIds?: number[]
  /** Currency of "Сумма" (credited to the supplier). */
  currency?: string
  /** Digits = № (id) or the cash №; else a substring of supplier / comment / cashbox / organization / branch / user / category. */
  search?: string
  /** Demo keys: id | client | user | created_date | division | amount | cashbox ("-" = desc). Default "-id". */
  ordering?: string
  page?: number
  /** Default 25; 0 = all (max 5000). */
  pageSize?: number
}

const MAX_ROWS = 5000

const RATES_CTE = `rates AS (
  SELECT c.code, CASE WHEN c.code = @base::text THEN 1::float8 ELSE c.rate END AS rate
  FROM (SELECT fin_cur(code) AS code, MAX(rate)::float8 AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1) c
  UNION ALL SELECT @base::text, 1::float8 WHERE NOT EXISTS (SELECT 1 FROM currencies WHERE fin_cur(code) = @base::text)
)`

const RATE = (code: string) => `(SELECT r.rate FROM rates r WHERE r.code = ${code})`

/** Cash side in the cashbox currency (same rule as the ledger and the cash list). */
const CASH_SIDE = `CASE WHEN sp.real_amount IS NOT NULL AND fin_cur(NULLIF(sp.real_currency, '')) = cb.cur THEN sp.real_amount::float8
  WHEN COALESCE(fin_cur(sp.currency), cb.cur) = cb.cur THEN sp.amount::float8
  ELSE sp.amount::float8 * COALESCE(${RATE("fin_cur(sp.currency)")} / NULLIF(${RATE("cb.cur")}, 0), 1) END`

// Reference rows (supplier_payment_reference_rows, 20 real payments of the demo app): when that table exists the list
// shows exactly those rows plus payments created here; the seeded demo payments (demo_seed_rows) stay out of the
// list but keep feeding the cash side. New local payments sort above the reference rows.
const DEMO_HIDDEN = ` AND NOT EXISTS (SELECT 1 FROM demo_seed_rows dsr WHERE dsr.table_name = 'supplier_payments' AND dsr.row_id = sp.id::text)`
const REFERENCE_ROWS = `UNION ALL
  SELECT r.id, r.id, r.doc_no, 5, r.ts, r.cby, r.supplier_id, r.supplier_name, r.organization, ''::text, cbr.branch,
         r.amount, r.cur, NULL::float8, NULL::float8, NULL::float8, r.cashbox_id, r.cashbox_name, r.pt,
         CASE WHEN cbr.cur = r.cur THEN r.amount END, cbr.cur, NULL::text, r.comment, NULL::int, NULL::int, true
  FROM supplier_payment_reference_rows r LEFT JOIN cbx cbr ON cbr.id = r.cashbox_id`

const buildPaymentsCte = (withReference: boolean) => `WITH ${RATES_CTE},
cbx AS (
  SELECT id, name, COALESCE(fin_cur(currency), @base::text) AS cur, CASE WHEN fin_pt(payment_type) = 'bank' THEN 'bank' ELSE 'cash' END AS pt,
         fin_place(branch) AS branch
  FROM cashboxes
),
cbk AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1),
sk AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM suppliers GROUP BY 1),
p AS (
  SELECT sp.id, ${withReference ? "sp.id + 100000" : "sp.id"} AS sort_id, sp.doc_no::bigint AS doc_no, COALESCE(sp.op_type, 5) AS op,
    COALESCE(fin_ts(sp.paid_at), fin_ts(NULLIF(sp.payment_date, '')), fin_ts(sp.created_at, true)) AS ts,
    sp.created_by AS cby,
    COALESCE(sp.supplier_id, sk.id) AS supplier_id, COALESCE(s.name, sp.supplier) AS supplier_name,
    fin_place(sp.organization) AS organization, fin_place(sp.branch) AS branch, cb.branch AS cb_branch,
    sp.amount::float8 AS amount, COALESCE(fin_cur(NULLIF(sp.currency, '')), @base::text) AS cur,
    sp.internal_amount::float8 AS internal_amount, sp.debt_rate::float8 AS debt_rate, sp.custom_rate::float8 AS custom_rate,
    cb.id AS cashbox_id, COALESCE(cb.name, NULLIF(sp.kassa, '')) AS cashbox_name,
    COALESCE(cb.pt, CASE WHEN fin_pt(sp.icon) = 'bank' THEN 'bank' ELSE 'cash' END) AS pt,
    CASE WHEN cb.id IS NOT NULL THEN ${CASH_SIDE} WHEN sp.real_amount IS NOT NULL THEN sp.real_amount::float8 ELSE NULL END AS cash_amount,
    COALESCE(cb.cur, fin_cur(NULLIF(sp.real_currency, ''))) AS cash_cur,
    sp.category, CASE WHEN sp.comment = 'Не указано' THEN '' ELSE sp.comment END AS comment,
    sp.supply_id, sp.money_request_id, (sp.is_verified <> 0) AS verified
  FROM supplier_payments sp
  LEFT JOIN cbk ON sp.cashbox_id IS NULL AND cbk.k = fin_key(sp.kassa)
  LEFT JOIN cbx cb ON cb.id = COALESCE(sp.cashbox_id, cbk.id)
  LEFT JOIN suppliers s ON s.id = sp.supplier_id
  LEFT JOIN sk ON sp.supplier_id IS NULL AND sk.k = fin_key(sp.supplier)
  WHERE sp.is_deleted = 0 AND COALESCE(sp.op_type, 5) <> 4${withReference ? DEMO_HIDDEN : ""}
  ${withReference ? REFERENCE_ROWS : ""}
),
f AS (
  SELECT p.*,
    COALESCE(p.debt_rate, CASE WHEN p.cur = p.cash_cur THEN p.custom_rate END, ${RATE("p.cur")}) AS rate,
    COALESCE(p.custom_rate, ${RATE("p.cash_cur")}) AS cash_rate
  FROM p
  WHERE (@from::text = '' OR p.ts::date >= NULLIF(@from::text, '')::date)
    AND (@to::text = '' OR p.ts::date <= NULLIF(@to::text, '')::date)
    AND (cardinality(@orgs::text[]) = 0 OR fin_key(p.organization) = ANY(@orgs::text[]))
    AND (cardinality(@branches::text[]) = 0 OR fin_key(COALESCE(NULLIF(p.branch, ''), p.cb_branch)) = ANY(@branches::text[]))
    AND (cardinality(@suppliers::int[]) = 0 OR p.supplier_id = ANY(@suppliers::int[]))
    AND (@currency::text = '' OR p.cur = @currency::text)
    AND (@q::text = ''
         OR (@qnum::bigint >= 0 AND (p.id = @qnum::bigint OR p.doc_no = @qnum::bigint))
         OR strpos(fin_key(concat_ws(' ', p.supplier_name, p.comment, p.cashbox_name, p.organization, p.branch, p.cby, p.category)), @q::text) > 0)
)`

/** Text keys sort by code point (COLLATE "C"): the server's libc collation may misorder Cyrillic. */
const TEXT = (expr: string) => `fin_key(${expr}) COLLATE "C"`

const ORDER_FIELDS: Record<string, string> = {
  id: "f.sort_id",
  client: TEXT("f.supplier_name"),
  supplier: TEXT("f.supplier_name"),
  user: TEXT("f.cby"),
  created_date: "f.ts",
  date: "f.ts",
  division: TEXT("f.organization"),
  organization: TEXT("f.organization"),
  amount: "f.amount",
  cashbox: TEXT("f.cashbox_name"),
}

function orderBy(ordering: string | undefined): string {
  const text = String(ordering ?? "").trim() || "-id"
  const desc = text.startsWith("-")
  const field = ORDER_FIELDS[text.replace(/^-/, "")] ?? "f.sort_id"
  const dir = desc ? "DESC" : "ASC"
  return `${field} ${dir} NULLS LAST, f.id ${dir}`
}

function ids(values: number[] | undefined): number[] {
  return [...new Set((values ?? []).map(Number).filter(isDbId))]
}

function names(values: string[] | undefined): string[] {
  return [...new Set((values ?? []).map(nameKey).filter(Boolean))]
}

type PaymentRow = {
  id: number
  doc_no: string | number | null
  op: number
  ts_s: string
  cby: string | null
  supplier_id: number | null
  supplier_name: string | null
  organization: string
  branch: string
  amount: number
  cur: string
  internal_amount: number | null
  rate: number | null
  cash_amount: number | null
  cash_cur: string | null
  cash_rate: number | null
  cashbox_id: number | null
  cashbox_name: string | null
  pt: "cash" | "bank"
  category: string | null
  comment: string | null
  supply_id: number | null
  money_request_id: number | null
  verified: boolean
}

function toItem(row: PaymentRow, base: string): SupplierPaymentItem {
  const amount = roundMoney(num(row.amount), 5)
  const currency = normCurrency(row.cur, base)
  const internal = numOrNull(row.internal_amount)
  const rate = currency === base ? 1 : numOrNull(row.rate)
  const baseAmount = currency === base ? amount : internal !== null ? internal : rate ? roundMoney(amount * rate, 5) : null
  const cashAmount = numOrNull(row.cash_amount)
  const cashCurrency = row.cash_cur ? normCurrency(row.cash_cur, base) : null
  let cash: SupplierPaymentItem["cash"] = null
  if (cashAmount !== null && cashCurrency) {
    const value = roundMoney(Math.abs(cashAmount), 5)
    const cashRate = cashCurrency === base ? 1 : numOrNull(row.cash_rate)
    const cashBase = cashCurrency === base ? value : internal !== null ? Math.abs(internal) : cashRate ? roundMoney(value * cashRate, 5) : null
    cash = { amount: value, currency: cashCurrency, baseAmount: cashBase, rate: cashRate }
  }
  const docNo = row.doc_no === null || row.doc_no === undefined ? null : Number(row.doc_no)
  return {
    id: row.id,
    docNo,
    type: num(row.op),
    date: row.ts_s,
    createdBy: row.cby ?? "",
    supplier: { id: row.supplier_id ?? null, name: row.supplier_name ?? "" },
    organization: row.organization ?? "",
    branch: row.branch ?? "",
    amount,
    currency,
    baseAmount,
    rate,
    cash,
    cashbox: row.cashbox_name ? { id: row.cashbox_id ?? null, name: row.cashbox_name, linked: row.cashbox_id !== null && docNo !== null } : null,
    paymentType: row.pt === "bank" ? "bank" : "cash",
    category: row.category ?? "",
    comment: row.comment ?? "",
    supplyId: row.supply_id ?? null,
    moneyRequestId: row.money_request_id ?? null,
    isVerified: Boolean(row.verified),
  }
}

/** Paged list + totals strip (demo provider_transactions/ and /total/ with type=1). */
export async function listSupplierPaymentsPage(query: SupplierPaymentsQuery, db: PgDb = getDb()): Promise<SupplierPaymentsResult> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const base = cc.base
  const { page, pageSize } = pageOf(query.page, query.pageSize, 25, MAX_ROWS)
  const search = nameKey(query.search)
  const params = {
    base,
    from: query.from ?? "",
    to: query.to ?? "",
    orgs: names(query.organizations),
    branches: names(query.branches),
    suppliers: ids(query.supplierIds),
    currency: query.currency ? normCurrency(query.currency, base) : "",
    q: search,
    qnum: /^\d{1,15}$/.test(search) ? Number(search) : -1,
  }
  const ref = (await db.prepare("SELECT to_regclass('supplier_payment_reference_rows') IS NOT NULL AND to_regclass('demo_seed_rows') IS NOT NULL AS ok").get()) as { ok: boolean }
  const PAYMENTS_CTE = buildPaymentsCte(Boolean(ref.ok))
  const count = (await db.prepare(`${PAYMENTS_CTE} SELECT COUNT(*)::int AS n FROM f`).get(params)) as { n: number }
  const paging = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ` LIMIT ${MAX_ROWS}`
  const rows = (await db
    .prepare(`${PAYMENTS_CTE} SELECT f.*, COALESCE(to_char(f.ts, 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS ts_s FROM f ORDER BY ${orderBy(query.ordering)}${paging}`)
    .all(params)) as PaymentRow[]
  const totals = (await db
    .prepare(`${PAYMENTS_CTE} SELECT f.cur, SUM(f.amount)::float8 AS total, COUNT(*)::int AS n FROM f WHERE f.verified GROUP BY f.cur`)
    .all(params)) as Array<{ cur: string; total: number; n: number }>
  const order = cc.currencies.map((currency) => currency.code)
  const rank = (code: string) => (code === base ? -1 : order.includes(code) ? order.indexOf(code) : order.length)
  const totalRows: SupplierPaymentsTotal[] = totals
    .map((row) => ({ currency: normCurrency(row.cur, base), total: roundMoney(num(row.total), 5), count: num(row.n) }))
    .sort((a, b) => rank(a.currency) - rank(b.currency) || a.currency.localeCompare(b.currency))
  return { baseCurrency: base, count: num(count.n), page, pageSize, rows: rows.map((row) => toItem(row, base)), totals: totalRows }
}

/** Filter choices (Организация, Филиалы, Поставщик, Валюта): the lookup tables plus values found in payments. */
export async function supplierPaymentsOptions(db: PgDb = getDb()): Promise<SupplierPaymentsOptions> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const has = async (table: string) => ((await db.prepare("SELECT to_regclass(@table) IS NOT NULL AS ok").get({ table })) as { ok: boolean }).ok
  const collect = (values: Array<string | null | undefined>) => {
    const seen = new Map<string, string>()
    for (const value of values) {
      const text = String(value ?? "").trim()
      const key = nameKey(text)
      if (key && !seen.has(key)) seen.set(key, text)
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b, "ru"))
  }
  const orgRows = (await has("organizations")) ? ((await db.prepare("SELECT name FROM organizations").all()) as Array<{ name: string }>) : []
  const branchRows = (await has("branches")) ? ((await db.prepare("SELECT name FROM branches").all()) as Array<{ name: string }>) : []
  const used = (await db
    .prepare(
      `SELECT fin_place(sp.organization) AS organization, fin_place(sp.branch) AS branch, fin_place(cb.branch) AS cb_branch,
              fin_cur(NULLIF(sp.currency, '')) AS cur
       FROM supplier_payments sp LEFT JOIN cashboxes cb ON cb.id = sp.cashbox_id
       WHERE sp.is_deleted = 0 AND COALESCE(sp.op_type, 5) <> 4
       GROUP BY 1, 2, 3, 4`,
    )
    .all()) as Array<{ organization: string; branch: string; cb_branch: string | null; cur: string | null }>
  const suppliers = (await has("suppliers"))
    ? ((await db.prepare("SELECT id, name FROM suppliers WHERE btrim(name) <> '' ORDER BY lower(name), id").all()) as Array<{ id: number; name: string }>)
    : []
  const currencies = [...new Set([cc.base, ...cc.currencies.map((currency) => currency.code), ...used.map((row) => (row.cur ? normCurrency(row.cur, cc.base) : "")).filter(Boolean)])]
  return {
    baseCurrency: cc.base,
    organizations: collect([...orgRows.map((row) => row.name), ...used.map((row) => row.organization)]),
    branches: collect([...branchRows.map((row) => row.name), ...used.flatMap((row) => [row.branch, row.cb_branch])]),
    suppliers: suppliers.map((row) => ({ id: row.id, name: row.name })),
    currencies,
  }
}

/** Amount of a payment in the supply currency ("На поставку"); same rule as recomputeSupplyPaid (current rates, 1:1 when unknown). */
function allocate(amount: number, currency: string, supplyCurrency: string, cc: Awaited<ReturnType<typeof currencyContext>>): number {
  if (currency === supplyCurrency) return amount
  const from = pickRate(currency, cc)
  const to = pickRate(supplyCurrency, cc)
  return from && to ? (amount * from) / to : amount
}

/** "Оплачено" per supply: Σ live verified payments linked to it, in the supply currency. */
export async function paidBySupply(supplyIds: number[] | null = null, db: PgDb = getDb()): Promise<Map<number, number>> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const rows = (await db
    .prepare(
      `SELECT sp.supply_id AS id, COALESCE(fin_cur(NULLIF(sp.currency, '')), @base::text) AS cur, i.currency AS supply_cur, SUM(sp.amount)::float8 AS amount
       FROM supplier_payments sp JOIN supplier_incomings i ON i.id = sp.supply_id
       WHERE sp.supply_id IS NOT NULL AND sp.is_deleted = 0 AND sp.is_verified <> 0
         AND (@all::boolean OR sp.supply_id = ANY(@ids::int[]))
       GROUP BY 1, 2, 3`,
    )
    .all({ base: cc.base, all: supplyIds === null, ids: ids(supplyIds ?? []) })) as Array<{ id: number; cur: string; supply_cur: string | null; amount: number }>
  const out = new Map<number, number>()
  for (const row of rows) {
    const value = allocate(num(row.amount), normCurrency(row.cur, cc.base), normCurrency(row.supply_cur, cc.base), cc)
    out.set(row.id, (out.get(row.id) ?? 0) + value)
  }
  for (const [id, value] of out) out.set(id, roundMoney(value))
  return out
}

/** "Список оплат по поставке №N" (demo provider_debt_separations/?supply=N); null when the supply does not exist. */
export async function listSupplyPayments(supplyId: number, db: PgDb = getDb()): Promise<SupplyPaymentsResult | null> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const supply = (await db.prepare("SELECT id, amount, currency FROM supplier_incomings WHERE id = @id").get({ id: supplyId })) as
    | { id: number; amount: number; currency: string | null }
    | undefined
  if (!supply) return null
  const supplyCurrency = normCurrency(supply.currency, cc.base)
  const rows = (await db
    .prepare(
      `WITH ${RATES_CTE}
       SELECT sp.id, sp.doc_no::bigint AS doc_no, COALESCE(sp.op_type, 5) AS op,
         COALESCE(to_char(COALESCE(fin_ts(sp.paid_at), fin_ts(NULLIF(sp.payment_date, '')), fin_ts(sp.created_at, true)), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS ts_s,
         COALESCE(s.name, sp.supplier) AS supplier, sp.created_by AS cby, CASE WHEN sp.comment = 'Не указано' THEN '' ELSE sp.comment END AS comment,
         sp.amount::float8 AS amount, COALESCE(fin_cur(NULLIF(sp.currency, '')), @base::text) AS cur, sp.internal_amount::float8 AS internal_amount,
         COALESCE(sp.debt_rate, CASE WHEN fin_cur(NULLIF(sp.real_currency, '')) = COALESCE(fin_cur(NULLIF(sp.currency, '')), @base::text) THEN sp.custom_rate END,
                  ${RATE("COALESCE(fin_cur(NULLIF(sp.currency, '')), @base::text)")})::float8 AS rate,
         COALESCE(cb.name, sp.kassa, '') AS cashbox
       FROM supplier_payments sp
       LEFT JOIN suppliers s ON s.id = sp.supplier_id
       LEFT JOIN cashboxes cb ON cb.id = sp.cashbox_id
       WHERE sp.supply_id = @id AND sp.is_deleted = 0 AND sp.is_verified <> 0
       ORDER BY 4, sp.id`,
    )
    .all({ base: cc.base, id: supplyId })) as Array<{
    id: number
    doc_no: string | number | null
    op: number
    ts_s: string
    supplier: string | null
    cby: string | null
    comment: string | null
    amount: number
    cur: string
    internal_amount: number | null
    rate: number | null
    cashbox: string | null
  }>
  const items: SupplyPaymentItem[] = rows.map((row) => {
    const amount = roundMoney(num(row.amount), 5)
    const currency = normCurrency(row.cur, cc.base)
    const rate = currency === cc.base ? 1 : numOrNull(row.rate)
    const internal = numOrNull(row.internal_amount)
    return {
      id: row.id,
      docNo: row.doc_no === null || row.doc_no === undefined ? null : Number(row.doc_no),
      type: num(row.op),
      date: row.ts_s,
      supplier: row.supplier ?? "",
      createdBy: row.cby ?? "",
      comment: row.comment ?? "",
      amount,
      currency,
      baseAmount: currency === cc.base ? amount : internal !== null ? internal : rate ? roundMoney(amount * rate, 5) : null,
      rate,
      allocated: roundMoney(allocate(amount, currency, supplyCurrency, cc)),
      cashbox: row.cashbox ?? "",
    }
  })
  return {
    supplyId,
    supplyCurrency,
    baseCurrency: cc.base,
    total: roundMoney(num(supply.amount)),
    paid: roundMoney(items.reduce((sum, item) => sum + item.allocated, 0)),
    rows: items,
  }
}

/** GET query of /api/cash/supplier-payments: from to (YYYY-MM-DD) organization* branch* (names, repeated)
 * supplier* (ids, repeated or "1-2-3") currency search ordering page pageSize. */
export function parseSupplierPaymentsQuery(url: string): { data: SupplierPaymentsQuery; error?: undefined } | { data?: undefined; error: { field: string; hint: string } } {
  const search = new URL(url).searchParams
  // A real calendar day (isIsoDay round-trips it: 2026-02-31 is refused, not rolled over to March).
  const day = (name: string) => {
    const value = search.get(name)?.trim() ?? ""
    if (!value) return { ok: true as const, value: undefined }
    return isIsoDay(value) ? { ok: true as const, value } : { ok: false as const }
  }
  const from = day("from")
  if (!from.ok) return { error: { field: "from", hint: "YYYY-MM-DD" } }
  const to = day("to")
  if (!to.ok) return { error: { field: "to", hint: "YYYY-MM-DD" } }
  const texts = (name: string) => search.getAll(name).map((value) => value.trim()).filter(Boolean)
  const int = (name: string) => {
    const value = Number(search.get(name))
    return search.get(name) && Number.isFinite(value) ? Math.floor(value) : undefined
  }
  const page = int("page")
  const pageSize = int("pageSize")
  return {
    data: {
      from: from.value,
      to: to.value,
      organizations: texts("organization"),
      branches: texts("branch"),
      supplierIds: texts("supplier")
        .flatMap((value) => value.split(/[,-]/))
        .map((value) => Number(value.trim()))
        .filter(isDbId),
      currency: search.get("currency")?.trim() || undefined,
      search: search.get("search")?.trim() || undefined,
      ordering: search.get("ordering")?.trim() || undefined,
      page: page === undefined ? undefined : Math.min(MAX_PAGE, Math.max(1, page)),
      pageSize: pageSize === undefined || pageSize < 0 ? undefined : Math.min(MAX_PAGE_SIZE, pageSize),
    },
  }
}
