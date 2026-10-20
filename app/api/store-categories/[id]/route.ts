import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"
import { deleteStoreCategory, updateStoreCategory } from "@/lib/store-categories-repo"

const schema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateStoreCategory(id, { name: parsed.data.name })
  if (!item) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (id === null) return invalidIdResponse()
  if (!(await deleteStoreCategory(id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
