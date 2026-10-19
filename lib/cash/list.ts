import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey } from "@/lib/finance/entities"
import { currencyContext, loadCategories, num, numOrNull, type CategoryInfo } from "@/lib/cash/common"
import { ensureCashSchema } from "@/lib/cash/schema"
import {
  CASH_OP_LABELS,
  operationKey,
  parseOperationKey,
  type CashListResult,
  type CashOperation,
  type CashOpType,
  type CashPaymentType,
  type CashSource,
  type CashTotalsResult,
  type CashTotalsRow,
} from "@/lib/cash/types"

// Read model of "Управления кассой": a UNION ALL over the four tables that own
// cash money (cash_management_entries, customer_payments with a cashbox and
// not inside an acceptance batch, cash_acceptances, supplier_payments with a
// cashbox), one uniform row per operation, amounts signed from the cashbox's
// point of view in the cashbox currency. Lists show deleted (withDeleted) and
// unverified rows; totals never count them. The ledger (lib/finance) keeps
// reading the base tables, so this file never affects balances.

export type CashListQuery = {
  cashboxIds?: number[]
  /** Operation types (CASH_OP). */
  types?: number[]
  /** Branch names (operation branch, else the cashbox branch). */
  branches?: string[]
  /** Organization (division) names; strict. */
  organizations?: string[]
  expenseCategoryIds?: number[]
  incomeCategoryIds?: number[]
  paymentType?: CashPaymentType | ""
  clientIds?: number[]
  supplierIds?: number[]
  /** employees.id: responsible person, acceptance agent or staff allocation. */
  staffIds?: number[]
  /** ISO days on the business date, inclusive. */
  from?: string
  to?: string
  withDeleted?: boolean
  /** Only operations of internal expense categories (expense_categories.direct, demo internal_transfer). */
  internalTransfer?: boolean
  /** Only real expenses: outflows that are not transfers, not internal and not excluded from P&L. */
  onlyNotInternal?: boolean
  /** Digits only = "№" (doc_no, exact; other pages link with ?search=<№>); else a case-insensitive substring of
   * comment / client / supplier / category / cashbox / employee / description / organization / branch. */
  search?: string
  /** Only unverified, not deleted operations (clock dialog). */
  unverified?: boolean
  sources?: CashSource[]
  /** id | date | amount, "-" prefix = descending. Default "-id" (newest № first). */
  ordering?: string
  page?: number
  /** Default 25; 0 = all. */
  pageSize?: number
}

const RATE = (code: string) => `(SELECT r.rate FROM rates r WHERE r.code = ${code})`

/** Cash side of a customer/supplier payment in the cashbox currency (same rule as the ledger). */
const CASH_SIDE = (alias: string) => `CASE WHEN ${alias}.real_amount IS NOT NULL AND fin_cur(NULLIF(${alias}.real_currency, '')) = cb.cur THEN ${alias}.real_amount::float8
  WHEN COALESCE(fin_cur(${alias}.currency), cb.cur) = cb.cur THEN ${alias}.amount::float8
  ELSE ${alias}.amount::float8 * COALESCE(${RATE(`fin_cur(${alias}.currency)`)} / NULLIF(${RATE("cb.cur")}, 0), 1) END`

const ISO = (expr: string) => `COALESCE(to_char(${expr}, 'YYYY-MM-DD"T"HH24:MI:SS'), '')`

/** "WITH … f AS (…)": the filtered union (alias f); bind cashListParams(). For read-only reports. */
export const OPS_CTE = `WITH
rates AS (
  SELECT c.code, CASE WHEN c.code = @base::text THEN 1::float8 ELSE c.rate END AS rate
  FROM (SELECT fin_cur(code) AS code, MAX(rate)::float8 AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1) c
  UNION ALL SELECT @base::text, 1::float8 WHERE NOT EXISTS (SELECT 1 FROM currencies WHERE fin_cur(code) = @base::text)
),
cbx AS (
  SELECT id, name, COALESCE(fin_cur(currency), @base::text) AS cur, CASE WHEN fin_pt(payment_type) = 'bank' THEN 'bank' ELSE 'cash' END AS pt,
         fin_place(branch) AS branch
  FROM cashboxes
),
cbk AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1),
ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1),
sk AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM suppliers GROUP BY 1),
ecn AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, direct, exclude_from_pnl FROM expense_categories ORDER BY fin_key(name), id),
ops AS (
  SELECT 'cash'::text AS src, e.id, e.doc_no::bigint AS doc_no,
    COALESCE(e.op_type, CASE WHEN e.category = 'Перевод' THEN (CASE WHEN e.amount < 0 THEN 1 ELSE 2 END)
      WHEN e.category = 'Клиент' AND e.amount >= 0 THEN 6 WHEN e.client_name <> '' AND e.amount < 0 THEN 7
      WHEN e.amount >= 0 THEN 4 ELSE 5 END) AS op,
    COALESCE(fin_ts(e.entry_date), fin_ts(e.created_at, true)) AS ts, fin_ts(e.created_at, true) AS cts, e.created_by AS cby,
    cb.id AS cashbox_id, cb.name AS cashbox_name, cb.cur, cb.pt, cb.branch AS cb_branch,
    e.amount::float8 AS amount,
    COALESCE(e.internal_amount, e.amount::float8 * ${RATE("cb.cur")}) AS base_amount,
    COALESCE(e.custom_rate, ${RATE("cb.cur")}) AS rate,
    NULL::float8 AS debt_amount, ''::text AS debt_cur,
    COALESCE(e.client_id, ck.id) AS client_id, e.client_name AS client_name, NULL::int AS supplier_id, ''::text AS supplier_name,
    COALESCE(e.income_category_id, e.expense_category_id) AS category_id,
    CASE WHEN e.income_category_id IS NOT NULL THEN 'income' WHEN e.expense_category_id IS NOT NULL THEN 'expense' ELSE '' END AS category_kind,
    CASE WHEN e.category = 'Перевод' OR COALESCE(e.op_type, 0) IN (1, 2) THEN '' ELSE e.category END AS category_name,
    fin_place(e.branch) AS branch, fin_place(e.organization) AS organization, e.comment, e.description,
    e.employee_id, e.employee_name, e.transfer_id, NULL::int AS order_id, e.supply_id, e.supply_expense_id, NULL::int AS money_request_id,
    ''::text AS contract, e.amortization_from, e.amortization_to,
    (e.is_verified <> 0) AS verified, (e.is_deleted <> 0) AS deleted, ${ISO("fin_ts(NULLIF(e.verified_at, ''))")} AS verified_at,
    ${ISO("fin_ts(NULLIF(e.deleted_at, ''))")} AS deleted_at, NULL::int AS agent_cashbox_id, 0::int AS payment_count
  FROM cash_management_entries e JOIN cbx cb ON cb.id = e.cashbox_id
  LEFT JOIN ck ON e.client_id IS NULL AND e.client_name <> '' AND ck.k = fin_key(e.client_name)
  UNION ALL
  SELECT 'customer', p.id, p.doc_no::bigint, COALESCE(p.op_type, CASE WHEN p.order_id IS NOT NULL THEN 3 ELSE 6 END),
    CASE WHEN p.accepted = 1 THEN COALESCE(fin_ts(p.accepted_at), fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true))
         ELSE COALESCE(fin_ts(NULLIF(p.payment_date, '')), fin_ts(p.paid_at), fin_ts(p.created_at, true)) END,
    fin_ts(p.created_at, true), p.created_by,
    cb.id, cb.name, cb.cur, cb.pt, cb.branch,
    ${CASH_SIDE("p")},
    COALESCE(p.amount_sum_equivalent::float8, (${CASH_SIDE("p")}) * ${RATE("cb.cur")}),
    COALESCE(p.custom_rate, ${RATE("cb.cur")}),
    p.amount::float8, COALESCE(fin_cur(p.currency), @base::text),
    COALESCE(p.client_id, ck.id), p.client, NULL::int, '',
    p.income_category_id, CASE WHEN p.income_category_id IS NOT NULL THEN 'income' ELSE '' END, p.income_category,
    fin_place(p.branch), fin_place(p.organization), CASE WHEN p.comment = 'Не указано' THEN '' ELSE p.comment END, '',
    p.delivery_man_id, p.delivery_man, NULL::int, p.order_id, NULL::int, NULL::int, NULL::int, p.contract, '', '',
    (p.accepted = 1), (p.is_deleted <> 0), CASE WHEN p.accepted = 1 THEN ${ISO("fin_ts(p.accepted_at)")} ELSE '' END,
    ${ISO("fin_ts(NULLIF(p.deleted_at, ''))")}, p.agent_cashbox_id, 0
  FROM customer_payments p LEFT JOIN cbk ON cbk.k = fin_key(p.kassa) JOIN cbx cb ON cb.id = COALESCE(p.cashbox_id, cbk.id)
  LEFT JOIN ck ON p.client_id IS NULL AND ck.k = fin_key(p.client)
  WHERE p.accept_id IS NULL
  UNION ALL
  SELECT 'acceptance', a.id, a.doc_no::bigint, 8, COALESCE(fin_ts(a.date), fin_ts(a.created_at, true)), fin_ts(a.created_at, true), a.created_by,
    cb.id, cb.name, cb.cur, cb.pt, cb.branch,
    CASE WHEN a.is_deleted <> 0 THEN a.amount::float8 ELSE COALESCE(x.amount, 0) END,
    CASE WHEN a.is_deleted <> 0 THEN a.amount::float8 * ${RATE("cb.cur")} ELSE x.base_amount END,
    ${RATE("cb.cur")}, NULL::float8, '',
    NULL::int, '', NULL::int, '', NULL::int, '', '',
    fin_place(a.branch), fin_place(a.organization), a.comment, '',
    a.agent_id, a.agent, NULL::int, NULL::int, NULL::int, NULL::int, NULL::int, '', '', '',
    true, (a.is_deleted <> 0), '', ${ISO("fin_ts(NULLIF(a.deleted_at, ''))")}, a.agent_cashbox_id, COALESCE(x.n, 0)
  FROM cash_acceptances a JOIN cbx cb ON cb.id = a.cashbox_id
  LEFT JOIN LATERAL (
    SELECT SUM(${CASH_SIDE("p")}) AS amount,
           SUM(COALESCE(p.amount_sum_equivalent::float8, (${CASH_SIDE("p")}) * ${RATE("cb.cur")})) AS base_amount, COUNT(*)::int AS n
    FROM customer_payments p WHERE p.accept_id = a.id AND p.is_deleted = 0
  ) x ON true
  UNION ALL
  SELECT 'supplier', sp.id, sp.doc_no::bigint, COALESCE(sp.op_type, 5),
    COALESCE(fin_ts(sp.paid_at), fin_ts(NULLIF(sp.payment_date, '')), fin_ts(sp.created_at, true)), fin_ts(sp.created_at, true), sp.created_by,
    cb.id, cb.name, cb.cur, cb.pt, cb.branch,
    -(${CASH_SIDE("sp")}),
    -(COALESCE(sp.internal_amount, (${CASH_SIDE("sp")}) * ${RATE("cb.cur")})),
    COALESCE(sp.custom_rate, ${RATE("cb.cur")}),
    sp.amount::float8, COALESCE(fin_cur(sp.currency), @base::text),
    NULL::int, '', COALESCE(sp.supplier_id, sk.id), sp.supplier,
    COALESCE(sp.expense_category_id, sp.income_category_id),
    CASE WHEN sp.expense_category_id IS NOT NULL THEN 'expense' WHEN sp.income_category_id IS NOT NULL THEN 'income' ELSE '' END, sp.category,
    fin_place(sp.branch), fin_place(sp.organization), CASE WHEN sp.comment = 'Не указано' THEN '' ELSE sp.comment END, '',
    NULL::int, '', NULL::int, NULL::int, sp.supply_id, NULL::int, sp.money_request_id, '', '', '',
    (sp.is_verified <> 0), (sp.is_deleted <> 0), ${ISO("fin_ts(NULLIF(sp.verified_at, ''))")}, ${ISO("fin_ts(NULLIF(sp.deleted_at, ''))")}, NULL::int, 0
  FROM supplier_payments sp LEFT JOIN cbk ON cbk.k = fin_key(sp.kassa) JOIN cbx cb ON cb.id = COALESCE(sp.cashbox_id, cbk.id)
  LEFT JOIN sk ON sp.supplier_id IS NULL AND sk.k = fin_key(sp.supplier)
),
ops2 AS (
  SELECT o.*, COALESCE(ec.direct, en.direct, 0) <> 0 AS internal, COALESCE(ec.exclude_from_pnl, en.exclude_from_pnl, 0) <> 0 AS no_pnl
  FROM ops o
  LEFT JOIN expense_categories ec ON o.category_kind = 'expense' AND ec.id = o.category_id
  LEFT JOIN ecn en ON o.category_kind = '' AND o.amount < 0 AND en.k = fin_key(o.category_name)
),
f AS (
  SELECT o.* FROM ops2 o
  WHERE (@withDeleted::boolean OR NOT o.deleted)
    AND (NOT @unverified::boolean OR (NOT o.verified AND NOT o.deleted))
    AND (@onlyId::int IS NULL OR (o.src = @onlySrc::text AND o.id = @onlyId::int))
    AND (cardinality(@sources::text[]) = 0 OR o.src = ANY(@sources::text[]))
    AND (cardinality(@cashboxes::int[]) = 0 OR o.cashbox_id = ANY(@cashboxes::int[]))
    AND (cardinality(@types::int[]) = 0 OR o.op = ANY(@types::int[]))
    AND (cardinality(@branches::text[]) = 0 OR fin_key(COALESCE(NULLIF(o.branch, ''), o.cb_branch)) = ANY(@branches::text[]))
    AND (cardinality(@orgs::text[]) = 0 OR fin_key(o.organization) = ANY(@orgs::text[]))
    AND (@pt::text = '' OR o.pt = @pt::text)
    AND (cardinality(@clients::int[]) = 0 OR o.client_id = ANY(@clients::int[]))
    AND (cardinality(@suppliers::int[]) = 0 OR o.supplier_id = ANY(@suppliers::int[]))
    AND (cardinality(@staff::int[]) = 0 OR o.employee_id = ANY(@staff::int[])
         OR (o.src = 'cash' AND EXISTS (SELECT 1 FROM cash_entry_staff s WHERE s.entry_id = o.id AND s.employee_id = ANY(@staff::int[]))))
    AND (@from::text = '' OR o.ts::date >= NULLIF(@from::text, '')::date)
    AND (@to::text = '' OR o.ts::date <= NULLIF(@to::text, '')::date)
    AND (cardinality(@expCats::int[]) + cardinality(@incCats::int[]) = 0
         OR (o.category_kind = 'expense' AND o.category_id = ANY(@expCats::int[]))
         OR (o.category_kind = 'income' AND o.category_id = ANY(@incCats::int[]))
         OR (o.category_kind = '' AND o.amount < 0 AND fin_key(o.category_name) = ANY(@expCatNames::text[]))
         OR (o.category_kind = '' AND o.amount >= 0 AND fin_key(o.category_name) = ANY(@incCatNames::text[])))
    AND (NOT @internal::boolean OR o.internal)
    AND (NOT @onlyReal::boolean OR (o.amount < 0 AND o.op NOT IN (1, 2) AND NOT o.internal AND NOT o.no_pnl))
    AND (@q::text = '' OR (@qnum::bigint >= 0 AND o.doc_no = @qnum::bigint)
         OR (@qnum::bigint < 0 AND strpos(fin_key(concat_ws(' ', o.comment, o.client_name, o.supplier_name, o.category_name, o.cashbox_name,
                                     o.employee_name, o.description, o.organization, o.branch)), @q::text) > 0))
)`

const ORDER_FIELDS: Record<string, string> = { id: "o.doc_no", date: "o.ts", amount: "o.amount" }

function orderBy(ordering: string | undefined): string {
  const text = String(ordering ?? "").trim() || "-id"
  const desc = text.startsWith("-")
  const field = ORDER_FIELDS[text.replace(/^-/, "")] ?? "o.doc_no"
  return `${field} ${desc ? "DESC" : "ASC"} NULLS LAST, o.doc_no ${desc ? "DESC" : "ASC"}`
}

type Params = Record<string, unknown>

function ids(values: number[] | undefined): number[] {
  return (values ?? []).map(Number).filter((value) => Number.isInteger(value) && value > 0)
}

/** Bind values of OPS_CTE for a query. */
export function buildParams(query: CashListQuery, base: string, categories: CategoryInfo[]): Params {
  const expCats = ids(query.expenseCategoryIds)
  const incCats = ids(query.incomeCategoryIds)
  const search = nameKey(query.search)
  return {
    base,
    withDeleted: Boolean(query.withDeleted),
    unverified: Boolean(query.unverified),
    onlyId: null,
    onlySrc: "",
    sources: query.sources ?? [],
    cashboxes: ids(query.cashboxIds),
    types: ids(query.types),
    branches: (query.branches ?? []).map(nameKey).filter(Boolean),
    orgs: (query.organizations ?? []).map(nameKey).filter(Boolean),
    pt: query.paymentType ?? "",
    clients: ids(query.clientIds),
    suppliers: ids(query.supplierIds),
    staff: ids(query.staffIds),
    from: query.from ?? "",
    to: query.to ?? "",
    expCats,
    incCats,
    // Legacy rows carry only the category name.
    expCatNames: categories.filter((c) => c.kind === "expense" && expCats.includes(c.id)).map((c) => nameKey(c.name)),
    incCatNames: categories.filter((c) => c.kind === "income" && incCats.includes(c.id)).map((c) => nameKey(c.name)),
    internal: Boolean(query.internalTransfer),
    onlyReal: Boolean(query.onlyNotInternal),
    q: search,
    qnum: /^\d{1,15}$/.test(search) ? Number(search) : -1,
  }
}

type OpRow = {
  src: CashSource
  id: number
  doc_no: string | number
  op: number
  ts_s: string
  cts_s: string
  cby: string
  cashbox_id: number
  cashbox_name: string
  cur: string
  pt: CashPaymentType
  cb_branch: string
  amount: number
  base_amount: number | null
  rate: number | null
  debt_amount: number | null
  debt_cur: string
  client_id: number | null
  client_name: string | null
  supplier_id: number | null
  supplier_name: string | null
  category_id: number | null
  category_kind: "income" | "expense" | ""
  category_name: string | null
  branch: string
  organization: string
  comment: string | null
  description: string | null
  employee_id: number | null
  employee_name: string | null
  transfer_id: number | null
  order_id: number | null
  supply_id: number | null
  supply_expense_id: number | null
  money_request_id: number | null
  contract: string | null
  amortization_from: string | null
  amortization_to: string | null
  verified: boolean
  deleted: boolean
  verified_at: string
  deleted_at: string
  agent_cashbox_id: number | null
  payment_count: number
  has_children: boolean
  has_staff: boolean
}

const PAGE_SELECT = `SELECT o.*, ${ISO("o.ts")} AS ts_s, ${ISO("o.cts")} AS cts_s,
  (o.src = 'cash' AND EXISTS (SELECT 1 FROM cash_entry_children c WHERE c.entry_id = o.id)) AS has_children,
  (o.src = 'cash' AND EXISTS (SELECT 1 FROM cash_entry_staff s WHERE s.entry_id = o.id)) AS has_staff
FROM f o`

async function transferInfo(db: PgDb, rows: OpRow[]) {
  const transferIds = [...new Set(rows.map((row) => row.transfer_id).filter((id): id is number => Boolean(id)))]
  if (!transferIds.length) return new Map<number, { from: string; to: string; accFrom: string; accTo: string }>()
  const list = (await db
    .prepare(
      `SELECT t.id, f.name AS from_name, tt.name AS to_name, t.accumulated_from, t.accumulated_to
       FROM cash_transfers t LEFT JOIN cashboxes f ON f.id = t.from_cashbox_id LEFT JOIN cashboxes tt ON tt.id = t.to_cashbox_id
       WHERE t.id = ANY(@ids::int[])`,
    )
    .all({ ids: transferIds })) as Array<{ id: number; from_name: string | null; to_name: string | null; accumulated_from: string; accumulated_to: string }>
  return new Map(list.map((t) => [t.id, { from: t.from_name ?? "", to: t.to_name ?? "", accFrom: t.accumulated_from, accTo: t.accumulated_to }]))
}

function legacyOtherCashbox(description: string | null): string {
  const match = /^Перевод (?:в|из|с|на)\s+(.+)$/i.exec(String(description ?? "").trim())
  return match ? match[1] : ""
}

function toOperation(row: OpRow, base: string, categories: Map<string, CategoryInfo>, transfers: Map<number, { from: string; to: string; accFrom: string; accTo: string }>): CashOperation {
  const type = row.op as CashOpType
  const source = row.src
  const isTransfer = type === 1 || type === 2
  const category = row.category_id ? categories.get(`${row.category_kind}:${row.category_id}`) : undefined
  const transfer = isTransfer
    ? row.transfer_id && transfers.has(row.transfer_id)
      ? {
          id: row.transfer_id,
          otherCashbox: type === 1 ? transfers.get(row.transfer_id)!.to : transfers.get(row.transfer_id)!.from,
          accumulatedFrom: transfers.get(row.transfer_id)!.accFrom,
          accumulatedTo: transfers.get(row.transfer_id)!.accTo,
        }
      : { id: null, otherCashbox: legacyOtherCashbox(row.description), accumulatedFrom: "", accumulatedTo: "" }
    : null
  const amount = roundMoney(num(row.amount))
  const deleted = Boolean(row.deleted)
  return {
    key: operationKey(source, row.id),
    source,
    id: row.id,
    docNo: Number(row.doc_no),
    type,
    title: CASH_OP_LABELS[type] ?? "",
    date: row.ts_s,
    createdAt: row.cts_s,
    createdBy: row.cby ?? "",
    cashbox: { id: row.cashbox_id, name: row.cashbox_name, type: row.pt, currency: row.cur, branch: row.cb_branch ?? "" },
    amount,
    currency: row.cur,
    baseAmount: row.base_amount === null ? null : roundMoney(num(row.base_amount)),
    baseCurrency: base,
    rate: numOrNull(row.rate),
    debtAmount: row.debt_amount === null || (row.debt_cur === row.cur && Math.abs(num(row.debt_amount) - Math.abs(amount)) < 0.005) ? null : roundMoney(num(row.debt_amount)),
    debtCurrency: row.debt_cur ?? "",
    client: row.client_id || row.client_name ? { id: row.client_id, name: row.client_name ?? "" } : null,
    supplier: row.supplier_id || row.supplier_name ? { id: row.supplier_id, name: row.supplier_name ?? "" } : null,
    category:
      row.category_name || category
        ? { id: category?.id ?? row.category_id ?? null, name: category?.name ?? row.category_name ?? "", kind: row.category_kind, options: category?.options ?? [] }
        : null,
    branch: row.branch ?? "",
    organization: row.organization ?? "",
    comment: row.comment ?? "",
    employee: row.employee_id || row.employee_name ? { id: row.employee_id, name: row.employee_name ?? "" } : null,
    transfer,
    orderId: row.order_id,
    supplyId: row.supply_id,
    supplyExpenseId: row.supply_expense_id,
    moneyRequestId: row.money_request_id,
    contract: row.contract ?? "",
    amortization: row.amortization_from || row.amortization_to ? { from: row.amortization_from ?? "", to: row.amortization_to ?? "" } : null,
    isVerified: Boolean(row.verified),
    isDeleted: deleted,
    verifiedAt: row.verified_at ?? "",
    deletedAt: row.deleted_at ?? "",
    hasChildren: Boolean(row.has_children),
    hasStaff: Boolean(row.has_staff),
    paymentCount: num(row.payment_count),
    canEdit: !deleted && !isTransfer,
    canDuplicate: !deleted && !isTransfer && type !== 8,
    canDelete: !deleted,
    canPrint: !deleted && type !== 2,
  }
}

async function categoryMap(db: PgDb): Promise<{ list: CategoryInfo[]; map: Map<string, CategoryInfo> }> {
  const list = await loadCategories(db)
  return { list, map: new Map(list.map((category) => [`${category.kind}:${category.id}`, category])) }
}

/** The cash page list (and the unverified dialog with `unverified: true`). */
export async function listCashOperations(query: CashListQuery, db: PgDb = getDb()): Promise<CashListResult> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const { list, map } = await categoryMap(db)
  const params = buildParams(query, cc.base, list)
  const pageSize = query.pageSize === 0 ? 0 : Math.min(Math.max(1, Math.floor(query.pageSize ?? 25)), 5000)
  const page = Math.max(1, Math.floor(query.page ?? 1))
  const countRow = (await db.prepare(`${OPS_CTE} SELECT count(*)::int AS n FROM f`).get(params)) as { n: number }
  const paging = pageSize ? ` LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : ""
  const rows = (await db.prepare(`${OPS_CTE} ${PAGE_SELECT} ORDER BY ${orderBy(query.ordering)}${paging}`).all(params)) as OpRow[]
  const transfers = await transferInfo(db, rows)
  return { baseCurrency: cc.base, count: num(countRow.n), page, pageSize, rows: rows.map((row) => toOperation(row, cc.base, map, transfers)) }
}

/** Number of unverified (not deleted) operations — the clock badge. */
export async function countUnverifiedOperations(db: PgDb = getDb()): Promise<number> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const row = (await db.prepare(`${OPS_CTE} SELECT count(*)::int AS n FROM f`).get(buildParams({ unverified: true }, cc.base, []))) as { n: number }
  return num(row.n)
}

/** Totals per currency (income > 0, outcome < 0, total) split by cash/bank,
 * over the filtered set without deleted and unverified operations. */
export async function cashOperationTotals(query: CashListQuery, db: PgDb = getDb()): Promise<CashTotalsResult> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const { list } = await categoryMap(db)
  const rows = (await db
    .prepare(
      `${OPS_CTE}
       SELECT o.cur, o.pt, COALESCE(SUM(o.amount) FILTER (WHERE o.amount > 0), 0) AS income, COALESCE(SUM(o.amount) FILTER (WHERE o.amount < 0), 0) AS outcome
       FROM f o WHERE NOT o.deleted AND o.verified GROUP BY o.cur, o.pt`,
    )
    .all(buildParams({ ...query, unverified: false }, cc.base, list))) as Array<{ cur: string; pt: CashPaymentType; income: number; outcome: number }>
  const byCurrency = new Map<string, CashTotalsRow>()
  for (const row of rows) {
    let total = byCurrency.get(row.cur)
    if (!total) {
      total = { currency: row.cur, income: 0, outcome: 0, total: 0, types: [{ type: "cash", income: 0, outcome: 0 }, { type: "bank", income: 0, outcome: 0 }] }
      byCurrency.set(row.cur, total)
    }
    total.income += num(row.income)
    total.outcome += num(row.outcome)
    const part = total.types.find((item) => item.type === row.pt)!
    part.income += num(row.income)
    part.outcome += num(row.outcome)
  }
  const order = cc.currencies.map((currency) => currency.code)
  const totals = [...byCurrency.values()]
    .map((total) => ({
      ...total,
      income: roundMoney(total.income),
      outcome: roundMoney(total.outcome),
      total: roundMoney(total.income + total.outcome),
      types: total.types.map((item) => ({ ...item, income: roundMoney(item.income), outcome: roundMoney(item.outcome) })),
    }))
    .sort((a, b) => (order.indexOf(a.currency) + 1 || 999) - (order.indexOf(b.currency) + 1 || 999) || a.currency.localeCompare(b.currency))
  return { baseCurrency: cc.base, totals }
}

/** One operation by key (deleted included); null when unknown. Customer
 * payments inside an acceptance batch are reached through their acceptance. */
export async function getCashOperation(key: string, db: PgDb = getDb()): Promise<CashOperation | null> {
  const parsed = parseOperationKey(key)
  if (!parsed) return null
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const { map } = await categoryMap(db)
  const params = { ...buildParams({ withDeleted: true }, cc.base, []), onlyId: parsed.id, onlySrc: parsed.source }
  const rows = (await db.prepare(`${OPS_CTE} ${PAGE_SELECT}`).all(params)) as OpRow[]
  if (!rows.length) return null
  const transfers = await transferInfo(db, rows)
  return toOperation(rows[0], cc.base, map, transfers)
}

export type OperationDetails = {
  /** Detalization lines ("Детализация" popup). */
  children: Array<{ name: string; amount: number }>
  /** Staff allocations ("Расходы на сотрудников" popup), amounts > 0 in `currency`. */
  staff: Array<{ employee: { id: number; name: string }; amount: number; currency: string }>
}

/** Popups of a cash entry; empty for other sources. */
export async function getOperationDetails(key: string, db: PgDb = getDb()): Promise<OperationDetails> {
  const parsed = parseOperationKey(key)
  if (!parsed || parsed.source !== "cash") return { children: [], staff: [] }
  await ensureCashSchema(db)
  const children = (await db.prepare("SELECT name, amount FROM cash_entry_children WHERE entry_id = @id ORDER BY position, id").all({ id: parsed.id })) as Array<{
    name: string
    amount: number
  }>
  const staff = (await db
    .prepare(
      `SELECT s.employee_id, COALESCE(btrim(e.first_name || ' ' || e.last_name), '') AS name, s.amount, s.currency
       FROM cash_entry_staff s LEFT JOIN employees e ON e.id = s.employee_id WHERE s.entry_id = @id ORDER BY s.id`,
    )
    .all({ id: parsed.id })) as Array<{ employee_id: number; name: string; amount: number; currency: string }>
  return {
    children: children.map((row) => ({ name: row.name, amount: roundMoney(num(row.amount)) })),
    staff: staff.map((row) => ({ employee: { id: row.employee_id, name: row.name }, amount: roundMoney(num(row.amount)), currency: row.currency })),
  }
}
