import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { addZoneBindings, getZoneBindingState, removeZones } from "@/lib/zone-bindings-repo"

const actionSchema = z.object({
  action: z.enum(["bind-agent", "unbind-agent", "bind-branch", "remove-zone"]),
  zoneIds: z.array(z.number().int()).min(1),
  value: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await getZoneBindingState())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, actionSchema)
  if (parsed.error) return parsed.error
  const { action, zoneIds, value } = parsed.data

  if (action === "remove-zone") {
    await removeZones(zoneIds)
  } else {
    if (!value) return NextResponse.json({ error: "Не выбрано значение" }, { status: 400 })
    await addZoneBindings(action === "bind-agent" ? "agent" : action === "unbind-agent" ? "unbind-agent" : "branch", zoneIds, value)
  }
  return NextResponse.json(await getZoneBindingState())
}
