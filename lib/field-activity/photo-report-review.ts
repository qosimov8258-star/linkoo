import "server-only"

import { withTransaction } from "@/lib/db"
import { scopeAllows, type FieldScope } from "@/lib/field-activity/actor"
import { FieldError } from "@/lib/field-activity/errors"
import type { PhotoReportReview, PhotoReportStatus } from "@/lib/field-activity/record-list-types"
import { ensureFieldSchema } from "@/lib/field-activity/schema"
import { NOT_FOUND_MESSAGE } from "@/lib/validation"

// Review of a photo report on the page "Фотоотчеты" (Принять / Отклонить): the one write on the
// mobile app's field data that the office makes. It sets field_photo_reports.status (pending |
// rejected | accepted) and nothing else; the report, its photos and its visit stay as the
// device sent them.
//
// Who reviews: a reviewer with the full field scope reviews every report; a scoped reviewer (an agent
// who supervises others, lib/field-activity/actor.ts) only the reports of the agents they supervise —
// never their own, which would defeat the review (403).

/** Someone else changed the status since the page loaded it (409). */
export const PHOTO_REPORT_STATUS_CHANGED = "Статус фотоотчета уже изменен"

/** A scoped reviewer tried to review their own report (403). */
export const OWN_PHOTO_REPORT_REVIEW = "Нельзя проверить свой фотоотчет"

/** True when the scope may review a report of `employeeId` that it can see: not a scoped reader's own one. */
export function mayReviewPhotoReport(scope: FieldScope, employeeId: number): boolean {
  return scope.all || employeeId !== scope.employeeId
}

/**
 * Sets the status of photo report `id`. The row is locked FOR UPDATE and re-checked inside the
 * transaction: a report missing or outside the reader's scope is 404, a scoped reviewer's own
 * report is 403 (mayReviewPhotoReport), and when `expected` (the
 * status the page showed) is given and no longer current, the change is refused with 409 and the
 * current status, so two reviewers toggling the same card cannot undo each other unseen.
 */
export async function setPhotoReportStatus(
  id: number,
  status: PhotoReportStatus,
  scope: FieldScope,
  expected?: PhotoReportStatus,
): Promise<PhotoReportReview> {
  await ensureFieldSchema()
  return withTransaction(async (tx) => {
    const row = (await tx.prepare("SELECT id, employee_id, status FROM field_photo_reports WHERE id = ? FOR UPDATE").get(id)) as
      | { id: number; employee_id: number; status: string }
      | undefined
    if (!row || !scopeAllows(scope, Number(row.employee_id))) throw new FieldError(NOT_FOUND_MESSAGE, 404)
    if (!mayReviewPhotoReport(scope, Number(row.employee_id))) throw new FieldError(OWN_PHOTO_REPORT_REVIEW, 403, { code: "ownReport" })
    if (expected !== undefined && row.status !== expected) {
      throw new FieldError(PHOTO_REPORT_STATUS_CHANGED, 409, { code: "statusChanged", status: row.status })
    }
    if (row.status !== status) await tx.prepare("UPDATE field_photo_reports SET status = ? WHERE id = ?").run(status, id)
    return { id, status }
  })
}
