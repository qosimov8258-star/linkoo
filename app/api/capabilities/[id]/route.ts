import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteCapability, updateCapability } from "@/lib/capabilities-repo"

const capabilityUpdateSchema = z.object({
  name: z.string().trim().min(1),
  permissionIds: z.array(z.number()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, capabilityUpdateSchema)
  if (parsed.error) return parsed.error

  const capability = (await updateCapability(id, parsed.data.name, parsed.data.permissionIds))
  if (!capability) return NextResponse.json({ error: "Не удалось сохранить возможность" }, { status: 409 })
  return NextResponse.json(capability)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteCapability(id))
  if (!ok) return NextResponse.json({ error: "Возможность не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
