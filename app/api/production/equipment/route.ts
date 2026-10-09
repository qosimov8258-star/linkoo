import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, notFound, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createEquipment, getStage, listEquipment } from "@/lib/production-stages-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const stageId = positiveIntParam(new URL(request.url).searchParams.get("stageId"))
  if (!stageId) return errorResponse("stageId обязателен")
  return NextResponse.json(await listEquipment(stageId))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schemas.equipment)
  if (parsed.error) return parsed.error
  if (!(await getStage(parsed.data.stageId))) return notFound("Этап не найден")
  return NextResponse.json(await createEquipment(parsed.data), { status: 201 })
}
