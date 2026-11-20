import { NextRequest, NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { supplyCostRows } from "@/lib/supplier-incomings-costs"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/supplier-incomings/[id]/cost-lines → SupplyCostRow[] (the card's «Себестоимость» tab, base currency).
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const id = parseRouteId((await params).id)
  const rows = id ? await supplyCostRows(id) : null
  if (!rows) return NextResponse.json({ error: "Поставка не найдена" }, { status: 404 })
  return NextResponse.json(rows)
}
