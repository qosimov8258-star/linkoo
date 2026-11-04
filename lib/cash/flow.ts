import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { listCashOperations } from "@/lib/cash/list"
import { baseReportCurrency, loadCurrencyContext } from "@/lib/finance/context"
import type { CashOperation } from "@/lib/cash/types"
import type { CashFlowResult, CashFlowRow, CashFlowSection } from "@/lib/cash/flow-types"

// "Движения денежных средств": the cash flow statement of the period, from the same read model as
// "Управления кассой" and "Баланс кассы" (lib/cash/list.ts: live, verified operations of every
// source — cash journal, client payments, supplier payments, cash acceptances). Amounts are in the
// base currency at each operation's own rate (baseAmount). Rows are the articles: the income /
// expense category, else the operation type (Оплата заказа, Расход на поставку, …); columns are
// the months of the period. Transfers between cash desks are a section of their own (with no cash
// desk filter they cancel out, but for one desk they are its money in / out).

const round = (value: number) => Math.round(value * 100) / 100

/** The day before an ISO day. */
function dayBefore(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/** "YYYY-MM" of every month the period touches. */
function monthsOf(from: string, to: string): string[] {
  const months: string[] = []
  let year = Number(from.slice(0, 4))
  let month = Number(from.slice(5, 7))
  const last = to.slice(0, 7)
  for (let guard = 0; guard < 240; guard++) {
    const key = `${year}-${String(month).padStart(2, "0")}`
    months.push(key)
    if (key >= last) break
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return months
}

function articleOf(operation: CashOperation): string {
  if (operation.category?.name) return operation.category.name
  return operation.title || "Не указано"
}

export type CashFlowQuery = { from: string; to: string; cashboxIds: number[]; branches: string[]; organizations: string[] }

export async function getCashFlow(query: CashFlowQuery, db: PgDb = getDb()): Promise<CashFlowResult> {
  const filters = { cashboxIds: query.cashboxIds, branches: query.branches, organizations: query.organizations }
  const [period, before] = await Promise.all([
    listCashOperations({ ...filters, from: query.from, to: query.to, page: 1, pageSize: 0 }, db),
    listCashOperations({ ...filters, to: dayBefore(query.from), page: 1, pageSize: 0 }, db),
  ])
  const months = monthsOf(query.from, query.to)
  // Base amounts are shown in the app currency when one is chosen (Настройки → Валюта приложения).
  const shown = baseReportCurrency(await loadCurrencyContext(db))
  const valueOf = (row: CashOperation) => (Number(row.baseAmount) || 0) * shown.factor
  const live = (rows: CashOperation[]) => rows.filter((row) => !row.isDeleted && row.isVerified)
  const opening = round(live(before.rows).reduce((sum, row) => sum + valueOf(row), 0))

  const sections: Record<CashFlowSection["key"], Map<string, CashFlowRow>> = { income: new Map(), expense: new Map(), transfer: new Map() }
  for (const operation of live(period.rows)) {
    const amount = valueOf(operation)
    if (!amount) continue
    const transfer = operation.type === 1 || operation.type === 2
    const key: CashFlowSection["key"] = transfer ? "transfer" : amount > 0 ? "income" : "expense"
    const name = transfer ? operation.title : articleOf(operation)
    const month = operation.date.slice(0, 7)
    const row = sections[key].get(name) ?? { name, months: Object.fromEntries(months.map((m) => [m, 0])), total: 0, count: 0 }
    row.months[month] = round((row.months[month] ?? 0) + amount)
    row.total = round(row.total + amount)
    row.count += 1
    sections[key].set(name, row)
  }
  const section = (key: CashFlowSection["key"], title: string): CashFlowSection => {
    const rows = [...sections[key].values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total) || a.name.localeCompare(b.name, "ru"))
    const totals = Object.fromEntries(months.map((m) => [m, round(rows.reduce((sum, row) => sum + (row.months[m] ?? 0), 0))]))
    return { key, title, rows, months: totals, total: round(rows.reduce((sum, row) => sum + row.total, 0)) }
  }
  const result = [section("income", "Приход"), section("expense", "Расход"), section("transfer", "Переводы между кассами")]
  const net = Object.fromEntries(months.map((m) => [m, round(result.reduce((sum, s) => sum + (s.months[m] ?? 0), 0))]))
  const netTotal = round(result.reduce((sum, s) => sum + s.total, 0))
  return { baseCurrency: shown.code, from: query.from, to: query.to, months, opening, sections: result, net, netTotal, closing: round(opening + netTotal) }
}
