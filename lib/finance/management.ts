import "server-only"

import { getDb, type PgDb } from "@/lib/db"
import { loadCurrencyContext, withSeenCodes } from "@/lib/finance/context"
import { roundMoney } from "@/lib/finance/currency"
import { nameKey, placeName } from "@/lib/finance/entities"
import { getBalanceList } from "@/lib/finance/ledger"
import { ensureFinanceSchema } from "@/lib/finance/schema"
import { stockValuesAsOf } from "@/lib/finance/stock"
import type { BalanceListResult, ManagementBalanceResult, ManagementBranch, ManagementLine, ManagementSection } from "@/lib/finance/types"

// "Управленческий баланс по филиалам": a balance sheet per branch built on the
// same entity balances the other balance pages show (getBalanceList), so all
// pages agree. Begin = state before `from`, end = state at `to` (inclusive).
// Counterparty balances are split by sign per counterparty:
//   client  < 0 → asset "Задолженность клиентов",   > 0 → passive "Авансы, полученные от покупателей"
//   supplier > 0 → asset "Предоплаты поставщикам",  < 0 → passive "Долги поставщикам"
//   employee < 0 → asset "Авансы, выданные по оплате труда", > 0 → passive "Задолженность по оплате труда"
//   branch  < 0 → asset "Задолженность филиалов",   > 0 → passive "Авансы полученные от филиалов"
// Each line is attributed to the entity's own branch (cashboxes.branch,
// clients.branch, suppliers.branch, employees.branch, warehouses.branch, the
// branch itself); "" goes to the virtual card "Без филиала" (id null).

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
  { key: "market_balance", label: "Авансы, полученные от покупателей", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/client-balance?${q}` },
  { key: "provider_balance", label: "Долги поставщикам", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/supplier-balance?${q}` },
  { key: "staff_balance", label: "Задолженность по оплате труда", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/employee-balance?${q}` },
  { key: "cashback_balance", label: "Кешбэк покупателей", section: "passives", perCurrency: false, href: () => "/analytics/loyalty-card" },
  { key: "branch_balance", label: "Авансы полученные от филиалов", section: "passives", perCurrency: true, href: (_b, q) => `/analytics/branch-balance?${q}` },
]

export const NO_BRANCH_LABEL = "Без филиала"

type Card = { id: number | null; name: string; amounts: Map<string, { begin: number; end: number }> }

function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
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
  splitBySign(branchRows, spec("passives", "Авансы полученные от филиалов"), spec("assets", "Задолженность филиалов"), (info) => info.branch)

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

  // Stock at net cost per warehouse branch.
  const beginDay = dayBefore(params.from)
  const stock = await stockValuesAsOf(db, s, cc, [beginDay, params.to])
  const warehouses = (await db.prepare("SELECT name, branch FROM warehouses").all()) as Array<{ name: string; branch: string }>
  const warehouseBranch = new Map(warehouses.map((row) => [nameKey(row.name), row.branch]))
  const stockKeys = new Set([...(stock.get(beginDay)?.keys() ?? []), ...(stock.get(params.to)?.keys() ?? [])])
  for (const warehouse of stockKeys) {
    add(warehouseBranch.get(warehouse) ?? "", spec("assets", "Склад"), base, stock.get(beginDay)?.get(warehouse) ?? 0, stock.get(params.to)?.get(warehouse) ?? 0)
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
      for (const line of LINES.filter((candidate) => candidate.section === section)) {
        const codes = line.perCurrency ? cc.currencies.map((currency) => currency.code) : [base]
        for (const code of codes) {
          const amount = item.amounts.get(`${section}|${line.label}|${code}`)
          const always = line.key === "stock" || (line.key === "cashbox" && code === base)
          if (!amount && !always) continue
          const begin = roundMoney(amount?.begin ?? 0)
          const end = roundMoney(amount?.end ?? 0)
          if (!begin && !end && !always) continue
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
      const begin = roundMoney(lines.reduce((sum, line) => sum + toBase(line.begin_balance, line.currency), 0))
      const end = roundMoney(lines.reduce((sum, line) => sum + toBase(line.end_balance, line.currency), 0))
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
