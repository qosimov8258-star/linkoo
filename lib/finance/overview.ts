import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCategories } from "@/lib/cash/common"
import { expensesByCategory } from "@/lib/cash/reports"
import { CASH_OP, CASH_OP_TYPES, type CashOpType, type CategoryOptionKey } from "@/lib/cash/types"
import { loadCurrencyContext } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { getManagementBalance } from "@/lib/finance/management"
import type { BalanceOverview, OverviewAmount } from "@/lib/finance/overview-types"
import { getPnl } from "@/lib/finance/pnl"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { stockValuesAsOf } from "@/lib/finance/stock"

// The dashboard tab "БАЛАНС" (/analytics/balance-tab) in one request: the
// management balance summed over every branch (the same numbers as
// "Управленческий баланс по филиалам"), cashbox movements (Баланс кассы),
// stock value per warehouse, client debts by client type (Баланс клиентов),
// supplier obligations (Баланс поставщиков), sales of the period (P&L) and
// expenses by category (Расходы по категориям).

// "Прямые / Косвенные расходы" are the costs of the period. Money that only settles a
// balance is not one: a supplier payment (or paid money request) settles what we owe for
// goods that went to stock and reach the P&L later as cost of goods; a supply extra cost
// is part of that cost of goods; a payout to a client (withdrawal from the client's
// account, cashback, card cash-out, refund) uses up the client's credit or a cashback
// liability that was booked before. So only plain cashbox expenses count, and of those
// not the ones whose category settles a balance (its options) or is excluded from P&L.

/** Category options that make a payment a settlement (see above). */
const SETTLEMENT_OPTIONS: ReadonlySet<CategoryOptionKey> = new Set<CategoryOptionKey>(["supply", "provider", "supply_expense", "client", "client_contract", "client_card_out"])
/** Operation types that are settlements (or transfer legs), whatever their category. */
const SETTLEMENT_OPS: ReadonlySet<CashOpType> = new Set<CashOpType>([
  CASH_OP.FROM_TRANSFER,
  CASH_OP.TO_TRANSFER,
  CASH_OP.OUTCOME_FROM_CLIENT,
  CASH_OP.SUPPLY_EXPENSE,
  CASH_OP.OUTCOME_FOR_SUPPLY,
  CASH_OP.CLIENT_CONTRACT_OUT,
])
/** Operation types of plain cashbox entries that can be a cost of the period. */
const PERIOD_EXPENSE_OPS: CashOpType[] = CASH_OP_TYPES.filter((op) => !SETTLEMENT_OPS.has(op))

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

export async function getBalanceOverview(params: { from: string; to: string; organizations?: string[] }, db: PgDb = getDb()): Promise<BalanceOverview> {
  const organizations = params.organizations ?? []
  const s = await ensureFinanceSchema(db)
  const cc = await loadCurrencyContext(db)
  const period = { from: params.from, to: params.to, organizations, pageSize: 0 }
  const [management, cash, clients, suppliers, pnl, expenses] = await Promise.all([
    getManagementBalance({ from: params.from, to: params.to, organizations }, db),
    getBalanceList("cashbox", period, db),
    getBalanceList("client", { ...period, groupBy: "type" }, db),
    getBalanceList("supplier", period, db),
    getPnl({ periods: [{ from: params.from, to: params.to }], filters: { organizations } }, db),
    // Plain cashbox entries only: supplier / client money (their own tables) are settlements.
    expensesByCategory({ from: params.from, to: params.to, organizations, pageSize: 0, sources: ["cash"], types: PERIOD_EXPENSE_OPS }, db),
  ])

  // Management lines summed over the branch cards.
  const lines = new Map<string, BalanceOverview["lines"][number]>()
  const totals = { assets: { begin: 0, end: 0 }, passives: { begin: 0, end: 0 }, equity: { begin: 0, end: 0 } }
  for (const branch of management.branches) {
    for (const section of branch.sections) {
      if (section.key === "assets" || section.key === "passives") {
        totals[section.key].begin += section.begin_balance
        totals[section.key].end += section.end_balance
        for (const line of section.lines) {
          const id = `${section.key}|${line.label}|${line.currency}`
          const entry = lines.get(id) ?? { key: line.key, label: line.label, section: section.key, currency: line.currency, begin: 0, end: 0 }
          entry.begin += line.begin_balance
          entry.end += line.end_balance
          lines.set(id, entry)
        }
      }
      if (section.key === "profit") {
        totals.equity.begin += section.begin_balance
        totals.equity.end += section.end_balance
      }
    }
  }

  const cashboxes = cash.rows.map((row) => {
    const currency = String(row.info.currency || cc.base)
    const balance = row.currencies[currency]
    return {
      id: row.id,
      name: row.name,
      currency,
      begin: roundMoney(balance?.begin_balance ?? 0),
      income: roundMoney(balance?.income ?? 0),
      expenses: roundMoney(balance?.expenses ?? 0),
      transferIncome: roundMoney(balance?.transfer_income ?? 0),
      transferExpense: roundMoney(balance?.transfer_expense ?? 0),
      end: roundMoney(balance?.end_balance ?? 0),
    }
  })

  // Stock value per warehouse (base currency), begin = end of the day before `from`.
  const beginDay = dayBefore(params.from)
  const stock = await stockValuesAsOf(db, s, cc, [beginDay, params.to])
  const warehouseNames = s.has("warehouses") ? ((await db.prepare("SELECT name FROM warehouses ORDER BY id").all()) as Array<{ name: string }>) : []
  const byKey = new Map(warehouseNames.map((row) => [nameKey(row.name), row.name]))
  const keys = new Set([...(stock.get(beginDay)?.keys() ?? []), ...(stock.get(params.to)?.keys() ?? []), ...byKey.keys()])
  const warehouses = [...keys]
    .map((key) => ({ name: byKey.get(key) ?? key, begin: roundMoney(stock.get(beginDay)?.get(key) ?? 0), end: roundMoney(stock.get(params.to)?.get(key) ?? 0) }))
    .filter((row) => row.begin || row.end || byKey.has(nameKey(row.name)))

  // Client debts by client type and supplier obligations: what is owed, as a positive amount.
  const owed = (rows: typeof clients.rows, name: (row: (typeof clients.rows)[number]) => string): OverviewAmount[] =>
    rows.flatMap((row) =>
      Object.entries(row.currencies)
        .filter(([, balance]) => balance.begin_balance || balance.end_balance)
        .map(([currency, balance]) => ({ name: name(row), currency, begin: roundMoney(-balance.begin_balance), end: roundMoney(-balance.end_balance) })),
    )

  // Expenses by category, split into direct (Прямой расход на товар) and indirect. Left out:
  // P&L-excluded categories and settlement categories (SETTLEMENT_OPTIONS, see the header).
  // (expensesByCategory installed the cash schema, so the category options are there.)
  const categoryOf = new Map(
    (await loadCategories(db))
      .filter((category) => category.kind === "expense")
      .map((category) => [
        category.id,
        { direct: category.internal, exclude: category.excludeFromPnl || category.options.some((option) => SETTLEMENT_OPTIONS.has(option)) },
      ]),
  )
  const expenseGroups = { direct: new Map<string, number>(), indirect: new Map<string, number>() }
  for (const row of expenses.rows) {
    const info = row.categoryId !== null ? categoryOf.get(row.categoryId) : undefined
    if (info?.exclude) continue
    const group = info?.direct ? expenseGroups.direct : expenseGroups.indirect
    const name = row.name || "Не указано"
    group.set(name, (group.get(name) ?? 0) - row.baseAmount)
  }
  const expenseRows = (map: Map<string, number>) =>
    [...map.entries()].map(([name, amount]) => ({ name, amount: roundMoney(amount) })).filter((row) => row.amount).sort((a, b) => b.amount - a.amount)

  const cashIncome: Record<string, number> = {}
  for (const row of cashboxes) cashIncome[row.currency] = roundMoney((cashIncome[row.currency] ?? 0) + row.income)

  return {
    from: params.from,
    to: params.to,
    baseCurrency: cc.base,
    currencies: management.currencies,
    missingRates: [...new Set([...management.missingRates, ...pnl.missingRates])].sort(),
    lines: [...lines.values()].map((line) => ({ ...line, begin: roundMoney(line.begin), end: roundMoney(line.end) })),
    totals: {
      assets: { begin: roundMoney(totals.assets.begin), end: roundMoney(totals.assets.end) },
      passives: { begin: roundMoney(totals.passives.begin), end: roundMoney(totals.passives.end) },
      equity: { begin: roundMoney(totals.equity.begin), end: roundMoney(totals.equity.end) },
    },
    cashboxes,
    cashIncome,
    warehouses,
    clientDebts: owed(clients.rows, (row) => row.name || "Не указано"),
    supplierDebts: owed(suppliers.rows, (row) => row.name),
    sales: pnl.totals[0],
    salesByType: pnl.groups.productType,
    salesByBrand: pnl.groups.brand,
    salesByAgent: pnl.groups.agent,
    expenses: { direct: expenseRows(expenseGroups.direct), indirect: expenseRows(expenseGroups.indirect) },
  }
}
