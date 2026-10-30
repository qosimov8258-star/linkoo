import { NextResponse } from "next/server"
import { z } from "zod"

import { fieldWriteScope } from "@/lib/field-activity/actor"
import { fieldRoute } from "@/lib/field-activity/http"
import { setPhotoReportStatus } from "@/lib/field-activity/photo-report-review"
import { PHOTO_REPORT_STATUSES } from "@/lib/field-activity/record-list-types"
import { requireRole } from "@/lib/rbac"
import { invalidIdResponse, parseIdSegment, parseJsonBody } from "@/lib/validation"

type RouteParams = { params: Promise<{ id: string }> }

const statusSchema = z.object({
  status: z.enum(PHOTO_REPORT_STATUSES, { error: "Неверный статус" }),
  /** The status the page showed; a different current one is refused with 409. */
  from: z.enum(PHOTO_REPORT_STATUSES, { error: "Неверный статус" }).optional(),
})

// PATCH /api/field-activity/photo-reports/[id]/status {status: pending|rejected|accepted, from?}
// → {id, status}: the review of a photo report on "Фотоотчеты" (Принять / Отклонить; clicking
// the shown state again sets it back to pending). Needs clients.manage, like the field data's
// other writes ("field-activity" in lib/capabilities-catalog.ts, checked by requireRole), and the
// report inside the reviewer's field scope — for a scoped reviewer, not their own report.
// 400 bad id / body, 403 a scoped reviewer's own report, 404 missing or outside the reader's
// scope, 409 when `from` is stale.
export async function PATCH(request: Request, { params }: RouteParams) {
  const auth = await requireRole("manager")
  if ("error" in auth) return auth.error
  const id = parseIdSegment((await params).id)
  if (!id) return invalidIdResponse()
  const parsed = await parseJsonBody(request, statusSchema)
  if (parsed.error) return parsed.error
  // The reviewer's field scope (lib/field-activity/actor.ts): a full-scope reviewer reviews every
  // report; a scoped one only the reports of the agents they supervise — their own is 403, and anyone
  // else's answers 404 like a missing one.
  const access = await fieldWriteScope(auth.user)
  if (access.error) return access.error
  const scope = access.scope
  return fieldRoute(async () => NextResponse.json(await setPhotoReportStatus(id, parsed.data.status, scope, parsed.data.from)))
}
