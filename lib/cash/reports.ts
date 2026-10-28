import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { roundMoney } from "@/lib/finance/currency"
import type { CurrencyContext } from "@/lib/finance/context"
import { nameKey } from "@/lib/finance/entities"
import { currencyContext, loadCategories, num, numOrNull, pickRate } from "@/lib/cash/common"
import { buildParams, OPS_CTE, type CashListQuery } from "@/lib/cash/list"
import { ensureCashSchema } from "@/lib/cash/schema"
import { CASH_OP_LABELS, operationKey, type CashOpType, type CashSource } from "@/lib/cash/types"

// Aggregates for "Расходы по категориям" and "Расходы на персонал", built on
// the same read model as the cash list so the reports always reconcile with
// "Управления кассой" (and, for cash rows, with "Баланс кассы").
//
// What counts as an expense (page 1): every operation of the cash read model
// that leaves a cashbox (amount < 0), is not a transfer leg, not deleted and
// verified — plain expenses, supplier payments, client withdrawals, cashback
// payouts, supply extra expenses, staff expenses. Internal (`direct`)
// categories are included in the list and in the drill-down (spec O2).
// Page 2 reads the per-employee allocations (cash_entry_staff) of such
// entries. Base amounts: the stored creation-time base amount, else the
// current rate; an unknown rate counts 1:1 and is reported in `missingRates`.

/** Report key of a counted outflow: "expense:<id>" (category row, by id or by
 * name for legacy free-text rows), "name:<lower name>" (unknown free-text
 * category) or "none". Alias x; `xbase` = base amount with the 1:1 fallback. */
const EXPENSE_CTE = `${OPS_CTE},
ecx AS (SELECT DISTINCT ON (fin_key(name)) fin_key(name) AS k, id, name FROM expense_categories ORDER BY fin_key(name), id),
x AS (
  SELECT o.*, COALESCE(ec.id, en.id) AS xcid, COALESCE(ec.name, en.name, NULLIF(btrim(o.category_name), ''), '') AS xname,
    CASE WHEN COALESCE(ec.id, en.id) IS NOT NULL THEN 'expense:' || COALESCE(ec.id, en.id)::text
         WHEN fin_key(o.category_name) <> '' THEN 'name:' || fin_key(o.category_name) ELSE 'none' END AS xkey,
    COALESCE(o.base_amount, o.amount) AS xbase
  FROM f o
  LEFT JOIN expense_categories ec ON o.category_kind = 'expense' AND ec.id = o.category_id
  LEFT JOIN ecx en ON ec.id IS NULL AND fin_key(o.category_name) <> '' AND en.k = fin_key(o.category_name)
  WHERE NOT o.deleted AND o.verified AND o.amount < 0 AND o.op NOT IN (1, 2)
    AND (NOT @listMode::boolean OR NOT o.internal)
)`

const ISO_TS = `COALESCE(to_char(x.ts, 'YYYY-MM-DD"T"HH24:MI:SS'), '')`

/** Valid report keys of page 1 (detail route validation). */
export function isCategoryReportKey(key: string): boolean {
  return /^(expense:\d{1,9}|name:[\s\S]{1,300}|none)$/.test(key)
}

// --- raw aggregates (GET /api/cash/reports/expenses-by-category) -------------------

export type CategoryExpenseRow = {
  /** "expense:<id>" | "name:<lower name>" (legacy free-text category) | "none". */
  key: string
  categoryId: number | null
  name: string
  currency: string
  /** Σ outflows in `currency` (negative). */
  amount: number
  /** Σ in the base currency (stored historical base amounts, else current rates, else 1:1). */
  baseAmount: number
}

/** Outflows (amount < 0, not transfers, not deleted, verified) per expense category × currency.
 * All CashListQuery filters apply (from/to, branches, organizations, cashboxIds, …). */
export async function expensesByCategory(query: CashListQuery, db: PgDb = getDb()): Promise<{ baseCurrency: string; rows: CategoryExpenseRow[] }> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const categories = await loadCategories(db)
  const rows = (await db
    .prepare(
      `${EXPENSE_CTE}
       SELECT x.xkey AS key, MAX(x.xcid) AS cid, MAX(x.xname) AS name, x.cur, SUM(x.amount) AS amount, SUM(x.xbase) AS base
       FROM x GROUP BY x.xkey, x.cur`,
    )
    .all(buildParams({ ...query, unverified: false, withDeleted: false }, cc.base, categories))) as Array<{
    key: string
    cid: number | null
    name: string
    cur: string
    amount: number
    base: number
  }>
  return {
    baseCurrency: cc.base,
    rows: rows
      .map((row) => ({
        key: row.key,
        categoryId: row.cid ?? null,
        name: row.name ?? "",
        currency: row.cur,
        amount: roundMoney(num(row.amount)),
        baseAmount: roundMoney(num(row.base)),
      }))
      .sort((a, b) => a.baseAmount - b.baseAmount || a.name.localeCompare(b.name, "ru")),
  }
}

// --- report list / drill-down (both pages) ----------------------------------------

export type ExpenseReportFilters = {
  /** ISO days on the business date, inclusive. */
  from?: string
  to?: string
  /** Branch names (operation branch, else the cashbox branch). */
  branches?: string[]
  /** Organization names; strict (rows without an organization are excluded). */
  organizations?: string[]
  /** Page 2 only: the entry's expense category. */
  expenseCategoryIds?: number[]
}

export type ExpenseReportPaging = {
  /** List: case-insensitive substring of the row name. */
  search?: string
  page?: number
  /** Default 25; 0 = all (Excel "Скачать все"). */
  pageSize?: number
}

export type ExpenseReportItem = {
  /** Page 1: "expense:<id>" | "name:<lower name>" | "none"; page 2: employee id as text. */
  key: string
  /** expense_categories.id / employees.id (null for free-text / missing categories). */
  id: number | null
  /** "" = not set (show "Не указано" / "Не указан"). */
  name: string
  /** Σ in the base currency, > 0. */
  amount: number
  /** Share of the filtered period total (independent of search and paging), 0–100, one decimal. */
  percent: number
}

export type ExpenseReportList = {
  baseCurrency: string
  count: number
  page: number
  pageSize: number
  /** Σ of every row of the filtered period (base currency, > 0). */
  total: number
  /** Currencies counted 1:1 because their rate is unknown. */
  missingRates: string[]
  results: ExpenseReportItem[]
}

export type ExpenseDetailRow = {
  /** Unique row key ("cash-12" for page 1, "staff-<allocation id>" for page 2). */
  key: string
  /** Cash operation key ("cash-12", "supplier-3", …). */
  operationKey: string
  /** "№" of the operation (link: /analytics/cash-management?search=<docNo>). */
  docNo: number | null
  type: number
  /** Operation type label (Russian i18n key). */
  title: string
  /** Business date, local "YYYY-MM-DDTHH:mm:ss". */
  date: string
  cashbox: string
  category: string
  client: string
  supplier: string
  branch: string
  organization: string
  comment: string
  /** Own (cashbox) currency: page 1 the outflow (< 0), page 2 the employee share (> 0). */
  amount: number
  currency: string
  /** Same sign as amount, base currency; null when the rate is unknown. */
  baseAmount: number | null
  /** Base units per 1 unit of `currency`. */
  rate: number | null
}

export type ExpenseReportDetail = {
  baseCurrency: string
  /** Echo of the requested key (page 1 key / employee id). */
  key: string
  name: string
  /** "Общая сумма:" per currency (page 1 < 0, page 2 > 0). */
  currencies: Array<{ currency: string; amount: number }>
  /** Σ in the base currency (same sign as the amounts). */
  total: number
  count: number
  page: number
  pageSize: number
  rows: ExpenseDetailRow[]
}

function pageOf(query: ExpenseReportPaging, count: number): { page: number; pageSize: number; offset: number } {
  const pageSize = query.pageSize === 0 ? 0 : Math.min(Math.max(1, Math.floor(query.pageSize ?? 25) || 25), 5000)
  const last = pageSize ? Math.max(1, Math.ceil(count / pageSize)) : 1
  const page = Math.min(Math.max(1, Math.floor(query.page ?? 1) || 1), last)
  return { page, pageSize, offset: pageSize ? (page - 1) * pageSize : 0 }
}

function currencyOrder(cc: CurrencyContext) {
  const order = cc.currencies.map((currency) => currency.code)
  return (a: string, b: string) => (order.indexOf(a) + 1 || 999) - (order.indexOf(b) + 1 || 999) || a.localeCompare(b)
}

/** Percent, ordering (largest first), search and paging of the grouped rows. */
function finishList(
  baseCurrency: string,
  groups: Map<string, { id: number | null; name: string; amount: number }>,
  missing: Set<string>,
  query: ExpenseReportPaging,
): ExpenseReportList {
  const items = [...groups.entries()].map(([key, group]) => ({ key, id: group.id, name: group.name, amount: roundMoney(group.amount) }))
  const total = roundMoney(items.reduce((sum, item) => sum + item.amount, 0))
  const all = items
    .map((item) => ({ ...item, percent: total > 0 ? Math.round((1000 * item.amount) / total) / 10 : 0 }))
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, "ru") || a.key.localeCompare(b.key))
  const search = nameKey(query.search)
  const found = search ? all.filter((item) => nameKey(item.name).includes(search)) : all
  const { page, pageSize, offset } = pageOf(query, found.length)
  return {
    baseCurrency,
    count: found.length,
    page,
    pageSize,
    total,
    missingRates: [...missing].sort(),
    results: pageSize ? found.slice(offset, offset + pageSize) : found,
  }
}

function listParams(filters: ExpenseReportFilters, base: string) {
  // Only the shared filters: the report search applies to the row name, not to the operations.
  // listMode: the report reads the same archive as the cash list (reference rows + operations created after the import); internal categories are not reported, like in the demo app.
  return buildParams({ from: filters.from, to: filters.to, branches: filters.branches, organizations: filters.organizations, listMode: true }, base, [])
}

/** "Расходы по категориям": one row per expense category (flat, the operation's own category). */
export async function categoryExpenseReport(query: ExpenseReportFilters & ExpenseReportPaging, db: PgDb = getDb()): Promise<ExpenseReportList> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const rows = (await db
    .prepare(
      `${EXPENSE_CTE}
       SELECT x.xkey AS key, MAX(x.xcid) AS cid, MAX(x.xname) AS name, x.cur, SUM(x.xbase) AS base, bool_or(x.base_amount IS NULL) AS missing
       FROM x WHERE NOT (@listMode::boolean AND x.xkey = 'none') GROUP BY x.xkey, x.cur`,
    )
    .all(listParams(query, cc.base))) as Array<{ key: string; cid: number | null; name: string | null; cur: string; base: number; missing: boolean }>
  const groups = new Map<string, { id: number | null; name: string; amount: number }>()
  const missing = new Set<string>()
  for (const row of rows) {
    const group = groups.get(row.key) ?? { id: row.cid ?? null, name: row.name ?? "", amount: 0 }
    group.amount += -num(row.base)
    groups.set(row.key, group)
    if (row.missing) missing.add(row.cur)
  }
  return finishList(cc.base, groups, missing, query)
}

type DetailOpRow = {
  src: CashSource
  id: number
  doc_no: string | number | null
  op: number
  ts_s: string
  cashbox_name: string
  cur: string
  amount: number
  base_amount: number | null
  rate: number | null
  xname: string
  client_name: string | null
  supplier_name: string | null
  branch: string | null
  cb_branch: string | null
  organization: string | null
  comment: string | null
}

function rateFrom(amount: number, base: number | null, fallback: number | null): number | null {
  if (base !== null && amount) return roundMoney(Math.abs(base / amount), 5)
  return fallback
}

/** Drill-down of one category row: totals per currency + the paged operations (newest first). */
export async function categoryExpenseDetail(key: string, query: ExpenseReportFilters & ExpenseReportPaging, db: PgDb = getDb()): Promise<ExpenseReportDetail> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const params = { ...listParams(query, cc.base), xkey: key }
  const totals = (await db
    .prepare(
      `${EXPENSE_CTE}
       SELECT x.cur, SUM(x.amount) AS amount, SUM(x.xbase) AS base, count(*)::int AS n, MAX(x.xname) AS name
       FROM x WHERE x.xkey = @xkey::text GROUP BY x.cur`,
    )
    .all(params)) as Array<{ cur: string; amount: number; base: number; n: number; name: string | null }>
  const count = totals.reduce((sum, row) => sum + num(row.n), 0)
  const { page, pageSize, offset } = pageOf(query, count)
  const rows = count
    ? ((await db
        .prepare(
          `${EXPENSE_CTE}
           SELECT x.src, x.id, x.doc_no, x.op, ${ISO_TS} AS ts_s, x.cashbox_name, x.cur, x.amount, x.base_amount, x.rate, x.xname,
                  x.client_name, x.supplier_name, x.branch, x.cb_branch, x.organization, x.comment
           FROM x WHERE x.xkey = @xkey::text
           ORDER BY x.ts DESC NULLS LAST, x.doc_no DESC NULLS LAST, x.id DESC${pageSize ? ` LIMIT ${pageSize} OFFSET ${offset}` : ""}`,
        )
        .all(params)) as DetailOpRow[])
    : []
  let name = totals.find((row) => row.name)?.name ?? ""
  if (!name && key.startsWith("expense:")) {
    const category = (await db.prepare("SELECT name FROM expense_categories WHERE id = @id").get({ id: Number(key.slice(8)) })) as { name: string } | undefined
    name = category?.name ?? ""
  } else if (!name && key.startsWith("name:")) name = key.slice(5)
  const order = currencyOrder(cc)
  return {
    baseCurrency: cc.base,
    key,
    name,
    currencies: totals.map((row) => ({ currency: row.cur, amount: roundMoney(num(row.amount)) })).sort((a, b) => order(a.currency, b.currency)),
    total: roundMoney(totals.reduce((sum, row) => sum + num(row.base), 0)),
    count,
    page,
    pageSize,
    rows: rows.map((row) => {
      const amount = roundMoney(num(row.amount))
      const base = numOrNull(row.base_amount)
      return {
        key: operationKey(row.src, row.id),
        operationKey: operationKey(row.src, row.id),
        docNo: row.doc_no === null || row.doc_no === undefined ? null : Number(row.doc_no),
        type: row.op,
        title: CASH_OP_LABELS[row.op as CashOpType] ?? "",
        date: row.ts_s,
        cashbox: row.cashbox_name,
        category: row.xname ?? "",
        client: row.client_name ?? "",
        supplier: row.supplier_name ?? "",
        branch: row.branch || row.cb_branch || "",
        organization: row.organization ?? "",
        comment: row.comment ?? "",
        amount,
        currency: row.cur,
        baseAmount: base === null ? null : roundMoney(base),
        rate: rateFrom(num(row.amount), base, numOrNull(row.rate)),
      }
    }),
  }
}

// --- staff allocations (page 2) -----------------------------------------------------

export type StaffExpenseQuery = {
  from?: string
  to?: string
  branches?: string[]
  organizations?: string[]
  expenseCategoryIds?: number[]
  employeeIds?: number[]
}

export type StaffExpenseRow = {
  /** cash_entry_staff.id */
  id: number
  employee: { id: number; name: string }
  /** The cash entry (open it as key "cash-<entryId>"). */
  entryId: number
  docNo: number
  date: string
  cashbox: string
  category: string
  branch: string
  organization: string
  comment: string
  /** Employee share (> 0) in the entry currency. */
  amount: number
  currency: string
  baseAmount: number | null
  rate: number | null
}

/** Staff allocations of verified, not deleted staff-expense entries (amount < 0) — rows of "Расходы на персонал";
 * group them by employee (and currency) for the list, or filter by employeeIds for the drill-down. */
export async function staffExpenseRows(query: StaffExpenseQuery, db: PgDb = getDb()): Promise<{ baseCurrency: string; rows: StaffExpenseRow[] }> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  const categories = (await loadCategories(db)).filter((category) => category.kind === "expense")
  const catIds = query.expenseCategoryIds ?? []
  const rows = (await db
    .prepare(
      `SELECT s.id, s.employee_id, btrim(concat_ws(' ', emp.first_name, emp.last_name)) AS employee, e.id AS entry_id, e.doc_no,
              COALESCE(to_char(COALESCE(fin_ts(e.entry_date), fin_ts(e.created_at, true)), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS date,
              cb.name AS cashbox, e.category, e.expense_category_id, fin_place(e.branch) AS branch, fin_place(cb.branch) AS cb_branch,
              fin_place(e.organization) AS organization, e.comment, s.amount, COALESCE(fin_cur(NULLIF(s.currency, '')), fin_cur(cb.currency), @base::text) AS cur, e.custom_rate
       FROM cash_entry_staff s JOIN cash_management_entries e ON e.id = s.entry_id JOIN cashboxes cb ON cb.id = e.cashbox_id
       LEFT JOIN employees emp ON emp.id = s.employee_id
       WHERE e.is_deleted = 0 AND e.is_verified <> 0 AND e.amount < 0
         AND (cardinality(@employees::int[]) = 0 OR s.employee_id = ANY(@employees::int[]))
         AND (@from::text = '' OR COALESCE(fin_ts(e.entry_date), fin_ts(e.created_at, true))::date >= NULLIF(@from::text, '')::date)
         AND (@to::text = '' OR COALESCE(fin_ts(e.entry_date), fin_ts(e.created_at, true))::date <= NULLIF(@to::text, '')::date)
       ORDER BY date DESC, e.doc_no DESC NULLS LAST, s.id DESC`,
    )
    .all({ base: cc.base, employees: query.employeeIds ?? [], from: query.from ?? "", to: query.to ?? "" })) as Array<{
    id: number
    employee_id: number
    employee: string | null
    entry_id: number
    doc_no: string | number
    date: string
    cashbox: string
    category: string
    expense_category_id: number | null
    branch: string
    cb_branch: string
    organization: string
    comment: string
    amount: number
    cur: string
    custom_rate: number | null
  }>
  const branches = (query.branches ?? []).map(nameKey).filter(Boolean)
  const organizations = (query.organizations ?? []).map(nameKey).filter(Boolean)
  const catNames = new Set(categories.filter((category) => catIds.includes(category.id)).map((category) => nameKey(category.name)))
  return {
    baseCurrency: cc.base,
    rows: rows
      .filter((row) => !branches.length || branches.includes(nameKey(row.branch || row.cb_branch)))
      .filter((row) => !organizations.length || organizations.includes(nameKey(row.organization)))
      .filter((row) => !catIds.length || (row.expense_category_id ? catIds.includes(row.expense_category_id) : catNames.has(nameKey(row.category))))
      .map((row) => {
        const rate = pickRate(row.cur, cc, row.custom_rate)
        const amount = Math.abs(num(row.amount))
        return {
          id: row.id,
          employee: { id: row.employee_id, name: row.employee ?? "" },
          entryId: row.entry_id,
          docNo: Number(row.doc_no),
          date: row.date,
          cashbox: row.cashbox,
          category: row.category,
          branch: row.branch || row.cb_branch,
          organization: row.organization,
          comment: row.comment,
          amount: roundMoney(amount),
          currency: row.cur,
          baseAmount: rate ? roundMoney(amount * rate) : null,
          rate,
        }
      }),
  }
}

/** "Расходы на персонал": one row per employee (Σ of the allocations in the base currency). */
export async function staffExpenseReport(query: ExpenseReportFilters & ExpenseReportPaging, db: PgDb = getDb()): Promise<ExpenseReportList> {
  const { baseCurrency, rows } = await staffExpenseRows(
    { from: query.from, to: query.to, branches: query.branches, organizations: query.organizations, expenseCategoryIds: query.expenseCategoryIds },
    db,
  )
  const groups = new Map<string, { id: number | null; name: string; amount: number }>()
  const missing = new Set<string>()
  for (const row of rows) {
    const key = String(row.employee.id)
    const group = groups.get(key) ?? { id: row.employee.id, name: row.employee.name, amount: 0 }
    if (row.baseAmount === null) missing.add(row.currency)
    group.amount += row.baseAmount ?? row.amount
    groups.set(key, group)
  }
  return finishList(baseCurrency, groups, missing, query)
}

/** Drill-down of one employee: totals per currency + the paged allocations (newest first). */
export async function staffExpenseDetail(employeeId: number, query: ExpenseReportFilters & ExpenseReportPaging, db: PgDb = getDb()): Promise<ExpenseReportDetail> {
  const { baseCurrency, rows } = await staffExpenseRows(
    {
      from: query.from,
      to: query.to,
      branches: query.branches,
      organizations: query.organizations,
      expenseCategoryIds: query.expenseCategoryIds,
      employeeIds: [employeeId],
    },
    db,
  )
  const byCurrency = new Map<string, number>()
  for (const row of rows) byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + row.amount)
  let name = rows.find((row) => row.employee.name)?.employee.name ?? ""
  if (!name) {
    const employee = (await db.prepare("SELECT first_name, last_name FROM employees WHERE id = @id").get({ id: employeeId })) as
      | { first_name: string | null; last_name: string | null }
      | undefined
    name = employee ? `${employee.first_name ?? ""} ${employee.last_name ?? ""}`.trim() : ""
  }
  const cc = await currencyContext(db)
  const order = currencyOrder(cc)
  const { page, pageSize, offset } = pageOf(query, rows.length)
  return {
    baseCurrency,
    key: String(employeeId),
    name,
    currencies: [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount: roundMoney(amount) })).sort((a, b) => order(a.currency, b.currency)),
    total: roundMoney(rows.reduce((sum, row) => sum + (row.baseAmount ?? row.amount), 0)),
    count: rows.length,
    page,
    pageSize,
    rows: (pageSize ? rows.slice(offset, offset + pageSize) : rows).map((row) => ({
      key: `staff-${row.id}`,
      operationKey: operationKey("cash", row.entryId),
      docNo: Number.isFinite(row.docNo) ? row.docNo : null,
      type: 5,
      title: CASH_OP_LABELS[5],
      date: row.date,
      cashbox: row.cashbox,
      category: row.category,
      client: "",
      supplier: "",
      branch: row.branch,
      organization: row.organization,
      comment: row.comment,
      amount: row.amount,
      currency: row.currency,
      baseAmount: row.baseAmount,
      rate: row.rate,
    })),
  }
}
