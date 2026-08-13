import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { listCustomerPayments } from "@/lib/customer-payments-repo"

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(listCustomerPayments())
}
