import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { invoiceBodySchema, invoiceErrorResponse, invoiceStatusSchema, parseIdParam, toInvoiceInput } from "@/lib/invoice-incomings-api"
import { changeInvoiceStatus, deleteInvoice, getInvoice, updateInvoice } from "@/lib/invoice-incomings-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const notFound = () => NextResponse.json({ error: "Счет-фактура не найдена" }, { status: 404 })

export async function GET(_request: Request, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const id = parseIdParam((await params).id)
  if (!id) return notFound()
  const invoice = await getInvoice(id)
  return invoice ? NextResponse.json(invoice) : notFound()
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, invoiceBodySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await updateInvoice(id, toInvoiceInput(parsed.data)))
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  if (!id) return notFound()
  const parsed = await parseJsonBody(request, invoiceStatusSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await changeInvoiceStatus(id, parsed.data.action, parsed.data.reason, auth.user.displayName))
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdParam((await params).id)
  if (!id) return notFound()
  try {
    await deleteInvoice(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}
