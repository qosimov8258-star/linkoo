import { NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { invoiceBodySchema, invoiceErrorResponse, parseInvoiceListQuery, toInvoiceInput } from "@/lib/invoice-incomings-api"
import { createInvoice, listInvoices } from "@/lib/invoice-incomings-repo"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

export async function GET(request: Request) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const query = parseInvoiceListQuery(request.url)
  if (query.error) return query.error
  return NextResponse.json(await listInvoices(query.data))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, invoiceBodySchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await createInvoice(toInvoiceInput(parsed.data), auth.user.displayName), { status: 201 })
  } catch (error) {
    return invoiceErrorResponse(error)
  }
}
