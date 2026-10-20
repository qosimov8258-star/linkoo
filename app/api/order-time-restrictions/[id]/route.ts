import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteOrderTimeRestriction, updateOrderTimeRestriction } from "@/lib/order-time-restrictions-repo"

const orderTimeRestrictionSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  fullDay: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, orderTimeRestrictionSchema)
  if (parsed.error) return parsed.error

  const item = (await updateOrderTimeRestriction(id, {
    name: parsed.data.name,
    from: parsed.data.from || "00:00",
    to: parsed.data.to || "23:59",
    fullDay: parsed.data.fullDay ?? false,
  }))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteOrderTimeRestriction(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
