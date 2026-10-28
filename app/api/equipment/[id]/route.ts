import { NextResponse } from "next/server"

import { deleteEquipment, equipmentInputSchema, getEquipment, updateEquipment } from "@/lib/equipment-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const item = await getEquipment(Number((await params).id))
  if (!item) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, equipmentInputSchema)
  if (parsed.error) return parsed.error
  const item = await updateEquipment(Number((await params).id), { name: parsed.data.name, manufacturingId: parsed.data.manufacturingId ?? null, photo: parsed.data.photo })
  if (!item) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  if (!(await deleteEquipment(Number((await params).id)))) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
