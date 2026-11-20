import { NextRequest, NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { notSignedInResponse, parseIdSegment } from "@/lib/validation"
import { MAX_WRITE_OFF_PRINT_COPIES, WriteOffPrintError, renderWriteOffPrintPages } from "@/lib/write-offs-print"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/write-offs/<id>/print?template=5&count=1 → { pages: [{ html }] }: the print template (Справочники → Шаблоны
// документов, key «writeoff») merged with the write-off, `count` copies — what Linko's card print menu prints.
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const id = parseIdSegment((await params).id)
  if (!id) return NextResponse.json({ error: "Списание не найдено" }, { status: 404 })
  const search = request.nextUrl.searchParams
  const template = search.get("template") ?? ""
  const countText = search.get("count") || "1"
  if (!/^\d{1,10}$/.test(template) || Number(template) <= 0 || Number(template) > 2_147_483_647) return NextResponse.json({ error: "Шаблон не найден" }, { status: 404 })
  if (!/^\d{1,3}$/.test(countText)) return NextResponse.json({ error: "Неверные данные" }, { status: 400 })
  const count = Math.min(MAX_WRITE_OFF_PRINT_COPIES, Math.max(1, Number(countText)))
  try {
    const pages = await renderWriteOffPrintPages(id, Number(template), count)
    return NextResponse.json({ pages: pages.map((html) => ({ html })) })
  } catch (error) {
    if (error instanceof WriteOffPrintError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
