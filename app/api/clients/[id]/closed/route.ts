import { NextResponse } from "next/server"

import { parseId } from "@/lib/auth-request"
import { getCurrentUser } from "@/lib/current-user"
import { shopIsClosed } from "@/lib/shop-closed-repo"

type RouteParams = { params: Promise<{ id: string }> }

// GET /api/clients/[id]/closed → { closed }: Linko's «Закрыто» mark of the shop (its drawer's red chip;
// lib/shop-closed-repo.ts).
export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json({ closed: await shopIsClosed(id) })
}
