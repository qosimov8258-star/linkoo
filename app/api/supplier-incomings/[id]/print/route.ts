import { NextRequest, NextResponse } from "next/server"

import { requirePurchaseReader } from "@/lib/company-money"
import { incomingNotFound } from "@/lib/supplier-incomings-api"
import { MAX_SUPPLY_PRINT_COPIES, SupplyPrintError, renderSupplyPrintPages } from "@/lib/supplier-incomings-print"
import { parseRouteId } from "@/lib/supplier-refs"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/supplier-incomings/<id>/print?template=5&count=1 → { pages: [{ html }] }: the print template (Справочники →
// Шаблоны документов, key «supply») merged with the supply, `count` copies — Linko's saas/merge_template/ that its card
// print menu shows and prints.
export async function GET(request: NextRequest, { params }: RouteParams) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const id = parseRouteId((await params).id)
  if (!id) return incomingNotFound()
  const search = request.nextUrl.searchParams
  const template = search.get("template") ?? ""
  const countText = search.get("count") || "1"
  if (!/^\d{1,10}$/.test(template) || Number(template) <= 0 || Number(template) > 2_147_483_647) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  if (!/^\d{1,3}$/.test(countText)) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  const count = Math.min(MAX_SUPPLY_PRINT_COPIES, Math.max(1, Number(countText)))
  try {
    const pages = await renderSupplyPrintPages(id, Number(template), count)
    return NextResponse.json({ pages: pages.map((html) => ({ html })) })
  } catch (error) {
    if (error instanceof SupplyPrintError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
