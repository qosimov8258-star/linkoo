import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteClient, getClient, updateClient } from "@/lib/clients-repo"

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

type RouteParams = { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Tizimga kirilmagan" }, { status: 401 })

  const id = Number((await params).id)
  const client = (await getClient(id))
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, clientSchema)
  if (parsed.error) return parsed.error

  const client = await updateClient(id, {
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
  if (!client) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json(client)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteClient(id))
  if (!ok) return NextResponse.json({ error: "Клиент не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
