import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { normCurrency, roundMoney } from "@/lib/finance/currency"
import { nowLocalIso, todayIso } from "@/lib/finance/dates"
import { getBalanceList } from "@/lib/finance/ledger"
import { CashError, convertMoneyFor, currencyContext, loadCashbox, loadCategories, num, type CategoryInfo } from "@/lib/cash/common"
import { getCashOperation } from "@/lib/cash/list"
import { ensureCashSchema } from "@/lib/cash/schema"
import type { CashboxListResult, CashReceipt, ConvertResult } from "@/lib/cash/types"
import { selectedBranchName } from "@/lib/selected-branch"

// Left column of "Управления кассой" (cashboxes + balances), the currency
// converter of the dialogs (demo finance/convert + finance/currencies/convert),
// categories with options, and the printable receipt ("Квитанция").

/** Every cashbox with its all-time ledger balance (= Баланс кассы end balance), sorted by position. */
export async function listCashboxesWithBalances(db: PgDb = getDb()): Promise<CashboxListResult> {
  await ensureCashSchema(db)
  const list = await getBalanceList("cashbox", { from: "1970-01-01", to: todayIso() }, db)
  const totals: Record<string, number> = {}
  // The branch picked in the account menu narrows the cashbox column like the other cashbox lists.
  const branch = await selectedBranchName()
  const cashboxes = list.rows.filter((row) => !branch || String(row.info.branch ?? "") === branch).map((row) => {
    const currency = normCurrency(String(row.info.currency ?? ""), list.baseCurrency)
    const balance = roundMoney(num(row.currencies[currency]?.end_balance))
    totals[currency] = roundMoney((totals[currency] ?? 0) + balance)
    return {
      id: Number(row.id),
      name: row.name,
      type: row.info.type === "bank" ? ("bank" as const) : ("cash" as const),
      currency,
      cashier: String(row.info.cashier ?? ""),
      branch: String(row.info.branch ?? ""),
      vansell: Boolean(row.info.vansell),
      position: num(row.info.order_number),
      balance,
    }
  })
  // Same order as the Кассы page: position 0 / empty = "Не указано", last.
  const rank = (position: number) => (position > 0 ? position : Number.MAX_SAFE_INTEGER)
  cashboxes.sort((a, b) => rank(a.position) - rank(b.position) || a.name.localeCompare(b.name, "ru") || a.id - b.id)
  return { baseCurrency: list.baseCurrency, cashboxes, totals }
}

/** Income / expense categories with their options (the dialogs' category selects). */
export async function listCashCategories(kind?: "income" | "expense", db: PgDb = getDb()): Promise<CategoryInfo[]> {
  await ensureCashSchema(db)
  const all = await loadCategories(db)
  return kind ? all.filter((category) => category.kind === kind) : all
}

export type ConvertInput = {
  from: string
  to: string
  amount?: number
  /** Custom base rates ("Курс кассы" / "Курс долга"): base units per 1 unit. */
  fromRate?: number
  toRate?: number
  /** Alternatively a cashbox: its currency becomes `from` / `to` when they are empty. */
  cashboxId?: number
}

/** Currency conversion with the current rates (or the given custom ones).
 * Works with only the base currency configured: base → base = 1. */
export async function convertCurrency(input: ConvertInput, db: PgDb = getDb()): Promise<ConvertResult> {
  await ensureCashSchema(db)
  const cc = await currencyContext(db)
  let from = input.from
  let to = input.to
  if (input.cashboxId) {
    const cashbox = await loadCashbox(db, input.cashboxId, cc.base)
    from ||= cashbox.currency
    to ||= cashbox.currency
  }
  if (!from || !to) throw new CashError("Укажите валюту", 400, "currency")
  return convertMoneyFor(input.amount ?? 1, from, to, cc, input.fromRate, input.toRate)
}

/** Receipt ("Квитанция № …") of one operation. Amounts are absolute values; `direction` tells the sign. */
export async function getReceipt(key: string, db: PgDb = getDb()): Promise<CashReceipt> {
  const operation = await getCashOperation(key, db)
  if (!operation) throw new CashError("Операция не найдена", 404)
  if (operation.type === 2) throw new CashError("Печать недоступна", 409)
  const transfer = operation.type === 1
  const amount = Math.abs(operation.amount)
  const base = operation.baseAmount === null ? null : Math.abs(operation.baseAmount)
  return {
    key: operation.key,
    docNo: operation.docNo,
    type: operation.type,
    title: operation.title,
    createdAt: operation.createdAt || nowLocalIso(),
    date: operation.date,
    cashbox: operation.cashbox.name,
    organization: operation.organization,
    category: transfer ? "Перевод" : (operation.category?.name ?? ""),
    direction: operation.amount >= 0 ? "income" : "expense",
    rows: [{ n: 1, name: operation.comment || operation.title, amount, currency: operation.currency, rate: operation.rate, baseAmount: base }],
    total: base,
    baseCurrency: operation.baseCurrency,
  }
}
