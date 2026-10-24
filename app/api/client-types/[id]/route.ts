import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteClientType, updateClientType } from "@/lib/client-types-repo"

const clientTypeSchema = z.object({
  name: z.string().trim().min(1),
  supplier: z.string().trim().optional(),
  parentId: z.number().int().nullable().optional(),
  innRequired: z.boolean().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, clientTypeSchema)
  if (parsed.error) return parsed.error

  const clientType = await updateClientType(id, {
    name: parsed.data.name,
    supplier: parsed.data.supplier || "Не указано",
    parentId: parsed.data.parentId ?? null,
    innRequired: parsed.data.innRequired ?? false,
  })
  if (!clientType) return NextResponse.json({ error: "Тип клиента не найден" }, { status: 404 })
  return NextResponse.json(clientType)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteClientType(id))
  if (!ok) return NextResponse.json({ error: "Тип клиента не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
