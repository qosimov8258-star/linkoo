import { NextResponse } from "next/server"

import { MAX_PRINT_COPIES, parsePrintIds } from "@/lib/client-returns-print"
import { requirePurchaseReader } from "@/lib/company-money"
import { SupplierReturnPrintError, renderSupplierReturnPrintPages } from "@/lib/supplier-returns-print"

// GET /api/supplier-returns/print?ids=22&template=6&count=1 → { pages: [{ html }] }: the print template (Справочники →
// Шаблоны документов, key «provider_return») merged with every return, `count` copies of each — Linko's print menu of
// the supplier return card (docs_builder/merge_template/).
export async function GET(request: Request) {
  const reader = await requirePurchaseReader()
  if (reader.error) return reader.error
  const search = new URL(request.url).searchParams
  const ids = parsePrintIds(search.getAll("ids"))
  const template = search.get("template") ?? ""
  const countText = search.get("count") || "1"
  if (!ids) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  if (!/^\d{1,10}$/.test(template) || Number(template) <= 0 || Number(template) > 2_147_483_647) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  if (!/^\d{1,3}$/.test(countText)) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  const count = Math.min(MAX_PRINT_COPIES, Math.max(1, Number(countText)))
  try {
    const pages = await renderSupplierReturnPrintPages(ids, Number(template), count)
    return NextResponse.json({ pages: pages.map((html) => ({ html })) })
  } catch (error) {
    if (error instanceof SupplierReturnPrintError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
