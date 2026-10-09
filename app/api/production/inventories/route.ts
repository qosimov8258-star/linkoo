import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, isDateParam, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createInventory, listInventories } from "@/lib/production-activity-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const params = new URL(request.url).searchParams
  const stageId = positiveIntParam(params.get("stageId"))
  const from = params.get("from")
  const to = params.get("to")
  if (!stageId || !isDateParam(from) || !isDateParam(to)) return errorResponse("stageId, from и to обязательны")
  return NextResponse.json(await listInventories(stageId, from, to))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schemas.inventory)
  if (parsed.error) return parsed.error
  const { stageId, ...input } = parsed.data
  const inventory = await createInventory(stageId, input, auth.user.displayName)
  return inventory ? NextResponse.json(inventory, { status: 201 }) : errorResponse("Нет строк для сверки")
}
