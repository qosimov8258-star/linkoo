import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { errorResponse, guarded, parseBody, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createOperation, listOperations } from "@/lib/production-stages-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  const stageId = positiveIntParam(new URL(request.url).searchParams.get("stageId"))
  if (!stageId) return errorResponse("stageId обязателен")
  return NextResponse.json(await listOperations(stageId))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.operation)
  if (parsed.error) return parsed.error
  return guarded(async () => NextResponse.json(await createOperation(parsed.data), { status: 201 }))
}
