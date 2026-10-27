import { NextRequest, NextResponse } from "next/server"

import { parseBody } from "@/lib/auth-request"
import { clientZoneErrorResponse, clientZoneInputOf, clientZoneSchema } from "@/lib/client-schema"
import { createClientZone, listClientZones } from "@/lib/client-zones-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

// GET /api/clients/zones → ClientZone[] (the zone directory of Клиенты / Территория,
// with the number of clients in each zone and how many of them have a location).
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await listClientZones())
}

// POST /api/clients/zones {name, branch?, parentId?, polygon?, reassignClients?} → 201 {zone, reassigned}.
// 409 for a name that already exists (case-insensitive); 400 for an unknown branch / parent or a bad outline.
export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseBody(request, clientZoneSchema)
  if (parsed.error) return parsed.error

  try {
    return NextResponse.json(await createClientZone(clientZoneInputOf(parsed.data), auth.user), { status: 201 })
  } catch (error) {
    return clientZoneErrorResponse(error)
  }
}
