import { NextResponse } from "next/server"

import { deleteIntegration, getIntegration, updateIntegration } from "@/lib/integrations-repo"
import { integrationSchema } from "@/lib/integrations-schema"
import { requirePermission, requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// The row carries the token: readable only with settings.manage (see ../route.ts).
export async function GET(_request: Request, { params }: RouteParams) {
  const auth = await requirePermission("settings.manage")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const item = await getIntegration(id)
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, integrationSchema)
  if (parsed.error) return parsed.error
  const item = await updateIntegration(id, parsed.data)
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  if (!(await deleteIntegration(id))) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
