import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteTransportVehicle, parseTransportVehicleInput, updateTransportVehicle, TRANSPORT_STATUSES } from "@/lib/transport-repo"

const transportVehicleSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  plateNumber: z.string().optional(),
  driver: z.string().optional(),
  branch: z.string().optional(),
  status: z.enum(TRANSPORT_STATUSES).optional(),
  note: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, transportVehicleSchema)
  if (parsed.error) return parsed.error

  const input = parseTransportVehicleInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const item = (await updateTransportVehicle(id, input))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteTransportVehicle(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
