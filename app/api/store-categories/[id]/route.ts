import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteStoreCategory, updateStoreCategory } from "@/lib/store-categories-repo"

const schema = z.object({
  name: z.string().trim().min(1),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateStoreCategory(id, { name: parsed.data.name })
  if (!item) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = Number((await params).id)
  if (!(await deleteStoreCategory(id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
