import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { ClientAttributeError, clientAttributeInput, clientAttributeSchema, deleteClientAttribute, updateClientAttribute } from "@/lib/client-attributes-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, clientAttributeSchema)
  if (parsed.error) return parsed.error

  try {
    const attribute = await updateClientAttribute(id, clientAttributeInput(parsed.data))
    if (!attribute) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
    return NextResponse.json(attribute)
  } catch (error) {
    if (error instanceof ClientAttributeError) return NextResponse.json({ error: error.message, fields: { name: error.message } }, { status: error.status })
    throw error
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = await deleteClientAttribute(id)
  if (!ok) return NextResponse.json({ error: "Атрибут не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
