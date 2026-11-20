import { NextResponse } from "next/server"

import { parsePrintIds, returnRelease } from "@/lib/client-returns-print"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/client-returns/release?ids=205-207 → the goods of the chosen returns summed per product (and currency),
// the period, agents, deliverers and clients — what the returns list's «Для зав.склада» → «Распечатать» and
// «Сводка для склада» print (the reference's sales/order_return/custom_release/?ids=…).
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const ids = parsePrintIds(new URL(request.url).searchParams.getAll("ids"))
  if (!ids) return NextResponse.json({ error: "Выберите хотя бы один возврат !" }, { status: 400 })
  return NextResponse.json(await returnRelease(ids))
}
