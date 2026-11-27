import "server-only"

import { NextResponse } from "next/server"

import { aiConfigured, askHelper, describeAiError } from "@/lib/bug-reports/ai"
import { afterDeliveryClaimed, deliverReport, sweepWaitingReports } from "@/lib/bug-reports/deliver"
import { manualForQuestion, readManual } from "@/lib/bug-reports/manual"
import { cleanText, maskContext, maskPageUrl } from "@/lib/bug-reports/mask"
import { BUG_MESSAGES } from "@/lib/bug-reports/messages"
import { claimClarification, claimFeedback, insertBugReport, ownerState, setHelperResult } from "@/lib/bug-reports/repo"
import {
  BUG_COMMENT_MAX,
  BUG_COMMENT_MIN,
  BUG_CONTEXT_MAX_CHARS,
  BUG_SCREENSHOT_MAX_BYTES,
  type BugHelperResult,
  type BugStoredContext,
} from "@/lib/bug-reports/types"
import type { CurrentUser } from "@/lib/current-user"
import { sniffPhotoType, type PhotoType } from "@/lib/field-activity/photos-repo"

// The customer's side of a bug report: the multipart form of POST /api/bug-reports, the save, the helper
// and the decision to deliver, and the two follow-ups (feedback, the one answer). The order is fixed by
// the spec: the report is SAVED first; the helper (≤ 20 s, skipped without a key) may then keep it for
// the customer's feedback or one answer; anything else — "xato", a helper failure, a database hiccup after
// the save — delivers it (or leaves it to the sweep). Saving and notifying never depend on the AI.

const PAGE_URL_MAX = 2_000

export type ParsedReport = {
  comment: string
  pageUrl: string
  /** The browser's context, masked (lib/bug-reports/mask.ts). */
  context: Record<string, unknown>
  screenshot: Buffer | null
  screenshotType: PhotoType | null
}

const refuse = (message: string, status: number, field?: string) =>
  NextResponse.json(field ? { error: message, field, fields: { [field]: message } } : { error: message }, { status })

/** A JSON object of the context field, or {} (a broken context never stops the report). */
function parseContext(text: string): Record<string, unknown> {
  if (!text.trim()) return {}
  try {
    const value = JSON.parse(text) as unknown
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** Reads and validates the multipart form (comment, pageUrl, context, screenshot). */
export async function readReportForm(request: Request): Promise<{ data: ParsedReport } | { error: NextResponse }> {
  if (!/^multipart\/form-data\b/i.test(request.headers.get("content-type") ?? "")) return { error: refuse(BUG_MESSAGES.notMultipart, 400) }
  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return { error: refuse(BUG_MESSAGES.notMultipart, 400) }
  }
  const text = (name: string) => {
    const value = form.get(name)
    return typeof value === "string" ? value : ""
  }

  const comment = cleanText(text("comment")).trim()
  if (comment.length < BUG_COMMENT_MIN) return { error: refuse(BUG_MESSAGES.commentShort, 400, "comment") }
  if (comment.length > BUG_COMMENT_MAX) return { error: refuse(BUG_MESSAGES.commentLong, 400, "comment") }

  const rawContext = text("context")
  if (rawContext.length > BUG_CONTEXT_MAX_CHARS) return { error: refuse(BUG_MESSAGES.contextTooLarge, 413, "context") }
  const context = maskContext(parseContext(rawContext)) as Record<string, unknown>

  const declaredPage = text("pageUrl").trim() || (typeof context.pageUrl === "string" ? context.pageUrl : "")
  // Cut before it is masked (multipart bodies reach here up to the proxy's 2 MB), and kept as a path of this
  // app only: the admin page and the Telegram line show it as the report's page.
  const pageUrl = maskPageUrl(declaredPage, PAGE_URL_MAX)

  let screenshot: Buffer | null = null
  let screenshotType: PhotoType | null = null
  const file = form.get("screenshot")
  if (file && typeof file !== "string" && file.size > 0) {
    if (file.size > BUG_SCREENSHOT_MAX_BYTES) return { error: refuse(BUG_MESSAGES.screenshotTooLarge, 413, "screenshot") }
    const bytes = new Uint8Array(await file.arrayBuffer())
    // The bytes decide, not the declared type: only a real JPEG / PNG / WebP is stored and shown.
    screenshotType = sniffPhotoType(bytes)
    if (!screenshotType) return { error: refuse(BUG_MESSAGES.screenshotType, 415, "screenshot") }
    screenshot = Buffer.from(bytes)
  }
  return { data: { comment, pageUrl, context, screenshot, screenshotType } }
}

export type SubmitResult = { id: number; helper: BugHelperResult | null; delivered: boolean }

/** Saves the report, asks the helper and delivers it unless the helper waits for the customer. */
export async function submitReport(user: CurrentUser, input: ParsedReport): Promise<SubmitResult> {
  // There is no table of backend errors in this app (server errors go to the process log only), so
  // backendErrors stays empty; the field is there for the analysis prompt's "backend loglari".
  const context: BugStoredContext | Record<string, unknown> = {
    ...input.context,
    server: { userId: user.id, username: user.username, role: user.role, receivedAt: new Date().toISOString(), backendErrors: [] },
  }
  const id = await insertBugReport({
    userId: user.id,
    userName: user.displayName || user.username,
    pageUrl: input.pageUrl,
    comment: input.comment,
    screenshot: input.screenshot,
    screenshotType: input.screenshotType,
    context,
  })
  sweepWaitingReports()

  // From here on the report is saved: a failure must not answer 500 (the customer would send it again).
  // Whatever is left undone, the sweep delivers it within WAITING_DELIVER_AFTER_MINUTES.
  let helper: BugHelperResult | null = null
  try {
    if (aiConfigured()) {
      try {
        helper = await askHelper({ comment: input.comment, pageUrl: input.pageUrl, context, manual: manualForQuestion(await readManual(), input.comment, input.pageUrl) })
      } catch (error) {
        console.warn(`[bug-reports] helper of #${id} skipped:`, describeAiError(error))
        helper = null
      }
    }
    if (helper && (helper.holat === "yordam" || helper.holat === "aniqlashtirish")) {
      const waiting = await setHelperResult(id, helper, helper.holat === "yordam" ? "awaiting_feedback" : "awaiting_answer")
      if (waiting) return { id, helper, delivered: false }
    } else if (helper) {
      await setHelperResult(id, helper, null)
    }
    return { id, helper, delivered: await deliverReport(id) }
  } catch (error) {
    console.warn(`[bug-reports] #${id} saved, delivery left to the sweep:`, error instanceof Error ? error.message : error)
    return { id, helper: null, delivered: false }
  }
}

export type FollowUpOutcome = "ok" | "notFound" | "notWaiting"

/** Why a follow-up did not apply: not the caller's report (or none) → 404, else the state → 409. */
async function refusal(id: number, userId: number): Promise<FollowUpOutcome> {
  const state = await ownerState(id)
  return !state || state.userId !== userId ? "notFound" : "notWaiting"
}

/** "Yordam berdi, rahmat" (helped) or "Yordam bermadi, dasturchiga yuborish" / the panel closed. */
export async function answerFeedback(id: number, userId: number, helped: boolean): Promise<FollowUpOutcome> {
  if (!(await claimFeedback(id, userId, helped))) return refusal(id, userId)
  if (!helped) afterDeliveryClaimed(id)
  return "ok"
}

/** The customer's one answer to the helper's question: appended to the comment, then delivered. */
export async function answerClarification(id: number, userId: number, answer: string): Promise<FollowUpOutcome> {
  if (!(await claimClarification(id, userId, answer))) return refusal(id, userId)
  afterDeliveryClaimed(id)
  return "ok"
}

/** The JSON answer of a follow-up outcome. */
export function followUpResponse(outcome: FollowUpOutcome): NextResponse {
  if (outcome === "ok") return NextResponse.json({ ok: true })
  if (outcome === "notFound") return NextResponse.json({ error: BUG_MESSAGES.notFound }, { status: 404 })
  return NextResponse.json({ error: BUG_MESSAGES.notWaiting }, { status: 409 })
}
