import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { cashboxErrorResponse, createCashbox, listCashboxes, listCashboxesPage } from "@/lib/cashboxes-repo"
import { cashboxInputSchema, cashboxListQuerySchema, cashboxQueryObject, wantsPagedCashboxes } from "@/lib/cashboxes-schema"
import { requireRole } from "@/lib/rbac"
import { notSignedInResponse, parseJsonBody, zodErrorResponse } from "@/lib/validation"

// GET /api/cashboxes — plain array of Cashbox for every cashbox select (optional
// ?search= / ?q=), in the demo order (position, "Не указано" last, then id desc).
// With ?page / ?pageSize (or ?paged=1) it returns the grid of the "Кассы" page
// instead: {count, results} — demo GET finance/cashbox/?search&page&page_size.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const params = new URL(request.url).searchParams
  const query = cashboxListQuerySchema.safeParse(cashboxQueryObject(params))
  if (!query.success) return zodErrorResponse(query.error)
  if (wantsPagedCashboxes(params)) return NextResponse.json(await listCashboxesPage(query.data))
  return NextResponse.json(await listCashboxes(query.data.search ?? ""))
}

// POST /api/cashboxes {name, currency, cashierId, branchId?, paymentType, vansell, orderNumber}
// — demo POST finance/cashbox/ {name, currency, cashier, branch, type, is_van_sell, position}.
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, cashboxInputSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createCashbox(parsed.data), { status: 201 })
  } catch (error) {
    const response = cashboxErrorResponse(error)
    if (response) return response
    throw error
  }
}
