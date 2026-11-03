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

/** The signed-in reader of company money, or the refusal (401 / 403). */
export async function requireCompanyMoneyReader(): Promise<{ user: CurrentUser; error?: undefined } | { user?: undefined; error: NextResponse }> {
  const user = await getCurrentUser()
  if (!user) return { error: notSignedInResponse() }
  if (!canReadCompanyMoney(user)) return { error: forbiddenResponse() }
  return { user }
}
