import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { fundRequestStatusSchema, supplierBalanceResponse, supplierBalanceUpdateSchema } from "@/lib/finance-supplier-balance"
import { requireRole } from "@/lib/rbac"
import {
  deleteSupplierBalanceTransaction,
  getSupplierBalanceTransaction,
  setFundRequestStatus,
  updateSupplierBalanceTransaction,
  type SupplierBalanceResult,
} from "@/lib/supplier-balance-repo"
import { parseRouteId } from "@/lib/supplier-refs"
import { notSignedInResponse, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

/** A paid / cancelled money request is final (the cash core owns its lifecycle). */
const CLOSED = "Запрос уже закрыт"

function respond(result: SupplierBalanceResult) {
  if (result.error === "locked") return NextResponse.json({ error: CLOSED }, { status: 409 })
  return supplierBalanceResponse(result)
}

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()

  const id = parseRouteId((await params).id)
  const transaction = id ? await getSupplierBalanceTransaction(id) : null
  return transaction ? NextResponse.json(transaction) : notFound()
}

/** "Изменение баланса поставщика": signed amount, currency, payment type, organization, date, comment.
 * A money request's status change goes through the cash core; 409 for a request that is given / cancelled / paid. */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, supplierBalanceUpdateSchema)
  if (parsed.error) return parsed.error

  return respond(await updateSupplierBalanceTransaction(id, parsed.data, auth.user.displayName || auth.user.username))
}

/** Money request approval: { status: "pending" | "approved" | "rejected" }; 409 once given / cancelled. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, fundRequestStatusSchema)
  if (parsed.error) return parsed.error

  return respond(await setFundRequestStatus(id, parsed.data.status, auth.user.displayName || auth.user.username))
}

/** 409 for a money request that is approved / given (paid) — only pending or cancelled ones can be deleted. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseRouteId((await params).id)
  if (!id) return notFound()
  const result = await deleteSupplierBalanceTransaction(id)
  if (result === "not_found") return notFound()
  if (result === "locked") return NextResponse.json({ error: "Подтвержденный или оплаченный запрос удалить нельзя" }, { status: 409 })
  return NextResponse.json({ ok: true })
}
