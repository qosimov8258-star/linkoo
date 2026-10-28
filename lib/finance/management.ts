import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext, withSeenCodes } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey, placeName } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema, type FinanceSchema } from "@/lib/finance/schema"
import { stockValuesAsOf } from "@/lib/finance/stock"
import type { BalanceListResult, ManagementBalanceResult, ManagementBranch, ManagementLine, ManagementSection } from "@/lib/finance/types"

// "Управленческий баланс по филиалам": a balance sheet per branch built on the
// same entity balances the other balance pages show (getBalanceList), so all
// pages agree. Begin = state before `from`, end = state at `to` (inclusive).
// Counterparty balances are split by sign per counterparty:
//   client  < 0 → asset "Задолженность клиентов",   > 0 → passive "Авансы, полученные от покупателей"
//   supplier > 0 → asset "Предоплаты поставщикам",  < 0 → passive "Долги поставщикам"
//   employee < 0 → asset "Авансы, выданные по оплате труда", > 0 → passive "Задолженность по оплате труда"
//   branch  > 0 → asset "Задолженность филиалов",   < 0 → passive "Авансы полученные от филиалов"
//            (branch ledger sign: + = the branch is owed — it sent goods / money —, − = it owes)
// Each line is attributed to the entity's own branch (cashboxes.branch,
// clients.branch, suppliers.branch, employees.branch, warehouses.branch, the
// branch itself); "" goes to the virtual card "Без филиала" (id null).
// Two lines keep equity still while money or a debt is on its way:
//   "Деньги у агентов" (asset): customer payments an agent collected that no
//     cashbox accepted yet — the client ledger already counts them (created
//     mode), the cashbox only once accepted; client's branch, payment currency.
//     It is the difference of the two ledgers, so it goes negative while a
//     cashbox holds a payment the client ledger does not count yet (accepted
//     before its payment date).
//   "Неоплаченные доп. расходы" (passive): additional expenses of accepted
//     supplies that are capitalized into Склад (stock core) but not paid yet,
//     cleared by the cash operations that pay them (op 9 «Доп. расход на
//     поставку»); warehouse branch, expense currency. A payment from a cashbox
//     in another currency settles the expense at the moment it was made (its
//     base value then ÷ the expense's rate snapshot), so a paid expense stays
//     paid whatever the rates do later. A payment above the capitalized expense
//     (or of a supply not accepted yet) is the asset "Предоплаченные доп. расходы".

export type ManagementParams = {
  from: string
  to: string
  /** Branch names to show (default all). */
  branches?: string[]
  /** Organization names: applied to every counterparty movement (stock and cashback ignore it). */
  organizations?: string[]
}

type LineSpec = { key: string; label: string; section: "assets" | "passives"; perCurrency: boolean; href: (branch: string, q: string) => string }

const LINES: LineSpec[] = [
  { key: "stock", label: "Склад", section: "assets", perCurrency: false, href: (branch, q) => `/analytics/stock-by-date?branch=${encodeURIComponent(branch)}&${q}` },
  { key: "cashbox", label: "Касса", section: "assets", perCurrency: true, href: (_b, q) => `/analytics/cash-balance?${q}` },
  { key: "market_balance", label: "Задолженность клиентов", section: "assets", perCurrency: true, href: (_b, q) => `/analytics/client-balance?${q}` },
  { key: "provider_balance", label: "Предоплаты поставщикам", section: "assets", perCurrency: true, href: (_b, q) => `/analytics/supplier-balance?${q}` },
  { key: "staff_balance", label: "Авансы, выданные по оплате труда", section: "assets", perCurrency: true, href: (_b, q) => `/analytics/employee-balance?${q}` },
  { key: "branch_balance", label: "Задолженность филиалов", section: "assets", perCurrency: true, href: (_b, q) => `/analytics/branch-balance?${q}` },
  { key: "agent_cash", label: "Деньги у агентов", section: "assets", perCurrency: true, href: () => "/analytics/customer-payments?notAccept=1" },
  { key: "supply_expense_balance", label: "Предоплаченные доп. расходы", section: "assets", perCurrency: true, href: () => "/analytics/supplier-incomings" },
  { key: "market_balance", label: "Авансы, полученные от покупателей", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/client-balance?${q}` },
  { key: "provider_balance", label: "Долги поставщикам", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/supplier-balance?${q}` },
  { key: "staff_balance", label: "Задолженность по оплате труда", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/employee-balance?${q}` },
  { key: "cashback_balance", label: "Кешбэк покупателей", section: "passives", perCurrency: false, href: () => "/analytics/loyalty-card" },
  { key: "branch_balance", label: "Авансы полученные от филиалов", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/branch-balance?${q}` },
  { key: "supply_expense_balance", label: "Неоплаченные доп. расходы", section: "passives", perCurrency: true, href: () => "/analytics/supplier-incomings" },
]

export const NO_BRANCH_LABEL = "Без филиала"

type Card = { id: number | null; name: string; amounts: Map<string, { begin: number; end: number }> }

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

type PeriodAmounts = { begin_amount: number | string | null; end_amount: number | string | null }

/** Customer payments taken by an agent but not in a cashbox yet, per client
 * branch and payment currency, before `from` and at `to`: what the client
 * ledger counts (created mode: payment_date, paid_at, created_at) minus what
 * the cashbox ledger received (accepted = 1 into a known cashbox:
 * accepted_at, …) — the same rows, dates and organization filter as
 * lib/finance/sources.ts, so the two sides of an acceptance cancel out in
 * either order (negative while a payment accepted ahead of its payment date
 * sits in a cashbox before the client ledger counts it). */
async function agentCash(db: PgDb, s: FinanceSchema, base: string, from: string, to: string, orgs: string[]) {
  const CP = "customer_payments"
  if (!s.has(CP) || !s.has("clients")) return []
  const paymentDate = s.col(CP, "payment_date") ? "fin_ts(p.payment_date)" : "NULL::timestamp"
  const taken = `COALESCE(${paymentDate}, fin_ts(p.paid_at), fin_ts(p.created_at, true))::date`
  const landed = `COALESCE(fin_ts(p.accepted_at), ${paymentDate}, fin_ts(p.paid_at), fin_ts(p.created_at, true))::date`
  const clientId = s.col(CP, "client_id") ? "COALESCE(p.client_id, ck.id)" : "ck.id"
  const cashboxes = s.has("cashboxes")
  const cashboxId = s.col(CP, "cashbox_id") ? "COALESCE(p.cashbox_id, cbk.id)" : "cbk.id"
  const alive = s.col(CP, "is_deleted") ? "COALESCE(p.is_deleted, 0) = 0" : "true"
  return (await db
    .prepare(
      `WITH ck AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM clients GROUP BY 1),
       ${cashboxes ? "cbk AS (SELECT fin_key(name) AS k, MIN(id) AS id FROM cashboxes GROUP BY 1)," : ""}
       pay AS (
         SELECT ${s.col("clients", "branch") ? "c.branch" : "''::text"} AS branch, COALESCE(fin_cur(p.currency), @base) AS cur, COALESCE(p.amount, 0)::double precision AS amt, ${taken} AS taken,
                ${cashboxes ? `CASE WHEN p.accepted = 1 AND cb.id IS NOT NULL THEN ${landed} END` : "NULL::date"} AS landed
         FROM customer_payments p
         LEFT JOIN ck ON ck.k = fin_key(p.client)
         JOIN clients c ON c.id = ${clientId}
         ${cashboxes ? `LEFT JOIN cbk ON cbk.k = fin_key(p.kassa) LEFT JOIN cashboxes cb ON cb.id = ${cashboxId}` : ""}
         WHERE ${alive} AND (cardinality(@orgs::text[]) = 0 OR fin_key(fin_place(p.organization)) = ANY(@orgs::text[])))
       SELECT branch, cur,
              COALESCE(SUM(amt) FILTER (WHERE taken < @from::date), 0) - COALESCE(SUM(amt) FILTER (WHERE landed < @from::date), 0) AS begin_amount,
              COALESCE(SUM(amt) FILTER (WHERE taken <= @to::date), 0) - COALESCE(SUM(amt) FILTER (WHERE landed <= @to::date), 0) AS end_amount
       FROM pay GROUP BY 1, 2`,
    )
    .all({ base, from, to, orgs })) as Array<PeriodAmounts & { branch: string | null; cur: string }>
}

/** Net unpaid amount of every additional supply expense before `from` and at
 * `to`, in the expense currency: + the expense once its supply is accepted
 * (on the day the stock core capitalizes it into the goods: the earlier of
 * the supply date and its acceptance), − every live, verified cash operation
 * that paid it (cash_management_entries.supply_expense_id, legacy rows via
 * supplier_incoming_expenses.transaction_id) on its day. A payment in the
 * expense currency counts as is; one from a cashbox in another currency is
 * settled at its own moment: its base value then (internal_amount; the
 * current cashbox rate only for rows without it) ÷ the expense's rate
 * snapshot (rate_to_base, the rate the stock core capitalized it at; the
 * current rate only when missing). Later rate changes therefore never
 * re-open a paid expense. */
async function supplyExpenseBalances(db: PgDb, s: FinanceSchema, base: string, from: string, to: string) {
  const E = "supplier_incoming_expenses"
  const I = "supplier_incomings"
  const C = "cash_management_entries"
  if (!s.has(E) || !s.has(I) || !s.col(E, "incoming_id")) return []
  const supplyCurrency = s.col(I, "currency") ? "fin_cur(i.currency)" : "NULL::text"
  const currency = s.col(E, "currency") ? `COALESCE(fin_cur(e.currency), ${supplyCurrency}, @base)` : `COALESCE(${supplyCurrency}, @base)`
  const accepted = s.col(I, "accepted_at") ? "fin_ts(i.accepted_at)" : "NULL::timestamp"
  const ctes = [
    s.has("currencies")
      ? "rates AS (SELECT fin_cur(code) AS code, MAX(rate)::double precision AS rate FROM currencies WHERE fin_cur(code) IS NOT NULL GROUP BY 1)"
      : "rates AS (SELECT NULL::text AS code, NULL::double precision AS rate WHERE false)",
    `exp0 AS (
      SELECT e.id, i.warehouse, ${s.col(I, "branch") ? "i.branch" : "''"} AS branch, ${currency} AS cur, COALESCE(e.amount, 0)::double precision AS amount,
             ${s.col(E, "rate_to_base") ? "NULLIF(e.rate_to_base, 0)::double precision" : "NULL::double precision"} AS snapshot,
             CASE WHEN i.status = 'принят' THEN COALESCE(COALESCE(LEAST(fin_ts(i.date), ${accepted}), fin_ts(i.created_at, true))::date, DATE '1970-01-01') END AS booked
      FROM ${E} e JOIN ${I} i ON i.id = e.incoming_id)`,
    // rate = base units per unit of the expense currency, as the stock core capitalized it.
    `exp AS (SELECT x.*, CASE WHEN x.cur = @base THEN 1 ELSE COALESCE(x.snapshot, (SELECT r.rate FROM rates r WHERE r.code = x.cur)) END AS rate FROM exp0 x)`,
  ]
  const links: string[] = []
  if (s.has(C) && s.has("cashboxes")) {
    const bySupplyExpense = s.col(C, "supply_expense_id")
    if (bySupplyExpense) links.push(`SELECT c.id AS entry_id, c.supply_expense_id AS expense_id FROM ${C} c WHERE c.supply_expense_id IS NOT NULL`)
    if (s.col(E, "transaction_id")) {
      links.push(
        `SELECT e.transaction_id AS entry_id, e.id AS expense_id FROM ${E} e JOIN ${C} c ON c.id = e.transaction_id
         WHERE e.transaction_id IS NOT NULL${bySupplyExpense ? " AND c.supply_expense_id IS NULL" : ""}`,
      )
    }
  }
  if (links.length) {
    const alive = s.col(C, "is_deleted") ? "COALESCE(c.is_deleted, 0) = 0" : "true"
    const verified = s.col(C, "is_verified") ? "COALESCE(c.is_verified, 1) = 1" : "true"
    ctes.push(`link AS (${links.join(" UNION ALL ")})`)
    // base_amt: the payment's base value at its moment (same sign as amt).
    const internal = s.col(C, "internal_amount")
      ? "CASE WHEN COALESCE(c.internal_amount, 0) <> 0 THEN abs(c.internal_amount::double precision) * sign(-COALESCE(c.amount, 0)::double precision) END"
      : "NULL::double precision"
    ctes.push(`paid AS (
      SELECT l.expense_id, COALESCE(fin_ts(c.entry_date), fin_ts(c.created_at, true))::date AS day,
             -COALESCE(c.amount, 0)::double precision AS amt, COALESCE(fin_cur(cb.currency), @base) AS cur, ${internal} AS base_amt
      FROM link l JOIN ${C} c ON c.id = l.entry_id JOIN cashboxes cb ON cb.id = c.cashbox_id
      WHERE ${alive} AND ${verified})`)
  } else {
    ctes.push("paid AS (SELECT NULL::int AS expense_id, NULL::date AS day, 0::double precision AS amt, NULL::text AS cur, NULL::double precision AS base_amt WHERE false)")
  }
  // Payment in the expense currency, settled at the payment's moment (see above).
  const converted = `CASE WHEN p.cur = x.cur THEN p.amt
    ELSE COALESCE(COALESCE(p.base_amt, p.amt * CASE WHEN p.cur = @base THEN 1 ELSE (SELECT r.rate FROM rates r WHERE r.code = p.cur) END) / NULLIF(x.rate, 0), p.amt) END`
  return (await db
    .prepare(
      `WITH ${ctes.join(",\n")}
       SELECT x.id, x.warehouse, x.branch, x.cur,
              (CASE WHEN x.booked < @from::date THEN x.amount ELSE 0 END) - COALESCE(SUM(${converted}) FILTER (WHERE p.day < @from::date), 0) AS begin_amount,
              (CASE WHEN x.booked <= @to::date THEN x.amount ELSE 0 END) - COALESCE(SUM(${converted}) FILTER (WHERE p.day <= @to::date), 0) AS end_amount
       FROM exp x LEFT JOIN paid p ON p.expense_id = x.id
       GROUP BY x.id, x.warehouse, x.branch, x.cur, x.amount, x.booked, x.rate`,
    )
    .all({ base, from, to })) as Array<PeriodAmounts & { id: number; warehouse: string | null; branch: string | null; cur: string }>
}

export async function getManagementBalance(params: ManagementParams, db: PgDb = getDb()): Promise<ManagementBalanceResult> {
  const s = await ensureFinanceSchema(db)
  const filters = { from: params.from, to: params.to, organizations: params.organizations ?? [] }
  const [cashboxes, clients, suppliers, employees, branchRows, cc0] = await Promise.all([
    getBalanceList("cashbox", filters, db),
    getBalanceList("client", filters, db),
    getBalanceList("supplier", filters, db),
    getBalanceList("employee", filters, db),
    getBalanceList("branch", filters, db),
    loadCurrencyContext(db),
  ])
  const cc = withSeenCodes(cc0, [cashboxes, clients, suppliers, employees, branchRows].flatMap((list) => list.currencies.map((currency) => currency.code)))
  const base = cc.base

  // Branch registry: branches table first (by id), then names only seen on entities.
  const cards = new Map<string, Card>()
  if (s.has("branches")) {
    const rows = (await db.prepare("SELECT id, name FROM branches ORDER BY id").all()) as Array<{ id: number; name: string }>
    for (const row of rows) if (!cards.has(nameKey(row.name))) cards.set(nameKey(row.name), { id: row.id, name: row.name, amounts: new Map() })
  }
  const card = (branch: unknown) => {
    const name = placeName(branch)
    const key = nameKey(name)
    let item = cards.get(key)
    if (!item) cards.set(key, (item = { id: null, name: name || NO_BRANCH_LABEL, amounts: new Map() }))
    return item
  }
  const add = (branch: unknown, spec: LineSpec, currency: string, begin: number, end: number) => {
    if (!begin && !end) return
    const target = card(branch)
    const id = `${spec.section}|${spec.label}|${currency}`
    const current = target.amounts.get(id) ?? { begin: 0, end: 0 }
    target.amounts.set(id, { begin: current.begin + begin, end: current.end + end })
  }
  const spec = (section: "assets" | "passives", label: string) => LINES.find((line) => line.section === section && line.label === label)!

  const splitBySign = (list: BalanceListResult, positive: LineSpec, negative: LineSpec, branchOf: (info: Record<string, unknown>) => unknown) => {
    for (const row of list.rows) {
      for (const [code, balance] of Object.entries(row.currencies)) {
        add(branchOf(row.info), positive, code, Math.max(0, balance.begin_balance), Math.max(0, balance.end_balance))
        add(branchOf(row.info), negative, code, Math.max(0, -balance.begin_balance), Math.max(0, -balance.end_balance))
      }
    }
  }

  for (const row of cashboxes.rows) {
    for (const [code, balance] of Object.entries(row.currencies)) add(row.info.branch, spec("assets", "Касса"), code, balance.begin_balance, balance.end_balance)
  }
  splitBySign(clients, spec("passives", "Авансы, полученные от покупателей"), spec("assets", "Задолженность клиентов"), (info) => info.branch)
  splitBySign(suppliers, spec("assets", "Предоплаты поставщикам"), spec("passives", "Долги поставщикам"), (info) => info.branch)
  splitBySign(employees, spec("passives", "Задолженность по оплате труда"), spec("assets", "Авансы, выданные по оплате труда"), (info) => info.branch)
  splitBySign(branchRows, spec("assets", "Задолженность филиалов"), spec("passives", "Авансы полученные от филиалов"), (info) => info.branch)

  // Customer cashback (loyalty card balances > 0), converted to base.
  if (s.has("loyalty_card_transactions")) {
    const clientBranch = new Map(clients.rows.map((row) => [row.key, row.info.branch]))
    const rows = (await db
      .prepare(
        `SELECT client_id::text AS client, COALESCE(fin_cur(currency), @base) AS cur,
                SUM(amount::double precision) FILTER (WHERE fin_ts(created_at, true)::date < @from::date) AS begin_amount,
                SUM(amount::double precision) FILTER (WHERE fin_ts(created_at, true)::date <= @to::date) AS end_amount
         FROM loyalty_card_transactions ${s.col("loyalty_card_transactions", "is_deleted") ? "WHERE COALESCE(is_deleted, 0) = 0" : ""} GROUP BY 1, 2`,
      )
      .all({ base, from: params.from, to: params.to })) as Array<{ client: string; cur: string; begin_amount: number | null; end_amount: number | null }>
    for (const row of rows) {
      const rate = cc.rates[row.cur]
      if (!rate) continue
      add(clientBranch.get(row.client), spec("passives", "Кешбэк покупателей"), base, Math.max(0, Number(row.begin_amount ?? 0)) * rate, Math.max(0, Number(row.end_amount ?? 0)) * rate)
    }
  }

  // Collected by agents, not accepted into a cashbox yet (same organization filter as the client ledger).
  const orgs = (params.organizations ?? []).map(nameKey).filter(Boolean)
  for (const row of await agentCash(db, s, base, params.from, params.to, orgs)) {
    add(row.branch, spec("assets", "Деньги у агентов"), row.cur, Number(row.begin_amount ?? 0), Number(row.end_amount ?? 0))
  }

  // Stock at net cost per warehouse branch.
  const beginDay = dayBefore(params.from)
  const stock = await stockValuesAsOf(db, s, cc, [beginDay, params.to])
  const warehouses = (await db.prepare("SELECT name, branch FROM warehouses").all()) as Array<{ name: string; branch: string }>
  const warehouseBranch = new Map(warehouses.map((row) => [nameKey(row.name), row.branch]))
  const stockKeys = new Set([...(stock.get(beginDay)?.keys() ?? []), ...(stock.get(params.to)?.keys() ?? [])])
  for (const warehouse of stockKeys) {
    add(warehouseBranch.get(warehouse) ?? "", spec("assets", "Склад"), base, stock.get(beginDay)?.get(warehouse) ?? 0, stock.get(params.to)?.get(warehouse) ?? 0)
  }

  // Additional supply expenses: capitalized into Склад (like the stock, the
  // organization filter does not apply) — unpaid = passive, overpaid / paid
  // ahead of the acceptance = asset; on the branch of the supply's warehouse.
  // A remainder below half a cent of the expense currency is conversion noise: settled.
  const settled = (value: number) => (Math.abs(value) < 0.005 ? 0 : value)
  for (const row of await supplyExpenseBalances(db, s, base, params.from, params.to)) {
    const branch = warehouseBranch.get(nameKey(row.warehouse)) ?? row.branch ?? ""
    const begin = settled(Number(row.begin_amount ?? 0))
    const end = settled(Number(row.end_amount ?? 0))
    add(branch, spec("passives", "Неоплаченные доп. расходы"), row.cur, Math.max(0, begin), Math.max(0, end))
    add(branch, spec("assets", "Предоплаченные доп. расходы"), row.cur, Math.max(0, -begin), Math.max(0, -end))
  }

  // Sections per card.
  const missingRates = new Set<string>()
  const toBase = (amount: number, currency: string) => {
    const rate = cc.rates[currency]
    if (!rate) {
      if (amount) missingRates.add(currency)
      return 0
    }
    return amount * rate
  }
  const usdRate = base !== "USD" ? cc.rates.USD : null
  const query = `fromDate=${params.from}&toDate=${params.to}`
  const wanted = new Set((params.branches ?? []).map(nameKey).filter(Boolean))

  const branches: ManagementBranch[] = []
  for (const [key, item] of cards) {
    if (wanted.size && !wanted.has(key)) continue
    const sections: ManagementSection[] = []
    for (const section of ["assets", "passives"] as const) {
      const lines: ManagementLine[] = []
      // Unrounded amounts: the section totals (and equity) sum these, so the
      // cent rounding of a foreign-currency line does not move them.
      const exact: Array<{ begin: number; end: number; currency: string }> = []
      for (const line of LINES.filter((candidate) => candidate.section === section)) {
        const codes = line.perCurrency ? cc.currencies.map((currency) => currency.code) : [base]
        for (const code of codes) {
          const amount = item.amounts.get(`${section}|${line.label}|${code}`)
          const always = line.key === "stock" || (line.key === "cashbox" && code === base)
          if (!amount && !always) continue
          const begin = roundMoney(amount?.begin ?? 0)
          const end = roundMoney(amount?.end ?? 0)
          if (!begin && !end && !always) continue
          exact.push({ begin: amount?.begin ?? 0, end: amount?.end ?? 0, currency: code })
          lines.push({
            key: line.key,
            label: line.label,
            currency: code,
            perCurrency: line.perCurrency,
            begin_balance: begin,
            end_balance: end,
            difference: roundMoney(end - begin),
            href: line.href(key === "" ? "" : item.name, query),
          })
        }
      }
      const begin = roundMoney(exact.reduce((sum, line) => sum + toBase(line.begin, line.currency), 0))
      const end = roundMoney(exact.reduce((sum, line) => sum + toBase(line.end, line.currency), 0))
      sections.push({ key: section, label: section === "assets" ? "Активы" : "Пассивы", begin_balance: begin, end_balance: end, difference: roundMoney(end - begin), lines })
    }
    const [assets, passives] = sections
    const profitBegin = roundMoney(assets.begin_balance - passives.begin_balance)
    const profitEnd = roundMoney(assets.end_balance - passives.end_balance)
    sections.push({ key: "profit", label: "Собственный капитал", begin_balance: profitBegin, end_balance: profitEnd, difference: roundMoney(profitEnd - profitBegin), lines: [] })
    if (usdRate) sections.push({ key: "rate", label: "Курс", begin_balance: usdRate, end_balance: usdRate, difference: 0, lines: [] })

    const empty = sections.every((section) => !section.begin_balance && !section.end_balance && section.lines.every((line) => !line.begin_balance && !line.end_balance))
    if (item.id === null && empty) continue
    branches.push({ id: item.id, name: item.name, sections })
  }
  // Registered branches by id, then cards named only on documents, "Без филиала" last.
  branches.sort((a, b) => {
    const rank = (branch: ManagementBranch) => (branch.id !== null ? 0 : branch.name === NO_BRANCH_LABEL ? 2 : 1)
    return rank(a) - rank(b) || (a.id ?? 0) - (b.id ?? 0) || a.name.localeCompare(b.name, "ru")
  })

  return { from: params.from, to: params.to, baseCurrency: base, currencies: cc.currencies, missingRates: [...missingRates].sort(), branches }
}
