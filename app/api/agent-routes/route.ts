import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createAgentRoute, listAgentRoutes } from "@/lib/agent-routes-repo"
import { strictNum } from "@/lib/strict-number"

const agentRouteSchema = z.object({
  agent: z.string().trim().min(1).max(255, "Не более 255 символов"),
  routeDate: z.string().trim().optional(),
  planVisits: strictNum(z.number().finite().optional()),
  routeVisited: strictNum(z.number().finite().optional()),
  routeEffective: strictNum(z.number().finite().optional()),
  routeRefused: strictNum(z.number().finite().optional()),
  routeSales: strictNum(z.number().finite().optional()),
  outsideVisited: strictNum(z.number().finite().optional()),
  outsideEffective: strictNum(z.number().finite().optional()),
  outsideRefused: strictNum(z.number().finite().optional()),
  outsideSales: strictNum(z.number().finite().optional()),
  checkIn: z.string().trim().optional(),
  checkOut: z.string().trim().optional(),
  gpsLat: strictNum(z.number().finite().nullable().optional()),
  gpsLng: strictNum(z.number().finite().nullable().optional()),
  photoUrl: z.string().trim().optional(),
})

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  return NextResponse.json((await listAgentRoutes()))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, agentRouteSchema)
  if (parsed.error) return parsed.error

  const route = await createAgentRoute({
    agent: parsed.data.agent,
    routeDate: parsed.data.routeDate || new Date().toISOString().slice(0, 10),
    planVisits: parsed.data.planVisits ?? 0,
    routeVisited: parsed.data.routeVisited ?? 0,
    routeEffective: parsed.data.routeEffective ?? 0,
    routeRefused: parsed.data.routeRefused ?? 0,
    routeSales: parsed.data.routeSales ?? 0,
    outsideVisited: parsed.data.outsideVisited ?? 0,
    outsideEffective: parsed.data.outsideEffective ?? 0,
    outsideRefused: parsed.data.outsideRefused ?? 0,
    outsideSales: parsed.data.outsideSales ?? 0,
    checkIn: parsed.data.checkIn ?? "",
    checkOut: parsed.data.checkOut ?? "",
    gpsLat: parsed.data.gpsLat ?? null,
    gpsLng: parsed.data.gpsLng ?? null,
    photoUrl: parsed.data.photoUrl ?? "",
  })
  return NextResponse.json(route, { status: 201 })
}
