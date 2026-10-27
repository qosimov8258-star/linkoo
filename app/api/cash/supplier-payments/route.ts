import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSupplierPaymentsPage, parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import { notSignedInResponse, invalidFieldResponse } from "@/lib/validation"

// GET /api/cash/supplier-payments?from&to&organization*&branch*&supplier*&currency&search&ordering&page&pageSize
// → SupplierPaymentsResult { baseCurrency, count, page, pageSize, rows, totals } ("Оплаты поставщикам";
// demo finance/provider_transactions/?type=1 + /total/). Read-only: payments are written by the cash page.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return invalidFieldResponse(parsed.error.field, parsed.error.hint)
  }
  return NextResponse.json(await listSupplierPaymentsPage(parsed.data))
}
