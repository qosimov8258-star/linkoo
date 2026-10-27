import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, parseBody, requireViewer, schemas } from "@/lib/production-api"
import { createStage, listStages } from "@/lib/production-stages-repo"

export async function GET() {
  const denied = await requireViewer()
  if (denied) return denied
  return NextResponse.json(await listStages())
}

export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.stage)
  if (parsed.error) return parsed.error
  return guarded(async () => NextResponse.json(await createStage(parsed.data), { status: 201 }))
}
