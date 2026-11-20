import { NextResponse } from "next/server"

import { MAX_PRINT_COPIES, ReturnPrintError, parsePrintIds, renderReturnPrintPages } from "@/lib/client-returns-print"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/client-returns/print?ids=205-207&template=2&count=1 → { pages: [{ html }] }: the print template
// (Справочники → Шаблоны документов, key «order_return») merged with every return, `count` copies of each —
// the reference's saas/merge_template/ over sales/order_return/print/?ids=…, which its print menu shows and prints.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const search = new URL(request.url).searchParams
  const ids = parsePrintIds(search.getAll("ids"))
  const template = search.get("template") ?? ""
  const countText = search.get("count") || "1"
  if (!ids) return NextResponse.json({ error: "Выберите хотя бы один возврат !" }, { status: 400 })
  if (!/^\d{1,10}$/.test(template) || Number(template) <= 0 || Number(template) > 2_147_483_647) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  if (!/^\d{1,3}$/.test(countText)) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  const count = Math.min(MAX_PRINT_COPIES, Math.max(1, Number(countText)))
  try {
    const pages = await renderReturnPrintPages(ids, Number(template), count)
    return NextResponse.json({ pages: pages.map((html) => ({ html })) })
  } catch (error) {
    if (error instanceof ReturnPrintError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
