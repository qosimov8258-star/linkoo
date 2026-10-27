import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/finance/api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { branchBalanceTransactionSchema, createBranchBalanceTransaction, listBranchBalanceTransactions } from "@/lib/branch-balance-repo"

// GET  /api/branch-balance-transactions[?branchId=N] → the manual branch ledger rows.
// POST /api/branch-balance-transactions (manager+) → "Добавить" / "Добавить расход"
// of the Баланс филиалов page (balances: GET /api/balances/branch).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const branchId = routeId(new URL(request.url).searchParams.get("branchId") ?? "")
  return NextResponse.json(await listBranchBalanceTransactions(branchId ?? undefined))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, branchBalanceTransactionSchema)
  if (parsed.error) return parsed.error

  const transaction = await createBranchBalanceTransaction(parsed.data, auth.user.displayName || auth.user.username)
  if (transaction === "branch_not_found") return NextResponse.json({ error: "Филиал не найден" }, { status: 404 })
  if (transaction === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  return NextResponse.json(transaction, { status: 201 })
}
