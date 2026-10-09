import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, notFound, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createRecipe, getStage, listRecipes } from "@/lib/production-stages-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const stageId = positiveIntParam(new URL(request.url).searchParams.get("stageId"))
  if (!stageId) return errorResponse("stageId обязателен")
  return NextResponse.json(await listRecipes(stageId))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schemas.recipe)
  if (parsed.error) return parsed.error
  const input = parsed.data
  if (!(await getStage(input.stageId))) return notFound("Этап не найден")
  const recipe = await createRecipe({
    stageId: input.stageId,
    kind: input.key.kind,
    id: input.key.id,
    equipmentId: input.equipmentId,
    amount: input.amount,
    components: input.components.map((component) => ({ role: component.role, kind: component.key.kind, id: component.key.id, amount: component.amount })),
  })
  if (recipe === "item_not_found") return notFound("Товар не найден")
  if (recipe === "duplicate") return errorResponse("Этот продукт уже добавлен в этап", 409)
  return NextResponse.json(recipe, { status: 201 })
}
