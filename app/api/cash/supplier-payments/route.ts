import { NextResponse } from "next/server"

import { requireSupplierMoneyReader } from "@/lib/company-money"
import { listSupplierPaymentsPage, parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import { invalidFieldResponse } from "@/lib/validation"

// GET /api/cash/supplier-payments?from&to&organization*&branch*&supplier*&currency&search&ordering&page&pageSize
// → SupplierPaymentsResult { baseCurrency, count, page, pageSize, rows, totals } ("Оплаты поставщикам";
// demo finance/provider_transactions/?type=1 + /total/). Read-only: payments are written by the cash page.
export async function GET(request: Request) {
  const reader = await requireSupplierMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return invalidFieldResponse(parsed.error.field, parsed.error.hint)
  }
  return NextResponse.json(await listSupplierPaymentsPage(parsed.data))
}
