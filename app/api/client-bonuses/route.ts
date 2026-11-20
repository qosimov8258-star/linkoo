import { NextResponse } from "next/server"

import { listClientBonuses } from "@/lib/client-bonuses-repo"
import { getCurrentUser } from "@/lib/current-user"
import { withDbErrors } from "@/lib/db-errors"
import { invalidIdResponse, notSignedInResponse, parseIdSegment } from "@/lib/validation"

// GET /api/client-bonuses[?responsibleAgent=<employee id>] → [{id, name, ball, lastCreated}], one row per client
// (financial account), newest first, like Linko's sales/client_promotion/ (responsible_agent).
export const GET = withDbErrors(async (request: Request) => {
  if (!(await getCurrentUser())) return notSignedInResponse()
  const raw = new URL(request.url).searchParams.get("responsibleAgent")
  const agent = raw ? parseIdSegment(raw) : null
  if (raw && agent === null) return invalidIdResponse()
  return NextResponse.json(await listClientBonuses({ agent }))
})
