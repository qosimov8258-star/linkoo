import { NextResponse } from "next/server"
import { z } from "zod"

import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { getBugReportDetail, updateBugReportStatus } from "@/lib/bug-reports/repo"
import { BUG_REPORT_STATUSES } from "@/lib/bug-reports/types"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const patchSchema = z.object({ status: z.enum(BUG_REPORT_STATUSES, BUG_MESSAGES.badStatus) })

const notFound = () => NextResponse.json({ error: BUG_MESSAGES.notFound }, { status: 404 })

// GET /api/admin/bug-reports/[id] — one report (BugReportDetail, without the screenshot bytes: those are
// at screenshotUrl). PATCH { status: NEW | IN_PROGRESS | FIXED | REJECTED } → the updated report.
// Admins only (also gated at the edge).
export const GET = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const detail = await getBugReportDetail(id)
  return detail ? NextResponse.json(detail) : notFound()
})

export const PATCH = withDbErrors(async (request: Request, { params }: RouteParams) => {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, patchSchema)
  if (parsed.error) return parsed.error
  if (!(await updateBugReportStatus(id, parsed.data.status))) return notFound()
  const detail = await getBugReportDetail(id)
  return detail ? NextResponse.json(detail) : notFound()
})
