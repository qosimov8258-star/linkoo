import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createClient, listClients } from "@/lib/clients-repo"

const clientSchema = z.object({
  name: z.string().trim().min(1),
  phone: z.string().trim().min(1),
  type: z.string().trim().min(1),
  zone: z.string().trim().min(1),
  inn: z.string().trim().optional(),
  zoneAgent: z.string().trim().optional(),
  agent: z.string().trim().optional(),
  deliverer: z.string().trim().optional(),
  collector: z.string().trim().optional(),
  balance: z.number().finite().optional(),
  tab: z.enum(["unconfirmed", "problem", "plan", "closing", "all"]).optional(),
})

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const search = request.nextUrl.searchParams.get("q") ?? undefined
  return NextResponse.json((await listClients(search)))
}

export async function POST(request: NextRequest) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, clientSchema)
  if (parsed.error) return parsed.error

  const client = await createClient({
    name: parsed.data.name,
    phone: parsed.data.phone,
    type: parsed.data.type,
    zone: parsed.data.zone,
    inn: parsed.data.inn || undefined,
    zoneAgent: parsed.data.zoneAgent || "Не указано",
    agent: parsed.data.agent || "Не указано",
    deliverer: parsed.data.deliverer || "Не указано",
    collector: parsed.data.collector || "Не указано",
    balance: parsed.data.balance,
    tab: parsed.data.tab ?? "all",
  })
  return NextResponse.json(client, { status: 201 })
}
