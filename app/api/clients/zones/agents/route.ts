import { NextResponse } from "next/server"
import { z } from "zod"

import { parseBody } from "@/lib/auth-request"
import { ZoneAgentsError, getZoneAgentsState, setZoneAgent, setZonesBranch } from "@/lib/client-zone-agents-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

// GET /api/clients/zones/agents → {agents, bindings, unbound}: who a zone can be given and which zones they have.
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json(await getZoneAgentsState())
}

const bulkSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["bind-agent", "unbind-agent"]), zoneIds: z.array(z.number().int().positive()).min(1).max(5000), agentId: z.number().int().positive() }),
  z.object({ action: z.literal("bind-branch"), zoneIds: z.array(z.number().int().positive()).min(1).max(5000), branch: z.string().trim().min(1).max(200) }),
])

// POST /api/clients/zones/agents {action: bind-agent|unbind-agent, zoneIds, agentId} | {action: bind-branch, zoneIds, branch}
// → the new state («Привязать агента», «Отвязать агента», «Привязать филиал» of Управлять территориями).
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, bulkSchema)
  if (parsed.error) return parsed.error
  const body = parsed.data
  try {
    if (body.action === "bind-branch") {
      await setZonesBranch(body.zoneIds, body.branch)
      return NextResponse.json(await getZoneAgentsState())
    }
    return NextResponse.json(await setZoneAgent(body.action === "bind-agent" ? "bind" : "unbind", body.zoneIds, body.agentId))
  } catch (error) {
    if (error instanceof ZoneAgentsError) return NextResponse.json({ error: error.message }, { status: error.status })
    throw error
  }
}
