import { NextResponse } from "next/server"

import { deleteEquipment, equipmentInputSchema, getEquipment, updateEquipment } from "@/lib/equipment-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const item = await getEquipment(id)
  if (!item) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, equipmentInputSchema)
  if (parsed.error) return parsed.error
  const item = await updateEquipment(id, { name: parsed.data.name, manufacturingId: parsed.data.manufacturingId ?? null, photo: parsed.data.photo })
  if (!item) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  if (!(await deleteEquipment(id))) return NextResponse.json({ error: "Оборудование не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
