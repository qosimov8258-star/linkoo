import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteInventoryRecord, updateInventoryComment } from "@/lib/inventory-records-repo"

const inventoryCommentSchema = z.object({
  comment: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, inventoryCommentSchema)
  if (parsed.error) return parsed.error

  const record = (await updateInventoryComment(id, { comment: parsed.data.comment ?? "" }))
  if (!record) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(record)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteInventoryRecord(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
