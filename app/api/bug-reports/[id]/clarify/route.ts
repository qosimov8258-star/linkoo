import { z } from "zod"

import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { answerClarification, followUpResponse } from "@/lib/bug-reports/submit"
import { BUG_COMMENT_MAX } from "@/lib/bug-reports/types"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const schema = z.object({
  answer: z.string(BUG_MESSAGES.answerRequired).trim().min(1, BUG_MESSAGES.answerRequired).max(BUG_COMMENT_MAX, BUG_MESSAGES.answerLong),
})

// POST /api/bug-reports/[id]/clarify — { answer } to the helper's one question, on the caller's own
// report while it awaits it: the question and the answer are appended to the comment and the report is
// delivered (the helper never asks twice). { ok: true }; 404 not the caller's report, 409 not waiting.
// A panel closed without an answer delivers the report through /feedback { helped: false } instead.
export const POST = withDbErrors(async (request: Request, { params }: RouteParams) => {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, schema)
  if (parsed.error) return parsed.error
  return followUpResponse(await answerClarification(id, auth.user.id, parsed.data.answer))
})
