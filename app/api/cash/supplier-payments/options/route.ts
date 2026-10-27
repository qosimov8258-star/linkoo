import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { supplierPaymentsOptions } from "@/lib/cash/supplier-payments"
import { notSignedInResponse } from "@/lib/validation"

// GET /api/cash/supplier-payments/options → { baseCurrency, organizations, branches, suppliers: [{id, name}], currencies }
// (filter choices of "Оплаты поставщикам").
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return notSignedInResponse()
  return NextResponse.json(await supplierPaymentsOptions())
}
