import { NextResponse } from "next/server"
import { z } from "zod"

import { nameField, parseBody, parseId } from "@/lib/auth-request"
import { CapabilityError, deleteCapability, updateCapability } from "@/lib/capabilities-repo"
import { requireRole } from "@/lib/rbac"

const capabilityUpdateSchema = z.object({
  name: nameField("Укажите наименование", 120),
  permissionIds: z
    .array(z.number({ error: "Неизвестное разрешение" }).int({ error: "Неизвестное разрешение" }).positive({ error: "Неизвестное разрешение" }))
    .max(500)
    .optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Возможность не найдена" }

function errorResponse(error: CapabilityError) {
  return NextResponse.json({ error: error.message, ...(error.usage ? { usage: error.usage } : {}) }, { status: error.status })
}

// PUT /api/capabilities/[id] {name, permissionIds?} — permission ids must exist
// in the catalogue (400), the name must be free (409).
export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, capabilityUpdateSchema)
  if (parsed.error) return parsed.error

  try {
    const capability = await updateCapability(id, parsed.data.name, parsed.data.permissionIds)
    if (!capability) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(capability)
  } catch (error) {
    if (error instanceof CapabilityError) return errorResponse(error)
    throw error
  }
}

// DELETE /api/capabilities/[id] — 409 {error, usage} while an access right includes it.
export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteCapability(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof CapabilityError) return errorResponse(error)
    throw error
  }
}
