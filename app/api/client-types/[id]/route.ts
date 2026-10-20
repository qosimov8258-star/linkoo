import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody, parseId, textField } from "@/lib/auth-request"
import { ClientTypeError, deleteClientType, updateClientType } from "@/lib/client-types-repo"
import { requireRole } from "@/lib/rbac"

const clientTypeSchema = z.object({
  name: nameField("Укажите название типа клиента", 200),
  supplier: textField(200).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Тип клиента не найден" }

function errorResponse(error: ClientTypeError) {
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}

// PUT /api/client-types/[id] {name, supplier?} — 409 for a name taken by another type;
// clients with the old name follow the rename.
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, clientTypeSchema)
  if (parsed.error) return parsed.error

  try {
    const clientType = await updateClientType(id, { name: parsed.data.name, supplier: parsed.data.supplier || "Не указано" })
    if (!clientType) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(clientType)
  } catch (error) {
    if (error instanceof ClientTypeError) return errorResponse(error)
    throw error
  }
}

// DELETE /api/client-types/[id] — 409 {error, usage} while clients hold the type.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteClientType(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof ClientTypeError) return errorResponse(error)
    throw error
  }
}
