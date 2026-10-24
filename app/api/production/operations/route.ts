import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { parseJsonBody } from "@/lib/validation"
import { errorResponse, notFound, positiveIntParam, requireViewer, schemas } from "@/lib/production-api"
import { createOperation, getStage, listOperations } from "@/lib/production-stages-repo"

export async function GET(request: Request) {
  const denied = await requireViewer()
  if (denied) return denied
  // Like the reference, operations are not tied to the selected stage: without stageId the whole list is returned.
  const stageId = positiveIntParam(new URL(request.url).searchParams.get("stageId"))
  return NextResponse.json(await listOperations(stageId ?? undefined))
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseJsonBody(request, schemas.operation)
  if (parsed.error) return parsed.error
  if (!(await getStage(parsed.data.stageId))) return notFound("Этап не найден")
  return NextResponse.json(await createOperation(parsed.data), { status: 201 })
}
