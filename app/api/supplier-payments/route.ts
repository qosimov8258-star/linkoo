import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"
import { listSupplierPayments } from "@/lib/supplier-payments-repo"

// GET /api/supplier-payments — kept for older callers; same query and response as
// GET /api/cash/supplier-payments (live payments only, soft-deleted rows excluded).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [parsed.error.field]: [parsed.error.hint] } } }, { status: 400 })
  }
  return NextResponse.json(await listSupplierPayments(parsed.data))
}
