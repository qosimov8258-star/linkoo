import { NextRequest, NextResponse } from "next/server"

import { parseBody, parseId } from "@/lib/auth-request"
import { clientZoneErrorResponse, clientZoneInputOf, clientZoneSchema } from "@/lib/client-schema"
import { deleteClientZone, getClientZone, updateClientZone } from "@/lib/client-zones-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Зона не найдена" }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const id = parseId((await params).id)
  const zone = id ? await getClientZone(id) : null
  if (!zone) return NextResponse.json(NOT_FOUND, { status: 404 })
  return NextResponse.json(zone)
}

// PUT /api/clients/zones/[id] {name, branch?, parentId?, polygon?, reassignClients?} → {zone, reassigned}.
// Omitted fields keep their value; a rename follows to the clients, orders and contracts of the zone.
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, clientZoneSchema)
  if (parsed.error) return parsed.error

  try {
    const saved = await updateClientZone(id, clientZoneInputOf(parsed.data))
    if (!saved) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json(saved)
  } catch (error) {
    return clientZoneErrorResponse(error)
  }
}

// DELETE /api/clients/zones/[id] — 409 {error, usage} while clients, orders or contracts hold the zone.
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  try {
    const ok = await deleteClientZone(id)
    if (!ok) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return clientZoneErrorResponse(error)
  }
}
