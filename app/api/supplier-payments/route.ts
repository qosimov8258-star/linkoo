import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import { listSupplierPayments } from "@/lib/supplier-payments-repo"
import { notSignedInResponse, invalidFieldResponse } from "@/lib/validation"

// GET /api/supplier-payments — kept for older callers; same query and response as
// GET /api/cash/supplier-payments (live payments only, soft-deleted rows excluded).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return invalidFieldResponse(parsed.error.field, parsed.error.hint)
  }
  return NextResponse.json(await listSupplierPayments(parsed.data))
}
