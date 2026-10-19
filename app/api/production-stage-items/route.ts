import { NextResponse } from "next/server"
import { z } from "zod"

import { getCurrentUser } from "@/lib/current-user"
import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { createProductionStageItem, listProductionStageItems, parseProductionStageItemInput } from "@/lib/production-stage-items-repo"

const productionStageItemSchema = z.object({
  stageId: z.coerce.number().finite().positive(),
  kind: z.enum(["product", "operation"]),
  name: z.string().trim().min(1),
  type: z.string().optional(),
  quantity: z.union([z.number(), z.string()]).optional(),
  equipment: z.string().optional(),
})

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ error: "Вы не вошли в систему" }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const stageIdParam = searchParams.get("stageId")
  const stageId = stageIdParam ? Number(stageIdParam) : undefined
  return NextResponse.json((await listProductionStageItems(stageId)))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const parsed = await parseJsonBody(request, productionStageItemSchema)
  if (parsed.error) return parsed.error

  const input = parseProductionStageItemInput(parsed.data)
  if (!input) return NextResponse.json({ error: "Обязательные поля не заполнены" }, { status: 400 })

  const item = (await createProductionStageItem(input))
  return NextResponse.json(item, { status: 201 })
}
