import { NextRequest } from "next/server"

import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { parseIdSegment, parseJsonBody } from "@/lib/validation"
import { writeOffActionSchema, writeOffResponse } from "@/lib/write-offs-api"
import { writeOffAction } from "@/lib/write-offs-repo"
import type { WriteOffAction } from "@/lib/write-offs-types"

type RouteParams = { params: Promise<{ id: string }> }

/** { action: finish | cancel } → the updated write-off; 409 { error } when not allowed. */
export const POST = withDbErrors(async function POST(request: NextRequest, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error

  const id = parseIdSegment((await params).id) ?? 0
  const parsed = await parseJsonBody(request, writeOffActionSchema)
  if (parsed.error) return parsed.error

  return writeOffResponse(await writeOffAction(id, parsed.data.action as WriteOffAction, auth.user.displayName))
})
