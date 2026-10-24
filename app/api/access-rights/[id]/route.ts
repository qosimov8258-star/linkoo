import { NextResponse } from "next/server"
import { z } from "zod"

import { getDb } from "@/lib/db"
import { ensureEmployeesSchema } from "@/lib/employees-schema"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteAccessRight, updateAccessRight } from "@/lib/access-rights-repo"

const accessRightSchema = z.object({
  name: z.string().trim().min(1),
  capabilityIds: z.array(z.number()).optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, accessRightSchema)
  if (parsed.error) return parsed.error

  const accessRight = await updateAccessRight(id, { name: parsed.data.name, capabilityIds: parsed.data.capabilityIds ?? [] })
  if (!accessRight) return NextResponse.json({ error: "Права доступа не найдены" }, { status: 404 })
  return NextResponse.json(accessRight)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  await ensureEmployeesSchema()
  const used = (await getDb().prepare("SELECT count(*)::int AS n FROM employees WHERE access_right_id = ?").get(id)) as { n: number }
  if (used.n > 0) return NextResponse.json({ error: "Эти права доступа назначены сотрудникам, удаление невозможно" }, { status: 409 })
  const ok = (await deleteAccessRight(id))
  if (!ok) return NextResponse.json({ error: "Права доступа не найдены" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
