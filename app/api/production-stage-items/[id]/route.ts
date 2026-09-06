import { NextResponse } from "next/server"
import { z } from "zod"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { deleteProductionStageItem, parseProductionStageItemInput, updateProductionStageItem } from "@/lib/production-stage-items-repo"

const productionStageItemSchema = z.object({
  stageId: z.coerce.number().finite().positive(),
  kind: z.enum(["product", "operation"]),
  name: z.string().trim().min(1),
  type: z.string().optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  equipment: z.string().optional(),
})

type RouteParams = { params: Promise<{ id: string }> }

export async function PUT(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const parsed = await parseJsonBody(request, productionStageItemSchema)
  if (parsed.error) return parsed.error

  const input = parseProductionStageItemInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Обязательные поля не заполнены" }, { status: 400 })

  const item = (await updateProductionStageItem(id, input))
  if (!item) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json(item)
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = Number((await params).id)
  const ok = (await deleteProductionStageItem(id))
  if (!ok) return NextResponse.json({ error: "Запись не найдена" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
