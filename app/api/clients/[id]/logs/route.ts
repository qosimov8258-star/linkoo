import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { listShopLogs, pageParams, SHOP_LOG_TYPES, type ShopLogType } from "@/lib/shop-drawer-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/logs?type=order|order_return|client_transaction|market&page=1&pageSize=25 → {count, results}:
// КЛИЕНТ → ЛОГИ of the shop drawer (Linko's market_logs of a copied shop, the app's own documents after the copy).
export async function GET(request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  const search = new URL(request.url).searchParams
  const raw = search.get("type") ?? ""
  const type = (SHOP_LOG_TYPES as readonly string[]).includes(raw) ? (raw as ShopLogType) : null
  const { page, pageSize } = pageParams(search)
  return NextResponse.json(await listShopLogs(id, type, page, pageSize))
}
