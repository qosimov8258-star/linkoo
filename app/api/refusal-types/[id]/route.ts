import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteRefusalType, parseRefusalTypeInput, updateRefusalType } from "@/lib/refusal-types-repo"

const refusalTypeSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  resolution: z.string().trim().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, refusalTypeSchema)
  if (parsed.error) return parsed.error

  const input = parseRefusalTypeInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const item = (await updateRefusalType(id, input))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteRefusalType(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
