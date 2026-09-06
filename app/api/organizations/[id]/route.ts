import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteOrganization, updateOrganization } from "@/lib/organizations-repo"

const organizationSchema = z.object({
  name: z.string().trim().min(1),
  limitByDebt: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, organizationSchema)
  if (parsed.error) return parsed.error

  const organization = (await updateOrganization(id, { name: parsed.data.name, limitByDebt: parsed.data.limitByDebt ?? false }))
  if (!organization) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  return NextResponse.json(organization)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteOrganization(id))
  if (!ok) return NextResponse.json({ error: "Организация не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
