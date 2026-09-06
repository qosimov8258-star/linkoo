import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteClientRestriction, updateClientRestriction } from "@/lib/client-restrictions-repo"

const clientRestrictionSchema = z.object({
  name: z.string().trim().min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, clientRestrictionSchema)
  if (parsed.error) return parsed.error

  const restriction = (await updateClientRestriction(id, parsed.data))
  if (!restriction) return NextResponse.json({ error: "Ограничение не найдено" }, { status: 404 })
  return NextResponse.json(restriction)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteClientRestriction(id))
  if (!ok) return NextResponse.json({ error: "Ограничение не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
