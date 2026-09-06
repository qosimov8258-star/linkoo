import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteUnitOfMeasure, parseUnitOfMeasureInput, updateUnitOfMeasure } from "@/lib/units-of-measure-repo"

const unitOfMeasureSchema = z.object({
  name: z.string().trim().min(1),
  parentId: z.unknown().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, unitOfMeasureSchema)
  if (parsed.error) return parsed.error

  const input = parseUnitOfMeasureInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Наименование обязательно" }, { status: 400 })

  const unit = (await updateUnitOfMeasure(id, input))
  if (!unit) return NextResponse.json({ error: "Единица измерения не найдена" }, { status: 404 })
  return NextResponse.json(unit)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteUnitOfMeasure(id))
  if (!ok) return NextResponse.json({ error: "Единица измерения не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
