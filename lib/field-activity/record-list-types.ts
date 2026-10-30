// Shapes of the list APIs over the mobile app's refusals, photo reports and visits
// (lib/field-activity/record-lists.ts): GET /api/field-activity/refusals, /photo-reports,
// /client-visits and /client-counts, and the photo report review
// (PATCH /api/field-activity/photo-reports/[id]/status). Client-safe (no server-only), so the
// Продажи and Клиенты pages can import them.

import type { FieldPhoto } from "@/lib/field-activity/types"

/** Review states of a photo report (field_photo_reports.status). */
export const PHOTO_REPORT_STATUSES = ["pending", "rejected", "accepted"] as const
export type PhotoReportStatus = (typeof PHOTO_REPORT_STATUSES)[number]

/** Page sizes of the list APIs. */
export const RECORD_LIST_MAX_PAGE_SIZE = 500

/** One refusal or photo report of a list. */
export type FieldRecordRow = {
  id: number
  visitId: number | null
  employeeId: number
  /** Current employee name ("" when the employee no longer exists). */
  employeeName: string
  clientId: number
  clientName: string
  /** When it happened on the device: local Asia/Tashkent "YYYY-MM-DDTHH:mm:ss". */
  at: string
  comment: string
  /** Refusal: the current refusal type name, else the stored one. */
  reason: string
  refusalTypeId: number | null
  /** Photo report: pending | rejected | accepted. */
  status: string
  /** Refusal photos, or the report's before / after photos (in that order). */
  photos: FieldPhoto[]
}

export type FieldOption = { id: number; name: string }

/** Filter options of a list page: the employees / clients / refusal types its records use. */
export type FieldRecordFacets = { employees: FieldOption[]; clients: FieldOption[]; refusalTypes: FieldOption[] }

export type FieldRecordPage = {
  /** Every record of the filter (a `before` cursor does not narrow it). */
  count: number
  page: number
  pageSize: number
  /** True when older records follow this page. */
  hasMore: boolean
  /** Pass as ?before= to get the records after this page (keyset paging: records that arrive
   * meanwhile cannot shift it); null on the last page. */
  nextCursor: string | null
  rows: FieldRecordRow[]
  /** Only when asked for (?facets=true). */
  facets?: FieldRecordFacets
  /** Photo reports: the reader's own employee when their field scope is narrow — its reports are
   * listed but the reader may not review them (PATCH …/status answers 403); null for a full scope. */
  ownEmployeeId?: number | null
}

/** A visit of one client that is not linked to an order (GET /api/field-activity/client-visits). */
export type ClientVisitRow = {
  visitId: number
  employeeId: number
  /** Current employee name, else "#id". */
  agent: string
  /** Local Asia/Tashkent "YYYY-MM-DDTHH:mm:ss". */
  startedAt: string
  durationSec: number
  /** order | refusal | photo_report | no_sale, or "open" while the visit runs. */
  result: string
  /** The refusal's current type name, else its stored reason ("" without a refusal). */
  refusal: string
  planned: boolean
}

export type ClientVisitPage = { count: number; hasMore: boolean; nextCursor: string | null; rows: ClientVisitRow[] }

/** Answer of PATCH /api/field-activity/photo-reports/[id]/status. */
export type PhotoReportReview = { id: number; status: PhotoReportStatus }

/** Visits / refusals / photo reports of one client in a period (Анализ покрытия). */
export type ClientFieldCount = { clientId: number; visits: number; refusals: number; photoReports: number }

/**
 * Text options of a name-only select (list-kit FilterSelect) that still filter by id: every
 * label is unique (a name shared by two records gets its "#id"), and maps back to its id.
 */
export function optionLabels(options: FieldOption[]): { labels: string[]; idOf: Map<string, number>; labelOf: Map<number, string> } {
  const seen = new Map<string, number>()
  for (const option of options) seen.set(option.name, (seen.get(option.name) ?? 0) + 1)
  const idOf = new Map<string, number>()
  const labelOf = new Map<number, string>()
  for (const option of options) {
    const label = (seen.get(option.name) ?? 0) > 1 ? `${option.name} #${option.id}` : option.name
    idOf.set(label, option.id)
    labelOf.set(option.id, label)
  }
  return { labels: [...idOf.keys()], idOf, labelOf }
}
