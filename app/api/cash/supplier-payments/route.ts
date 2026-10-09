import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSupplierPaymentsPage, parseSupplierPaymentsQuery } from "@/lib/cash/supplier-payments"

// GET /api/cash/supplier-payments?from&to&organization*&branch*&supplier*&currency&search&ordering&page&pageSize
// → SupplierPaymentsResult { baseCurrency, count, page, pageSize, rows, totals } ("Оплаты поставщикам";
// demo finance/provider_transactions/?type=1 + /total/). Read-only: payments are written by the cash page.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  const parsed = parseSupplierPaymentsQuery(request.url)
  if (parsed.error) {
    return NextResponse.json({ error: "Ma'lumotlar noto'g'ri", details: { fieldErrors: { [parsed.error.field]: [parsed.error.hint] } } }, { status: 400 })
  }
  return NextResponse.json(await listSupplierPaymentsPage(parsed.data))
}
