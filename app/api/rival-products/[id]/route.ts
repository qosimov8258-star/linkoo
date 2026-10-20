import { NextResponse } from "next/server"
import { z } from "zod"

import { parseCatalogId } from "@/lib/products-api"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteRivalProduct, updateRivalProduct } from "@/lib/rival-products-repo"

const schema = z.object({
  name: z.string().trim().min(1).max(255, "Не более 255 символов"),
  competitor: z.string().trim().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  // Non-numeric / too large ids are a 404, never a database error.
  const id = parseCatalogId((await params).id)
  if (!id) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  const item = await updateRivalProduct(id, { name: parsed.data.name, competitor: parsed.data.competitor ?? "" })
  if (!item) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  // Non-numeric / too large ids are a 404, never a database error.
  const id = parseCatalogId((await params).id)
  if (!id) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  if (!(await deleteRivalProduct(id))) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
