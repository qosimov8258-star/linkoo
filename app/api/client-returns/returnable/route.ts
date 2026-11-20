import { NextResponse } from "next/server"

import { returnableOfClient, returnableOfOrder } from "@/lib/client-returns-repo"
import { getCurrentUser } from "@/lib/current-user"

// GET /api/client-returns/returnable?clientId=N[&except=R] → every line of the client's shipped orders that can still be
// returned (Linko's sales/order_product/for_return/?market=), newest order first.
// GET /api/client-returns/returnable?orderId=N[&except=R] → the lines of one order (also the ones with nothing left).
// `except`: the edited return, whose own lines do not count as already returned.
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const search = new URL(request.url).searchParams
  const num = (name: string) => {
    const raw = search.get(name)
    if (!raw) return 0
    return /^\d{1,10}$/.test(raw) && Number(raw) <= 2_147_483_647 ? Number(raw) : -1
  }
  const clientId = num("clientId")
  const orderId = num("orderId")
  const except = num("except")
  if (clientId < 0 || orderId < 0 || except < 0 || (!clientId && !orderId)) return NextResponse.json({ error: "clientId/orderId: число" }, { status: 400 })
  return NextResponse.json(orderId ? await returnableOfOrder(orderId, except) : await returnableOfClient(clientId, except))
}
