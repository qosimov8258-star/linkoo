import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  deleteInvoiceIncoming,
  updateInvoiceIncoming,
  INVOICE_INCOMING_STATUSES,
  type InvoiceIncomingInput,
} from "@/lib/invoice-incomings-repo"

const invoiceIncomingSchema = z.object({
  supplier: z.string().trim().min(1),
  documentNumber: z.string().trim().optional(),
  date: z.string().optional(),
  amount: z.coerce.number().optional(),
  branch: z.string().trim().optional(),
  status: z.string().optional(),
  note: z.string().trim().optional(),
})

function toInvoiceIncomingInput(data: z.infer<typeof invoiceIncomingSchema>): InvoiceIncomingInput {
  const status = data.status && (INVOICE_INCOMING_STATUSES as readonly string[]).includes(data.status)
    ? data.status
    : INVOICE_INCOMING_STATUSES[0]
  return {
    documentNumber: data.documentNumber ?? "",
    supplier: data.supplier,
    date: data.date || new Date().toISOString().slice(0, 10),
    amount: data.amount ?? 0,
    branch: data.branch ?? "",
    status,
    note: data.note ?? "",
  }
}

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, invoiceIncomingSchema)
  if (parsed.error) return parsed.error

  const item = (await updateInvoiceIncoming(id, toInvoiceIncomingInput(parsed.data)))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteInvoiceIncoming(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
