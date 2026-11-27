import { NextResponse } from "next/server"

import { sweepWaitingReports } from "@/lib/bug-reports/deliver"
import { listBugReports, type BugReportFilters } from "@/lib/bug-reports/repo"
import { BUG_REPORT_STATUSES, BUG_SEVERITIES, type BugReportStatus, type BugSeverity } from "@/lib/bug-reports/types"
import { withDbErrors } from "@/lib/db-errors"
import { requireRole } from "@/lib/rbac"
import { invalidFieldResponse } from "@/lib/validation"

const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100

/** A positive integer query value, the fallback when it is empty, null when it is not one. */
function positiveInt(value: string | null, fallback: number): number | null {
  if (value === null || value === "") return fallback
  if (!/^\d+$/.test(value)) return null
  const number = Number(value)
  return number >= 1 && number <= 1_000_000 ? number : null
}

// GET /api/admin/bug-reports — «Xato xabarlari»: ?status=NEW|IN_PROGRESS|FIXED|REJECTED
// &severity=past|o'rta|yuqori|kritik (the analysis' jiddiylik) &resolvedByAi=1 («AI hal qildi»; 0 = not)
// &page=1&pageSize=25 (≤ 100), newest first → { rows, total }. Admins only (also gated at the edge).
// Each read also runs the lazy sweep that delivers reports left unanswered for 15 minutes.
export const GET = withDbErrors(async (request: Request) => {
  const auth = await requireRole("admin")
  if ("error" in auth) return auth.error
  const query = new URL(request.url).searchParams
  const filters: BugReportFilters = { page: 1, pageSize: DEFAULT_PAGE_SIZE }

  const status = query.get("status")
  if (status) {
    if (!(BUG_REPORT_STATUSES as readonly string[]).includes(status)) return invalidFieldResponse("status", BUG_REPORT_STATUSES.join(" | "))
    filters.status = status as BugReportStatus
  }
  const severity = query.get("severity")
  if (severity) {
    if (!(BUG_SEVERITIES as readonly string[]).includes(severity)) return invalidFieldResponse("severity", BUG_SEVERITIES.join(" | "))
    filters.severity = severity as BugSeverity
  }
  const resolvedByAi = query.get("resolvedByAi")
  if (resolvedByAi) {
    if (resolvedByAi === "1" || resolvedByAi === "true") filters.resolvedByAi = true
    else if (resolvedByAi === "0" || resolvedByAi === "false") filters.resolvedByAi = false
    else return invalidFieldResponse("resolvedByAi", "1 | 0")
  }
  const page = positiveInt(query.get("page"), 1)
  if (page === null) return invalidFieldResponse("page", "1, 2, …")
  const pageSize = positiveInt(query.get("pageSize"), DEFAULT_PAGE_SIZE)
  if (pageSize === null || pageSize > MAX_PAGE_SIZE) return invalidFieldResponse("pageSize", `1..${MAX_PAGE_SIZE}`)
  filters.page = page
  filters.pageSize = pageSize

  sweepWaitingReports()
  return NextResponse.json(await listBugReports(filters))
})
