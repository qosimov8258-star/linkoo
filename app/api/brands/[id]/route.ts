import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteBrand, updateBrand } from "@/lib/brands-repo"

const brandSchema = z.object({
  name: z.string().trim().min(1),
  organization: z.string().trim().min(1),
  photoUrl: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, brandSchema)
  if (parsed.error) return parsed.error

  const brand = await updateBrand(id, {
    name: parsed.data.name,
    organization: parsed.data.organization,
    photoUrl: parsed.data.photoUrl && parsed.data.photoUrl.trim() ? parsed.data.photoUrl : null,
  })
  if (!brand) return NextResponse.json({ error: "Бренд не найден" }, { status: 404 })
  return NextResponse.json(brand)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteBrand(id))
  if (!ok) return NextResponse.json({ error: "Бренд не найден" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
