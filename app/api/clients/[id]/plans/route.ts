import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { listShopPlans, pageParams } from "@/lib/shop-drawer-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/plans?page=1&pageSize=25 → {count, results: ShopPlan[]}: the shop drawer's ЗАДАЧИ timeline
// (Linko's detail_plans of a copied shop, the app's own tasks, orders, returns and visits after the copy).
export async function GET(request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  const { page, pageSize } = pageParams(new URL(request.url).searchParams)
  return NextResponse.json(await listShopPlans(id, page, pageSize))
}
