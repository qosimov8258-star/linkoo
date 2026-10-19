import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { fundRequestStatusSchema, supplierBalanceResponse, supplierBalanceUpdateSchema, transactionId } from "@/lib/finance-supplier-balance"
import { requireRole } from "@/lib/rbac"
import {
  deleteSupplierBalanceTransaction,
  getSupplierBalanceTransaction,
  setFundRequestStatus,
  updateSupplierBalanceTransaction,
} from "@/lib/supplier-balance-repo"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Запись не найдена" }, { status: 404 })

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = transactionId((await params).id)
  const transaction = id ? await getSupplierBalanceTransaction(id) : null
  return transaction ? NextResponse.json(transaction) : notFound()
}

/** "Изменение баланса поставщика": signed amount, currency, payment type, organization, date, comment. */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = transactionId((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, supplierBalanceUpdateSchema)
  if (parsed.error) return parsed.error

  return supplierBalanceResponse(await updateSupplierBalanceTransaction(id, parsed.data))
}

/** Money request approval: { status: "pending" | "approved" | "rejected" }. */
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = transactionId((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, fundRequestStatusSchema)
  if (parsed.error) return parsed.error

  return supplierBalanceResponse(await setFundRequestStatus(id, parsed.data.status))
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = transactionId((await params).id)
  if (!id || !(await deleteSupplierBalanceTransaction(id))) return notFound()
  return NextResponse.json({ ok: true })
}
