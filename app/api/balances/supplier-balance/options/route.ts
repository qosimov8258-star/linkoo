import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSupplierFilterOptions } from "@/lib/finance-supplier-balance"

// GET /api/balances/supplier-balance/options → { organizations, branches }:
// filter options of "Баланс поставщиков" (tables + names used on supplier movements).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await listSupplierFilterOptions())
}
