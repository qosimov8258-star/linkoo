import { NextResponse } from "next/server"

import { requireSupplierMoneyReader } from "@/lib/company-money"
import { supplierPaymentsOptions } from "@/lib/cash/supplier-payments"

// GET /api/cash/supplier-payments/options → { baseCurrency, organizations, branches, suppliers: [{id, name}], currencies }
// (filter choices of "Оплаты поставщикам").
export async function GET() {
  const reader = await requireSupplierMoneyReader()
  if (reader.error) return reader.error
  return NextResponse.json(await supplierPaymentsOptions())
}
