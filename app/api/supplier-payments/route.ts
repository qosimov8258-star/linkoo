import { NextResponse } from "next/server"

import { requireSupplierMoneyReader } from "@/lib/company-money"
import { parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import { listSupplierPayments } from "@/lib/supplier-payments-repo"
import { invalidFieldResponse } from "@/lib/validation"

// GET /api/supplier-payments — kept for older callers; same query and response as
// GET /api/cash/supplier-payments (live payments only, soft-deleted rows excluded).
export async function GET(request: Request) {
  const reader = await requireSupplierMoneyReader()
  if (reader.error) return reader.error
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return invalidFieldResponse(parsed.error.field, parsed.error.hint)
  }
  return NextResponse.json(await listSupplierPayments(parsed.data))
}
