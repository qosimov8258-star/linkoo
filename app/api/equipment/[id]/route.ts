import { NextResponse } from "next/server"

import { deleteEquipment, getEquipment, updateEquipment } from "@/lib/equipment-repo"
import { getCurrentUser } from "@/lib/current-user"
import { guarded, parseBody } from "@/lib/production-api"
import { equipmentSettingsSchema } from "@/lib/production-staffeq-schemas"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = "Оборудование не найдено"

export async function GET(_request: Request, { params }: RouteParams) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  return guarded(async () => {
    const item = await getEquipment(id)
    return item ? NextResponse.json(item) : NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  })
}

/** Name, «Производство» (the stage: a machine in use cannot move, 409) and the photo (omitted: kept). */
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseBody(request, equipmentSettingsSchema)
  if (parsed.error) return parsed.error
  const input = parsed.data
  return guarded(async () => {
    const item = await updateEquipment(id, { name: input.name, manufacturingId: input.manufacturingId, photo: input.photo })
    return item ? NextResponse.json(item) : NextResponse.json({ error: NOT_FOUND }, { status: 404 })
  })
}

/** A machine that operations, products or shift entries use stays: 409 with the usage list. */
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  return guarded(async () => ((await deleteEquipment(id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: NOT_FOUND }, { status: 404 })))
}
