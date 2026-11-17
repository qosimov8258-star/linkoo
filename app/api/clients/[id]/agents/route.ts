import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseBody, parseId } from "@/lib/auth-request"
import { ClientAgentsError, clientAgentOptions, listClientAgents, setClientAgents } from "@/lib/client-agents-repo"
import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"

// «Агенты магазина» of a shop's card (Linko's market users).
//   GET  /api/clients/[id]/agents            → ClientAgent[]
//   GET  /api/clients/[id]/agents?options=1  → ClientAgentOptions (the dialog's agents and price lists)
//   PUT  /api/clients/[id]/agents            ← { agents: [{ employeeId, description, priceListIds }] } (replaces the list)

type RouteParams = { params: Promise<{ id: string }> }

const NOT_FOUND = { error: "Клиент не найден" }

const agentsSchema = z.object({
  agents: z
    .array(
      z.object({
        employeeId: z.number().int().positive(),
        description: z.string().max(500).default(""),
        priceListIds: z.array(z.number().int().positive()).max(200).default([]),
      }),
    )
    .max(200),
})

function errorResponse(error: unknown) {
  if (error instanceof ClientAgentsError) return NextResponse.json({ error: error.message }, { status: error.status })
  throw error
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })
  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  if (request.nextUrl.searchParams.get("options")) return NextResponse.json(await clientAgentOptions())
  return NextResponse.json(await listClientAgents(id))
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseId((await params).id)
  if (!id) return NextResponse.json(NOT_FOUND, { status: 404 })
  const parsed = await parseBody(request, agentsSchema)
  if (parsed.error) return parsed.error
  try {
    return NextResponse.json(await setClientAgents(id, parsed.data.agents))
  } catch (error) {
    return errorResponse(error)
  }
}
