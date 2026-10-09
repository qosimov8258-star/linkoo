import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { cashErrorResponse } from "@/lib/cash/api"
import { bulkUpdateCustomerPayments, customerPaymentBulkUpdateSchema } from "@/lib/cash/customer-payments"

// POST /api/cash/customer-payments/bulk-update { ids, changeInvoiceDate, invoiceDate } → { updated }
// ("Изменить выбранные оплаты", demo client_transaction/bulk_update).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, customerPaymentBulkUpdateSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await bulkUpdateCustomerPayments(parsed.data))
  } catch (error) {
    return cashErrorResponse(error)
  }
}
