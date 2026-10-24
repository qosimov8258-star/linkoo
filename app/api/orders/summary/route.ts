import { NextResponse } from "next/server"

import { getCurrentUser } from "@/lib/current-user"
import { summarizeOrders } from "@/lib/order-summary-repo"

/** GET /api/orders/summary?ids=1594-1593 — totals by product type for the ticked orders. */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const ids = (new URL(request.url).searchParams.get("ids") ?? "")
    .split("-")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 2000)
  return NextResponse.json(await summarizeOrders(ids))
}
