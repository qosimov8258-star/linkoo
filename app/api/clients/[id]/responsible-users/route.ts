import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { listShopResponsibles } from "@/lib/shop-drawer-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/responsible-users → [{employeeId, name, role}]: the shop's responsible agent, delivery man and
// collector (Linko's get_responsible_users), the choices of the drawer's «Создать задачу».
export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(await listShopResponsibles(id))
}
