import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { dateReasonFirst } from "@/lib/document-dates"
import { vansellTransactionCreateSchema } from "@/lib/finance-vansell-balance-api"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { createVansellTransaction, listVansellTransactions } from "@/lib/vansell-transactions-repo"

// Manual van-sell movements ("Баланс вансел"). Balances / statements are
// served by the shared ledger: GET /api/balances/vansell[/statement].

/** GET ?employeeId= → manual movements, newest first. */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const param = (new URL(request.url).searchParams.get("employeeId") ?? "").trim()
  if (!param) return NextResponse.json(await listVansellTransactions({}))
  // An id that is not a positive int4 matches no employee (never a 500).
  const employeeId = parseIdSegment(param)
  return NextResponse.json(employeeId ? await listVansellTransactions({ employeeId }) : [])
}

/** "Добавить" (kind add) / "Добавить расход" (kind expense). */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, vansellTransactionCreateSchema)
  // A refused date answers its reason ("Дата не может быть позже сегодняшнего дня"), which the dialog shows at «Дата».
  if (parsed.error) return dateReasonFirst(parsed.error)

  const result = await createVansellTransaction(parsed.data, auth.user.displayName)
  if (result === "employee_not_found") return NextResponse.json({ error: "Вансел не найден" }, { status: 404 })
  if (result === "currency_not_found") return NextResponse.json({ error: "Валюта не найдена" }, { status: 400 })
  if (typeof result === "string") return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(result, { status: 201 })
}
