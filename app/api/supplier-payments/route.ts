import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listSupplierPayments } from "@/lib/supplier-payments-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listSupplierPayments())
}
