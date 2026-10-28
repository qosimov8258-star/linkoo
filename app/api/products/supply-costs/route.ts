import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { supplyAverageCosts } from "@/lib/supplier-incomings-repo"

/** Average cost of accepted supplies per product name (lower-cased) → read-only helper of "Формирование цен". */
export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })
  return NextResponse.json(await supplyAverageCosts())
}
