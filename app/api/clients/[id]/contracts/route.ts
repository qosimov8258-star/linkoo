import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { listShopContracts, pageParams } from "@/lib/shop-drawer-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/contracts?page=1&pageSize=25 → {count, results: [{id, number, createdAt, organization}]}:
// КЛИЕНТ → ДОГОВОРЫ of the shop drawer, newest first.
export async function GET(request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  const { page, pageSize } = pageParams(new URL(request.url).searchParams)
  return NextResponse.json(await listShopContracts(id, page, pageSize))
}
