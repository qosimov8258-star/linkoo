import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteClientAttributeValue, updateClientAttributeValue } from "@/lib/client-attribute-values-repo"

const clientAttributeValueSchema = z.object({
  attribute: z.string().trim().min(1).max(255, "Не более 255 символов"),
  values: z.array(z.string().trim()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, clientAttributeValueSchema)
  if (parsed.error) return parsed.error

  const item = await updateClientAttributeValue(id, {
    attribute: parsed.data.attribute,
    values: (parsed.data.values ?? []).filter((v) => v.length > 0),
  })
  if (!item) return NextResponse.json({ error: "Значение не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteClientAttributeValue(id))
  if (!ok) return NextResponse.json({ error: "Значение не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
