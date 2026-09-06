import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import {
  createInvoiceIncoming,
  listInvoiceIncomings,
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

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json((await listInvoiceIncomings()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, invoiceIncomingSchema)
  if (parsed.error) return parsed.error

  const item = (await createInvoiceIncoming(toInvoiceIncomingInput(parsed.data)))
  return NextResponse.json(item, { status: 201 })
}
