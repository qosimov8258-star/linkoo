import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import {
  ClientAttributeValueError,
  clientAttributeValueInput,
  clientAttributeValueSchema,
  deleteClientAttributeValue,
  updateClientAttributeValue,
} from "@/lib/client-attribute-values-repo"

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, clientAttributeValueSchema)
  if (parsed.error) return parsed.error

  try {
    const item = await updateClientAttributeValue(id, clientAttributeValueInput(parsed.data))
    if (!item) return NextResponse.json({ error: "Значение не найдено" }, { status: 404 })
    return NextResponse.json(item)
  } catch (error) {
    if (error instanceof ClientAttributeValueError) {
      return NextResponse.json({ error: error.message, ...(error.field ? { fields: { [error.field]: error.message } } : {}) }, { status: error.status })
    }
    throw error
  }
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const ok = await deleteClientAttributeValue(id)
  if (!ok) return NextResponse.json({ error: "Значение не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
