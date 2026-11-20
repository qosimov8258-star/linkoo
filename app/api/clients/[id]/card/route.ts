import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { getShopCard } from "@/lib/shop-drawer-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/card → ShopCard: the shop drawer's fields the client row has no column for (Linko's price list,
// «Статус ИНН», «Создал», «Класс клиента» per organization, last payment day; lib/shop-drawer-repo.ts).
export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(await getShopCard(id))
}
