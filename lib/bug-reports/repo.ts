import "server-only"

import { getDb } from "@/lib/db"
import { ensureBugReportsSchema } from "@/lib/bug-reports/schema"
import type { TelegramReport } from "@/lib/bug-reports/telegram"
import type {
  BugAiStatus,
  BugAnalysis,
  BugDeliveryState,
  BugHelperResult,
  BugReportDetail,
  BugReportListItem,
  BugReportStatus,
  BugSeverity,
  BugStoredContext,
} from "@/lib/bug-reports/types"

// Reads and writes of bug_reports (lib/bug-reports/schema.ts). The delivery state machine lives in
// single UPDATE … WHERE delivery = … statements: whoever moves a report out of a waiting state (the
// customer's answer, the 15-minute sweep, the helper's "xato") is the only one that delivers it, so a
// report never reaches Telegram twice.
//
// A report is inserted as 'awaiting_feedback' with no helper result: the helper's answer is awaited
// (≤ 20 s). A server that stops meanwhile leaves it to the sweep, which delivers it. The customer's
// feedback and answer additionally need the matching helper result, so they never apply to that state.
//
// The Telegram message is tracked apart from the delivery (notified_at, notify_attempts): a delivered
// report whose message a restart or a Telegram failure left unsent is sent again by the sweep. The
// analysis reply needs that message, so markNotified and saveAnalysis each return the other's state:
// Postgres runs the two UPDATEs of one row one after the other, so exactly one of them sees both done.

const WAITING = "('awaiting_feedback', 'awaiting_answer')"

const LIST_COLUMNS = `id, created_at, user_id, user_name, page_url, status, ai_status, delivery, resolved_by_ai,
  ai_analysis->>'qisqa' AS short, ai_analysis->>'jiddiylik' AS severity, ai_analysis->>'ishonch' AS confidence`

type ListRow = {
  id: number
  created_at: Date | string
  user_id: number
  user_name: string
  page_url: string
  status: BugReportStatus
  ai_status: BugAiStatus
  delivery: BugDeliveryState
  resolved_by_ai: boolean
  short: string | null
  severity: BugSeverity | null
  confidence: "aniq" | "taxmin" | null
}

type DetailRow = ListRow & {
  comment: string
  has_screenshot: boolean
  context: Record<string, unknown> | null
  ai_analysis: BugAnalysis | null
  ai_error: string | null
  helper_result: BugHelperResult | null
  updated_at: Date | string
}

const iso = (value: Date | string | null | undefined): string => (value instanceof Date ? value.toISOString() : value ? new Date(value).toISOString() : "")

/** The admin page's screenshot address of a report. */
export const bugScreenshotUrl = (id: number) => `/api/admin/bug-reports/${id}/screenshot`

function toListItem(row: ListRow): BugReportListItem {
  return {
    id: Number(row.id),
    createdAt: iso(row.created_at),
    userId: Number(row.user_id),
    userName: row.user_name,
    pageUrl: row.page_url,
    status: row.status,
    aiStatus: row.ai_status,
    delivery: row.delivery,
    resolvedByAi: Boolean(row.resolved_by_ai),
    short: row.short || null,
    severity: row.severity || null,
    confidence: row.confidence || null,
  }
}

export type NewBugReport = {
  userId: number
  userName: string
  pageUrl: string
  comment: string
  screenshot: Buffer | null
  screenshotType: string | null
  context: BugStoredContext | Record<string, unknown>
}

/** Saves a new report (before any AI call); its id. */
export async function insertBugReport(input: NewBugReport): Promise<number> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(
      `INSERT INTO bug_reports (user_id, user_name, page_url, comment, screenshot, screenshot_type, context, delivery)
       VALUES (@userId, @userName, @pageUrl, @comment, @screenshot, @screenshotType, @context::jsonb, 'awaiting_feedback')
       RETURNING id`,
    )
    .get({
      userId: input.userId,
      userName: input.userName,
      pageUrl: input.pageUrl,
      comment: input.comment,
      screenshot: input.screenshot,
      screenshotType: input.screenshot ? input.screenshotType : null,
      context: JSON.stringify(input.context),
    })) as { id: number }
  return Number(row.id)
}

/** Stores the helper's answer while the report still waits; `delivery` moves it to the state that waits
 * for the customer (null: unchanged). False when the report no longer waits (the sweep delivered it). */
export async function setHelperResult(id: number, helper: BugHelperResult, delivery: "awaiting_feedback" | "awaiting_answer" | null): Promise<boolean> {
  await ensureBugReportsSchema()
  const result = await getDb()
    .prepare(
      `UPDATE bug_reports SET helper_result = @helper::jsonb, delivery = COALESCE(@delivery::text, delivery), updated_at = now()
        WHERE id = @id AND delivery IN ${WAITING}`,
    )
    .run({ id, helper: JSON.stringify(helper), delivery })
  return result.changes > 0
}

/** Moves a waiting report to 'delivered'. True only for the one caller that did it. */
export async function claimDelivery(id: number): Promise<boolean> {
  await ensureBugReportsSchema()
  const row = await getDb()
    .prepare(`UPDATE bug_reports SET delivery = 'delivered', delivered_at = now(), updated_at = now() WHERE id = ? AND delivery IN ${WAITING} RETURNING id`)
    .get(id)
  return Boolean(row)
}

/** The customer's "Yordam berdi" (helped) or "Yordam bermadi" on their own report that awaits it:
 * resolved by the AI, or claimed for delivery. "Not helped" also delivers a report that awaits the one
 * answer: the customer closed the panel without answering, so it goes on without the answer instead of
 * waiting for the sweep. False when it does not apply (see ownerState). */
export async function claimFeedback(id: number, userId: number, helped: boolean): Promise<boolean> {
  await ensureBugReportsSchema()
  const row = await getDb()
    .prepare(
      `UPDATE bug_reports
          SET delivery = CASE WHEN @helped::boolean THEN 'resolved_by_ai' ELSE 'delivered' END,
              resolved_by_ai = @helped::boolean,
              delivered_at = CASE WHEN @helped::boolean THEN delivered_at ELSE now() END,
              updated_at = now()
        WHERE id = @id AND user_id = @userId
          AND ((delivery = 'awaiting_feedback' AND helper_result->>'holat' = 'yordam')
            OR (NOT @helped::boolean AND delivery = 'awaiting_answer' AND helper_result->>'holat' = 'aniqlashtirish'))
        RETURNING id`,
    )
    .get({ id, userId, helped })
  return Boolean(row)
}

/** The customer's one answer to the helper's question: appended to the comment (with the question) and
 * the report claimed for delivery, in one statement. False when it does not apply (see ownerState). */
export async function claimClarification(id: number, userId: number, answer: string): Promise<boolean> {
  await ensureBugReportsSchema()
  const row = await getDb()
    .prepare(
      `UPDATE bug_reports
          SET comment = comment || @questionLabel::text || COALESCE(helper_result->>'savol', '') || @answerLabel::text || @answer::text,
              delivery = 'delivered', delivered_at = now(), updated_at = now()
        WHERE id = @id AND user_id = @userId AND delivery = 'awaiting_answer' AND helper_result->>'holat' = 'aniqlashtirish'
        RETURNING id`,
    )
    .get({ id, userId, answer, questionLabel: "\n\n— Savol: ", answerLabel: "\n— Javob: " })
  return Boolean(row)
}

/** Who owns a report and where it stands (to tell 404 from 409), or null. */
export async function ownerState(id: number): Promise<{ userId: number; delivery: BugDeliveryState } | null> {
  await ensureBugReportsSchema()
  const row = (await getDb().prepare("SELECT user_id, delivery FROM bug_reports WHERE id = ?").get(id)) as
    | { user_id: number; delivery: BugDeliveryState }
    | undefined
  return row ? { userId: Number(row.user_id), delivery: row.delivery } : null
}

export type DeliveryReport = TelegramReport & {
  context: Record<string, unknown>
  delivery: BugDeliveryState
  /** The Telegram message went out (or there was nothing to send). */
  notified: boolean
  notifyAttempts: number
}

const messageIdOf = (value: string | number | null | undefined) => (value === null || value === undefined ? null : Number(value))

/** What the Telegram message and the analysis need, the screenshot bytes included. */
export async function loadForDelivery(id: number): Promise<DeliveryReport | null> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(
      `SELECT id, user_name, page_url, comment, screenshot, screenshot_type, telegram_message_id, context, delivery,
              (notified_at IS NOT NULL) AS notified, notify_attempts
         FROM bug_reports WHERE id = ?`,
    )
    .get(id)) as
    | {
        id: number
        user_name: string
        page_url: string
        comment: string
        screenshot: Buffer | null
        screenshot_type: string | null
        telegram_message_id: string | number | null
        context: Record<string, unknown> | null
        delivery: BugDeliveryState
        notified: boolean
        notify_attempts: number
      }
    | undefined
  if (!row) return null
  return {
    id: Number(row.id),
    userName: row.user_name,
    pageUrl: row.page_url,
    comment: row.comment,
    screenshot: row.screenshot,
    screenshotType: row.screenshot_type,
    telegramMessageId: messageIdOf(row.telegram_message_id),
    context: row.context ?? {},
    delivery: row.delivery,
    notified: Boolean(row.notified),
    notifyAttempts: Number(row.notify_attempts),
  }
}

/** Takes the next attempt at the report's Telegram message: true for the one caller that read `seen`
 * attempts (two callers cannot both send), false when it went out meanwhile or `max` were made. */
export async function claimNotifyAttempt(id: number, seen: number, max: number): Promise<boolean> {
  await ensureBugReportsSchema()
  // Bookkeeping, not a change of the report: updated_at stays (the stale-analysis sweep reads it).
  const row = await getDb()
    .prepare(
      `UPDATE bug_reports SET notify_attempts = notify_attempts + 1
        WHERE id = @id AND notified_at IS NULL AND notify_attempts = @seen::int AND notify_attempts < @max::int
        RETURNING id`,
    )
    .get({ id, seen, max })
  return Boolean(row)
}

/** Where the analysis stood when the Telegram message was recorded. */
export type NotifiedState = { aiStatus: BugAiStatus; analysis: BugAnalysis | null; error: string | null }

/** Records the Telegram message (`messageId`; null: there was nothing to send). Returns the analysis'
 * state at that moment (one that already ended is posted by the caller, see the header), or null when
 * the message was recorded before. */
export async function markNotified(id: number, messageId: number | null): Promise<NotifiedState | null> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(
      `UPDATE bug_reports SET notified_at = now(), telegram_message_id = COALESCE(@messageId::bigint, telegram_message_id)
        WHERE id = @id AND notified_at IS NULL
        RETURNING ai_status, ai_analysis, ai_error`,
    )
    .get({ id, messageId })) as { ai_status: BugAiStatus; ai_analysis: BugAnalysis | null; ai_error: string | null } | undefined
  return row ? { aiStatus: row.ai_status, analysis: row.ai_analysis ?? null, error: row.ai_error ?? null } : null
}

/** A new analysis run: PENDING, the last error cleared (a previous analysis stays until the new one is
 * done). False when the report does not exist. */
export async function markAnalysisPending(id: number): Promise<boolean> {
  await ensureBugReportsSchema()
  const result = await getDb().prepare("UPDATE bug_reports SET ai_status = 'PENDING', ai_error = NULL, updated_at = now() WHERE id = ?").run(id)
  return result.changes > 0
}

/** Where a report stands when its analysis is saved, read by the save itself (an analysis takes minutes:
 * what was loaded at its start is stale by then). */
export type AnalysisSavedState = { delivery: BugDeliveryState; telegramMessageId: number | null; notified: boolean }

const SAVED_STATE = "RETURNING delivery, telegram_message_id, (notified_at IS NOT NULL) AS notified"

type SavedRow = { delivery: BugDeliveryState; telegram_message_id: string | number | null; notified: boolean } | undefined

const savedState = (row: SavedRow): AnalysisSavedState | null =>
  row ? { delivery: row.delivery, telegramMessageId: messageIdOf(row.telegram_message_id), notified: Boolean(row.notified) } : null

/** DONE with the analysis; the report's state at that moment, or null when it does not exist. */
export async function saveAnalysis(id: number, analysis: BugAnalysis): Promise<AnalysisSavedState | null> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(`UPDATE bug_reports SET ai_analysis = @analysis::jsonb, ai_status = 'DONE', ai_error = NULL, updated_at = now() WHERE id = @id ${SAVED_STATE}`)
    .get({ id, analysis: JSON.stringify(analysis) })) as SavedRow
  return savedState(row)
}

/** FAILED with the error; a previous analysis (of an earlier run) is kept next to it. The report's state
 * at that moment, or null when it does not exist. */
export async function saveAnalysisFailure(id: number, error: string): Promise<AnalysisSavedState | null> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(`UPDATE bug_reports SET ai_status = 'FAILED', ai_error = @error, updated_at = now() WHERE id = @id ${SAVED_STATE}`)
    .get({ id, error })) as SavedRow
  return savedState(row)
}

/** Reports whose customer did not answer the helper within `minutes` (oldest first). */
export async function staleWaitingIds(minutes: number, limit = 50): Promise<number[]> {
  await ensureBugReportsSchema()
  const rows = (await getDb()
    .prepare(`SELECT id FROM bug_reports WHERE delivery IN ${WAITING} AND created_at < now() - make_interval(mins => @minutes::int) ORDER BY id LIMIT @limit`)
    .all({ minutes, limit })) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

/** Delivered reports whose Telegram message has not gone out, due for another attempt: attempt n + 1 once
 * `minutes` × (n + 1) passed since the delivery (later each time), at most `maxAttempts` in all. */
export async function unnotifiedIds(minutes: number, maxAttempts: number, limit = 10): Promise<number[]> {
  await ensureBugReportsSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM bug_reports
        WHERE delivery = 'delivered' AND notified_at IS NULL AND notify_attempts < @maxAttempts::int
          AND COALESCE(delivered_at, created_at) < now() - make_interval(mins => @minutes::int * (notify_attempts + 1))
        ORDER BY id LIMIT @limit`,
    )
    .all({ minutes, maxAttempts, limit })) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

/** Delivered reports whose analysis is still PENDING `minutes` after delivery: the server stopped while it
 * ran (a running analysis ends within a few minutes, retries included). */
export async function stalePendingAnalysisIds(minutes: number, limit = 10): Promise<number[]> {
  await ensureBugReportsSchema()
  const rows = (await getDb()
    .prepare(
      `SELECT id FROM bug_reports
        WHERE delivery = 'delivered' AND ai_status = 'PENDING' AND COALESCE(delivered_at, created_at) < now() - make_interval(mins => @minutes::int)
          AND updated_at < now() - make_interval(mins => @minutes::int)
        ORDER BY id LIMIT @limit`,
    )
    .all({ minutes, limit })) as Array<{ id: number }>
  return rows.map((row) => Number(row.id))
}

export type BugReportFilters = {
  status?: BugReportStatus
  severity?: BugSeverity
  resolvedByAi?: boolean
  page: number
  pageSize: number
}

/** The admin list: newest first, filtered, one page. */
export async function listBugReports(filters: BugReportFilters): Promise<{ rows: BugReportListItem[]; total: number }> {
  await ensureBugReportsSchema()
  const where: string[] = []
  const params: Record<string, unknown> = { limit: filters.pageSize, offset: (filters.page - 1) * filters.pageSize }
  if (filters.status) {
    where.push("status = @status")
    params.status = filters.status
  }
  if (filters.severity) {
    where.push("ai_analysis->>'jiddiylik' = @severity")
    params.severity = filters.severity
  }
  if (filters.resolvedByAi !== undefined) {
    where.push("resolved_by_ai = @resolvedByAi")
    params.resolvedByAi = filters.resolvedByAi
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : ""
  const db = getDb()
  const rows = (await db
    .prepare(`SELECT ${LIST_COLUMNS} FROM bug_reports ${clause} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`)
    .all(params)) as ListRow[]
  // Without a filter the count has no placeholder at all: no parameters may be passed then (the shim
  // would bind the object as a value). With one, the unused limit / offset keys are simply not bound.
  const countSql = db.prepare(`SELECT COUNT(*)::int AS total FROM bug_reports ${clause}`)
  const counted = (await (where.length ? countSql.get(params) : countSql.get())) as { total: number }
  return { rows: rows.map(toListItem), total: Number(counted.total) }
}

/** One report for the admin page (no screenshot bytes), or null. */
export async function getBugReportDetail(id: number): Promise<BugReportDetail | null> {
  await ensureBugReportsSchema()
  const row = (await getDb()
    .prepare(
      `SELECT ${LIST_COLUMNS}, comment, (screenshot IS NOT NULL) AS has_screenshot, context, ai_analysis, ai_error, helper_result, updated_at
         FROM bug_reports WHERE id = ?`,
    )
    .get(id)) as DetailRow | undefined
  if (!row) return null
  return {
    ...toListItem(row),
    comment: row.comment,
    screenshotUrl: row.has_screenshot ? bugScreenshotUrl(Number(row.id)) : null,
    context: row.context ?? {},
    aiAnalysis: row.ai_analysis ?? null,
    aiError: row.ai_error ?? null,
    helperResult: row.helper_result ?? null,
    updatedAt: iso(row.updated_at),
  }
}

/** The admin's status change; false when the report does not exist. */
export async function updateBugReportStatus(id: number, status: BugReportStatus): Promise<boolean> {
  await ensureBugReportsSchema()
  const result = await getDb().prepare("UPDATE bug_reports SET status = ?, updated_at = now() WHERE id = ?").run(status, id)
  return result.changes > 0
}

/** The stored screenshot, or null when the report has none. */
export async function readBugScreenshot(id: number): Promise<{ data: Buffer; type: string } | null> {
  await ensureBugReportsSchema()
  const row = (await getDb().prepare("SELECT screenshot, screenshot_type FROM bug_reports WHERE id = ? AND screenshot IS NOT NULL").get(id)) as
    | { screenshot: Buffer; screenshot_type: string | null }
    | undefined
  return row ? { data: row.screenshot, type: row.screenshot_type || "image/jpeg" } : null
}
