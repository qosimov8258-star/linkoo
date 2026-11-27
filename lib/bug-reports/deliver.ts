import "server-only"

import { analyzeBugReport, describeAiError } from "@/lib/bug-reports/ai"
import {
  claimDelivery,
  claimNotifyAttempt,
  loadForDelivery,
  markAnalysisPending,
  markNotified,
  saveAnalysis,
  saveAnalysisFailure,
  stalePendingAnalysisIds,
  staleWaitingIds,
  unnotifiedIds,
} from "@/lib/bug-reports/repo"
import { replyWithAnalysis, sendReportMessage, telegramConfigured } from "@/lib/bug-reports/telegram"
import type { BugAiStatus, BugAnalysis } from "@/lib/bug-reports/types"

// Delivery of a bug report to the developer, after it was saved and the helper had its say:
//  1. the report is claimed (repo.claimDelivery / claimFeedback / claimClarification: one caller only);
//  2. the Telegram message goes out (when Telegram is configured) and is recorded (notified_at, apart
//     from the delivery): a message a restart or a Telegram failure left unsent is sent again by the
//     sweep, later each time, NOTIFY_MAX_ATTEMPTS attempts in all;
//  3. the screenshot analysis runs, its result is stored (DONE / FAILED) and sent as a reply to that
//     message. The reply needs the message, so whichever of 2 and 3 ends last posts it: each records its
//     step in one UPDATE that returns the other's state (repo.ts), and exactly one of them sees both done.
// Steps 2 and 3 run in the background: the customer's request never waits for Telegram or the analysis,
// and nothing there throws into a request. This is a single long-running Node server (Docker), so a
// promise left running after the response completes; a restart in between is caught by the sweep.

/** A customer who leaves the helper's answer or question unanswered this long gets the report delivered. */
export const WAITING_DELIVER_AFTER_MINUTES = 15
/** Attempts at a report's Telegram message (the first one right after the delivery). */
export const NOTIFY_MAX_ATTEMPTS = 5
/** Attempt n + 1 at a message comes NOTIFY_RETRY_MINUTES × (n + 1) after the delivery: 10, 15, 20, 25 min. */
const NOTIFY_RETRY_MINUTES = 5
/** The sweep's own timer (started with the server by instrumentation.ts). */
const SWEEP_INTERVAL_MS = 60_000
/** Report submissions and admin list reads run the sweep too, at most this often per process. */
const SWEEP_MIN_GAP_MS = 30_000
/** Bumped when the timer's code changes: a running dev server (globalThis survives hot reloads) then
 * replaces its timer instead of keeping the old code. */
const SWEEP_TIMER_VERSION = 1

declare global {
  /** Ids whose analysis runs in this process (one at a time per report). */
  var __mezonBugAnalyses: Set<number> | undefined
  var __mezonBugSweep: { at: number; running: boolean } | undefined
  var __mezonBugSweepTimer: { version: number; timer: ReturnType<typeof setInterval> } | undefined
}

const runningAnalyses = () => (globalThis.__mezonBugAnalyses ??= new Set<number>())

const warn = (what: string, error: unknown) => console.warn(`[bug-reports] ${what}:`, error instanceof Error ? error.message : error)

export function isAnalysisRunning(id: number): boolean {
  return runningAnalyses().has(id)
}

/** Takes the report's analysis slot; false when an analysis of it already runs. Synchronous, so two
 * requests cannot both take it. */
export function reserveAnalysis(id: number): boolean {
  const running = runningAnalyses()
  if (running.has(id)) return false
  running.add(id)
  return true
}

export function releaseAnalysis(id: number): void {
  runningAnalyses().delete(id)
}

/** Starts the analysis in the background (`reserved`: the caller already holds the slot). False when one
 * already runs. */
export function startAnalysis(id: number, reserved = false): boolean {
  if (!reserved && !reserveAnalysis(id)) return false
  void runAnalysis(id)
    .catch((error) => warn(`analysis of #${id}`, error))
    .finally(() => releaseAnalysis(id))
  return true
}

async function runAnalysis(id: number): Promise<void> {
  const report = await loadForDelivery(id)
  if (!report) return
  let analysis: BugAnalysis | null = null
  let error: string | null = null
  try {
    const imageDataUrl = report.screenshot?.length ? `data:${report.screenshotType || "image/jpeg"};base64,${report.screenshot.toString("base64")}` : null
    analysis = await analyzeBugReport({ comment: report.comment, context: report.context, imageDataUrl })
  } catch (analysisError) {
    error = describeAiError(analysisError)
  }
  // Where the report stands is read by the save itself, not taken from the load above: the run takes up
  // to minutes, and meanwhile the customer may have had the report delivered or its message may have
  // gone out (a re-run that started while the report waited, or during the Telegram send).
  const state = analysis ? await saveAnalysis(id, analysis) : await saveAnalysisFailure(id, error ?? "")
  // Only a report that went to the developer gets a reply; a re-run on one that was resolved by the AI
  // (or still waits for the customer) stays on the admin page. Before its message is out the reply
  // waits: sendNotification posts it together with the message.
  if (state?.delivery === "delivered" && state.notified) {
    await replyWithAnalysis({ id, telegramMessageId: state.telegramMessageId, comment: report.comment }, analysis, error)
  }
}

/**
 * Step 2: sends the report's Telegram message unless it went out already. Without Telegram there is
 * nothing to send, and the report is recorded as notified at once (it is never sent later, when Telegram
 * gets configured). An analysis that ended before the message is posted here as its reply. Returns the
 * analysis status found when the message was recorded, or null when nothing was recorded now (not
 * delivered, already notified, another attempt is on it, or this attempt failed).
 */
async function sendNotification(id: number): Promise<BugAiStatus | null> {
  const report = await loadForDelivery(id)
  if (!report || report.delivery !== "delivered" || report.notified) return null
  if (!telegramConfigured()) return (await markNotified(id, null))?.aiStatus ?? null
  let messageId = report.telegramMessageId
  if (!messageId) {
    if (!(await claimNotifyAttempt(id, report.notifyAttempts, NOTIFY_MAX_ATTEMPTS))) return null
    messageId = await sendReportMessage(report)
    if (!messageId) {
      const attempt = report.notifyAttempts + 1
      console.warn(`[bug-reports] report #${id}: the Telegram message was not sent (attempt ${attempt} of ${NOTIFY_MAX_ATTEMPTS})`)
      return null
    }
  }
  const state = await markNotified(id, messageId)
  if (state && state.aiStatus !== "PENDING") {
    await replyWithAnalysis({ id, telegramMessageId: messageId, comment: report.comment }, state.aiStatus === "DONE" ? state.analysis : null, state.error)
  }
  return state?.aiStatus ?? null
}

/** Step 2 and 3 for a claimed report, in the background. */
export function afterDeliveryClaimed(id: number): void {
  void notifyAndAnalyze(id).catch((error) => warn(`delivery of #${id}`, error))
}

async function notifyAndAnalyze(id: number): Promise<void> {
  // A fresh analysis follows every delivery (the comment may have gained the customer's answer). A result
  // from before (an admin's «Qayta tahlil» while the report waited) is not the one to reply with: back to
  // PENDING first, so the message does not post it and the run below replies with the new one. A re-run
  // that is still going is left alone (it is PENDING already, and replies when it ends).
  if (!isAnalysisRunning(id)) await markAnalysisPending(id)
  const aiStatus = await sendNotification(id)
  // An analysis that ended during the send (a re-run that was already going) was posted with the message.
  if (aiStatus === "DONE" || aiStatus === "FAILED") return
  startAnalysis(id)
}

/** The sweep's second attempt (and later ones) at a report's message. */
async function notifyAgain(id: number): Promise<void> {
  // Its analysis may have stopped with the server as well; one that already ended went with the message,
  // and one that runs replies when it ends (startAnalysis does nothing then).
  if ((await sendNotification(id)) === "PENDING") startAnalysis(id)
}

/** Claims a waiting report and delivers it; false when it was not waiting (someone else delivered it). */
export async function deliverReport(id: number): Promise<boolean> {
  if (!(await claimDelivery(id))) return false
  afterDeliveryClaimed(id)
  return true
}

/**
 * The sweep, fire-and-forget: delivers reports whose customer left the helper's answer or question
 * unanswered for WAITING_DELIVER_AFTER_MINUTES (the panel was closed without a word, the tab died, the
 * server stopped while the helper ran), sends again report messages a restart or Telegram left unsent,
 * and restarts analyses a stopped server left PENDING. It runs on its own timer (startBugReportSweep) and
 * also on report submissions and admin list reads, at most every SWEEP_MIN_GAP_MS, one run at a time.
 */
export function sweepWaitingReports(): void {
  startBugReportSweep()
  const state = (globalThis.__mezonBugSweep ??= { at: 0, running: false })
  const now = Date.now()
  if (state.running || now - state.at < SWEEP_MIN_GAP_MS) return
  state.at = now
  state.running = true
  void (async () => {
    for (const id of await staleWaitingIds(WAITING_DELIVER_AFTER_MINUTES)) {
      await deliverReport(id).catch((error) => warn(`sweep delivery of #${id}`, error))
    }
    // One after another: each waits for Telegram (bounded by its timeouts), and a burst is not sent at once.
    for (const id of await unnotifiedIds(NOTIFY_RETRY_MINUTES, NOTIFY_MAX_ATTEMPTS)) {
      await notifyAgain(id).catch((error) => warn(`sweep message of #${id}`, error))
    }
    for (const id of await stalePendingAnalysisIds(WAITING_DELIVER_AFTER_MINUTES)) startAnalysis(id)
  })()
    .catch((error) => warn("sweep", error))
    .finally(() => {
      state.running = false
    })
}

/**
 * Starts the sweep's timer, once per process (instrumentation.ts calls it when the server starts; the
 * first sweep call starts it too, should that hook not have run). Without it a waiting report would move
 * only when someone else sends a report or opens «Xato xabarlari», which on a quiet install can be days.
 * unref(): the timer never keeps a process alive (a script or a test that imports this module ends).
 */
export function startBugReportSweep(): void {
  const current = globalThis.__mezonBugSweepTimer
  if (current?.version === SWEEP_TIMER_VERSION) return
  if (current) clearInterval(current.timer)
  const timer = setInterval(sweepWaitingReports, SWEEP_INTERVAL_MS)
  timer.unref()
  globalThis.__mezonBugSweepTimer = { version: SWEEP_TIMER_VERSION, timer }
}
