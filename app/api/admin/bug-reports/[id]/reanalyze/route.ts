import { NextResponse } from "next/server"

import { releaseAnalysis, reserveAnalysis, startAnalysis } from "@/lib/bug-reports/deliver"
import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { markAnalysisPending } from "@/lib/bug-reports/repo"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

// POST /api/admin/bug-reports/[id]/reanalyze — «Qayta tahlil qilish»: the report goes back to PENDING (the
// last error cleared) and the screenshot analysis runs again in the background; a delivered report gets
// the result as a Telegram reply again. { ok: true }; 404 no such report; 409 while an analysis of it
// still runs in this server. Admins only (also gated at the edge).
export const POST = withDbErrors(async (_request: Request, { params }: RouteParams) => {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  // The slot is taken before the first await, so two clicks cannot start two runs.
  if (!reserveAnalysis(id)) return NextResponse.json({ error: BUG_MESSAGES.analysisRunning }, { status: 409 })
  let exists = false
  try {
    exists = await markAnalysisPending(id)
  } catch (error) {
    releaseAnalysis(id)
    throw error
  }
  if (!exists) {
    releaseAnalysis(id)
    return NextResponse.json({ error: BUG_MESSAGES.notFound }, { status: 404 })
  }
  startAnalysis(id, true)
  return NextResponse.json({ ok: true })
})
