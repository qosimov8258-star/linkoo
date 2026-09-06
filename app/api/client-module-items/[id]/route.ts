import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteClientModuleItem, updateClientModuleItem } from "@/lib/client-module-items-repo"

const clientModuleItemSchema = z.object({
  moduleKey: z.string().trim().min(1),
  name: z.string().trim().min(1),
  category: z.string().trim().optional(),
  detail: z.string().trim().optional(),
  value: z.string().trim().optional(),
  status: z.enum(["active", "attention", "inactive"]).optional(),
  statusLabel: z.string().trim().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, clientModuleItemSchema)
  if (parsed.error) return parsed.error

  const status = parsed.data.status ?? "active"
  const item = await updateClientModuleItem(id, {
    moduleKey: parsed.data.moduleKey,
    name: parsed.data.name,
    category: parsed.data.category ?? "",
    detail: parsed.data.detail ?? "",
    value: parsed.data.value ?? "",
    status,
    statusLabel: parsed.data.statusLabel || status,
  })
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteClientModuleItem(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
