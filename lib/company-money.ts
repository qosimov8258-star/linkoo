import "server-only"

import type { NextResponse } from "next/server"

import { getCurrentUser, type CurrentUser } from "@/lib/current-user"
import { forbiddenResponse, hasFullFieldScope } from "@/lib/field-activity/actor"
import { hasPermission } from "@/lib/rbac"
import { notSignedInResponse } from "@/lib/validation"

// Company-wide money (P&L, management balance, cash / staff / branch balances, salaries, expense
// reports) is read by the administrators, the readers with the full field scope and the holders
// of these permissions (accountants, cashiers, report staff). Everyone else, the agents and the
// deliverers first of all, works with their own clients and orders only: the dashboard shows them
// their own figures (app/api/dashboard-summary) and these reports answer 403.
export const COMPANY_MONEY_PERMISSIONS = ["finance.manage", "cash.manage", "reports.manage"]

export function canReadCompanyMoney(user: CurrentUser): boolean {
  return hasFullFieldScope(user) || COMPANY_MONEY_PERMISSIONS.some((code) => hasPermission(user, code))
}

export type MoneyReader = { user: CurrentUser; error?: undefined } | { user?: undefined; error: NextResponse }

async function requireReader(allowed: (user: CurrentUser) => boolean): Promise<MoneyReader> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  if (!allowed(user)) return { error: forbiddenResponse() }
  return { user }
}

/** The signed-in reader of company money, or the refusal (401 / 403). Besides the reports this
 * guards the cash desk itself: the operations of every cashbox with their totals, the cashbox
 * balances, unverified operations, the cash handed in by agents, and the manual balance entries of
 * employees, branches and van-sell agents. (Any signed-in employee, a driver included, could read
 * all of that through the API before 2026-11-11: what each cashbox holds, every expense and every
 * salary payout.) */
export function requireCompanyMoneyReader(): Promise<MoneyReader> {
  return requireReader(canReadCompanyMoney)
}

// Money owed to and paid to suppliers (supplier payments, manual supplier balance entries, money
// requests): the readers of company money and the purchasing staff — the rule GET /api/balances/supplier
// already follows.
export function canReadSupplierMoney(user: CurrentUser): boolean {
  return canReadCompanyMoney(user) || hasPermission(user, "procurement.manage")
}

export function requireSupplierMoneyReader(): Promise<MoneyReader> {
  return requireReader(canReadSupplierMoney)
}

// Purchase documents and cost prices (supplier incomings and returns with their prices, suppliers,
// incoming invoices, Себестоимость, Формирование цен): the people who buy, store, produce or price
// the goods and the readers of company money. The sales field staff (agents, deliverers,
// merchandisers, collectors) sell at the price lists and have no use for what the goods cost.
export const PURCHASE_PERMISSIONS = ["procurement.manage", "stock.manage", "production.manage", "catalog.manage"]

export function canReadPurchases(user: CurrentUser): boolean {
  return canReadCompanyMoney(user) || PURCHASE_PERMISSIONS.some((code) => hasPermission(user, code))
}

export function requirePurchaseReader(): Promise<MoneyReader> {
  return requireReader(canReadPurchases)
}
