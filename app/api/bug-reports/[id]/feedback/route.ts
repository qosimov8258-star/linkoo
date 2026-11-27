import { z } from "zod"

import { answerFeedback, followUpResponse } from "@/lib/bug-reports/submit"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({ helped: z.boolean() })

// POST /api/bug-reports/[id]/feedback — { helped } on the caller's own report while it awaits the
// feedback on the helper's answer: true «Yordam berdi, rahmat» (resolved by the AI: no Telegram, no
// analysis), false «Yordam bermadi, dasturchiga yuborish» or the panel closed (delivered). false is also
// taken while the report awaits the one answer to the helper's question: the panel was closed without
// an answer, and the report is delivered without one at once (the browser sends it with keepalive), not
// left to the 15-minute sweep. { ok: true }; 404 not the caller's report, 409 it no longer awaits either
// (or helped=true on a question).
export const POST = withDbErrors(async (request: Request, { params }: RouteParams) => {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return followUpResponse(await answerFeedback(id, auth.user.id, parsed.data.helped))
})
