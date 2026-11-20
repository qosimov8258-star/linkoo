import { NextResponse } from "next/server"

import { listSeriesLines } from "@/lib/client-returns-series-repo"
import { getCurrentUser } from "@/lib/current-user"
import { routeId } from "@/lib/orders-api"

// GET /api/client-returns/[id]/series-lines?search= — «Наименование» of «Изменит серии»: the return's lines whose
// product keeps an expiry (Linko's sales/order_return_product/?order_return=&use_expiration=true), one per line.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = routeId((await params).id)
  const search = (new URL(request.url).searchParams.get("search") ?? "").slice(0, 200)
  const rows = id ? await listSeriesLines(id, search) : null
  if (!rows) return NextResponse.json({ error: "Возврат не найден" }, { status: 404 })
  return NextResponse.json(rows)
}
