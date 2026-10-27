import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { supplierBalanceCreateSchema, supplierBalanceListQuerySchema, supplierBalanceResponse } from "@/lib/finance-supplier-balance"
import { requireRole } from "@/lib/rbac"
import { createSupplierBalanceTransaction, listSupplierBalanceTransactions } from "@/lib/supplier-balance-repo"
import { notSignedInResponse, parseJsonBody, zodErrorResponse } from "@/lib/validation"

// Manual supplier balance entries of "Баланс поставщиков". Balances, totals
// and the act are read from /api/balances/supplier(/statement).

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const params = new URL(request.url).searchParams
  const query = supplierBalanceListQuerySchema.safeParse({ supplierId: params.get("supplierId") || undefined, kind: params.get("kind") || undefined })
  if (!query.success) return zodErrorResponse(query.error)

  return NextResponse.json(await listSupplierBalanceTransactions(query.data))
}

/** "Добавить приход / расход поставщику" (kind add / expense) and "Запрос средств" (kind fund_request). */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, supplierBalanceCreateSchema)
  if (parsed.error) return parsed.error

  return supplierBalanceResponse(await createSupplierBalanceTransaction(parsed.data, auth.user.displayName || auth.user.username), 201)
}
