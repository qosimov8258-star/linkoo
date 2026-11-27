import { NextResponse } from "next/server"

import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { readReportForm, submitReport } from "@/lib/bug-reports/submit"
import { BUG_REPORTS_PER_MINUTE } from "@/lib/bug-reports/types"
import { withDbErrors } from "@/lib/db-errors"
import { checkRateLimit } from "@/lib/rate-limit"
import { requireRole } from "@/lib/rbac"

// POST /api/bug-reports — «Xato topdim»: multipart/form-data with comment (BUG_COMMENT_MIN..MAX), pageUrl,
// context (the browser's JSON, ≤ BUG_CONTEXT_MAX_CHARS, masked before it is stored) and an optional
// screenshot (JPEG / PNG / WebP by its bytes, ≤ BUG_SCREENSHOT_MAX_BYTES). Any signed-in user (viewers
// too: /api/bug-reports is a self-service prefix), at most BUG_REPORTS_PER_MINUTE per minute.
// 201 { id, helper, delivered }: the report is saved first, then the helper answers (or is skipped) and
// the report is delivered unless the helper waits for the customer's feedback or one answer.
// 400 bad comment / not multipart, 401, 413 screenshot or context too large, 415 not an image, 429.
export const POST = withDbErrors(async (request: Request) => {
  const auth = await requireRole("viewer")
  if ("error" in auth) return auth.error
  const limit = checkRateLimit(`bug-reports:user:${auth.user.id}`, BUG_REPORTS_PER_MINUTE, 60_000)
  if (!limit.allowed) {
    return NextResponse.json({ error: BUG_MESSAGES.tooMany }, { status: 429, headers: { "Retry-After": String(Math.max(1, limit.retryAfterSeconds)) } })
  }
  const parsed = await readReportForm(request)
  if ("error" in parsed) return parsed.error
  return NextResponse.json(await submitReport(auth.user, parsed.data), { status: 201 })
})
