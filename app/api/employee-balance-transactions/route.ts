import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { createEmployeeBalanceTransaction, listEmployeeBalanceTransactions } from "@/lib/employee-balance-repo"
import { employeeBalanceTransactionSchema } from "@/lib/finance-employee-balance-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

// Manual employee movements ("Баланс сотрудников"). Balances / the act are
// served by the shared ledger: GET /api/balances/employee[/statement].

/** GET ?employeeId= → manual movements, newest first. */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const employeeId = Number(new URL(request.url).searchParams.get("employeeId") ?? "")
  return NextResponse.json(await listEmployeeBalanceTransactions(Number.isInteger(employeeId) && employeeId > 0 ? { employeeId } : {}))
}

/** "Зачислить" (kind add) / "Списать" (kind expense) = type none_type; a fine = type penalty (always an expense). */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, employeeBalanceTransactionSchema)
  if (parsed.error) return parsed.error

  const result = await createEmployeeBalanceTransaction(parsed.data, auth.user.displayName || auth.user.username)
  if (result === "employee_not_found") return NextResponse.json({ error: "Сотрудник не найден" }, { status: 404 })
  if (result === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  return NextResponse.json(result, { status: 201 })
}
