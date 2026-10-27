import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { CLIENT_ATTRIBUTE_FIELD_TYPES, deleteClientAttribute, updateClientAttribute } from "@/lib/client-attributes-repo"

const clientAttributeSchema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  fieldType: z.enum(CLIENT_ATTRIBUTE_FIELD_TYPES as [string, ...string[]]).optional(),
  required: z.boolean().optional(),
  cacheNumber: z.number().int().nullable().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, clientAttributeSchema)
  if (parsed.error) return parsed.error

  const attribute = await updateClientAttribute(id, {
    name: parsed.data.name,
    fieldType: parsed.data.fieldType ?? "Выбор вариантов",
    required: parsed.data.required ?? false,
    cacheNumber: parsed.data.cacheNumber ?? null,
  })
  if (!attribute) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json(attribute)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = (await deleteClientAttribute(id))
  if (!ok) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
