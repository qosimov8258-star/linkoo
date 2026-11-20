import { NextResponse } from "next/server"

import { requireRole } from "@/lib/rbac"
import { guarded, parseBody, requireViewer, schemas } from "@/lib/production-api"
import { createOperation, listOperations } from "@/lib/production-stages-repo"

/** Like the reference, operations are global: always the whole list. A ?stageId= is ignored (new operations
 * carry no stage, so narrowing by the stage an older version filed them under would hide them). */
export async function GET() {
  const denied = await requireViewer()
  if (denied) return denied
  return NextResponse.json(await listOperations())
}

/** A new operation has no stage (the reference's carry none); a stageId in the body is ignored. */
export async function POST(request: Request) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const parsed = await parseBody(request, schemas.operation)
  if (parsed.error) return parsed.error
  return guarded(async () => NextResponse.json(await createOperation(parsed.data), { status: 201 }))
}
