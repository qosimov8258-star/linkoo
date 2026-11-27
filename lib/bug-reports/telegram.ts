import "server-only"

import { readSetting, writeSetting } from "@/lib/app-settings"
import { getDb } from "@/lib/db"
import type { BugAnalysis } from "@/lib/bug-reports/types"

// The developer's Telegram notification of a bug report: the screenshot as a photo with the customer's
// comment, the page and a link to the admin page; later the AI analysis as a reply to that message.
// Sent only when TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are both set. Nothing here throws: a failed
// send is logged (never with the token, which is part of the API URL) and the report stays saved and
// visible in «Xato xabarlari». The texts are for the developer's chat, in Uzbek, not UI strings.
//
// One bot serves all of the owner's projects. Every message starts with the project's name and hashtag
// (BUG_REPORT_PROJECT_NAME, "Mezon" by default), and when the chat supports topics (a group with Topics on,
// or the bot's private chat with Threaded Mode on in @BotFather) the bot opens one topic per project the
// first time and posts there: the chat's topic list is then the menu of projects. TELEGRAM_THREAD_ID pins a
// topic by hand. The topic id is kept in app_settings (kept by scripts/migrate/load-data.sh).

const TELEGRAM_TIMEOUT_MS = 15_000
/** Telegram's limits: a photo caption and a message text. */
const CAPTION_MAX = 1024
const MESSAGE_MAX = 4096
const PAGE_URL_MAX = 300

export type TelegramReport = {
  id: number
  userName: string
  pageUrl: string
  comment: string
  screenshot: Buffer | null
  screenshotType: string | null
  /** The first message's id, once it was sent (the analysis replies to it). */
  telegramMessageId: number | null
}

type TelegramAnswer = { ok?: boolean; result?: { message_id?: number }; description?: string }

/** The project this app reports as (one bot, many projects). */
export function projectName(): string {
  return (process.env.BUG_REPORT_PROJECT_NAME || "Mezon").trim().slice(0, 60) || "Mezon"
}

/** The project's hashtag: Telegram's search by it lists only this project's reports. */
export function projectTag(): string {
  const word = projectName().replace(/[^\p{L}\p{N}_]+/gu, "_").replace(/^_+|_+$/g, "")
  return `#${word || "project"}`
}

function projectHeader(): string {
  return `🧩 <b>${escapeHtml(projectName())}</b> ${escapeHtml(projectTag())}`
}

function telegramConfig(): { token: string; chatId: string } | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim()
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim()
  return token && chatId ? { token, chatId } : null
}

export function telegramConfigured(): boolean {
  return telegramConfig() !== null
}

/** The admin page of a report: APP_PUBLIC_URL (or ALLOWED_ORIGIN) + /admin/bug-reports/<id>. */
export function adminReportLink(id: number): string {
  const base = (process.env.APP_PUBLIC_URL || process.env.ALLOWED_ORIGIN || "").trim().replace(/\/+$/, "")
  return `${base}/admin/bug-reports/${id}`
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

/** The escaped text, cut so that it takes at most `max` characters (with "…" when cut). */
function escapedWithin(text: string, max: number): string {
  if (max <= 0) return ""
  const full = escapeHtml(text)
  if (full.length <= max) return full
  let out = ""
  for (const char of Array.from(text)) {
    const piece = escapeHtml(char)
    if (out.length + piece.length > max - 1) break
    out += piece
  }
  return `${out}…`
}

/** A link Telegram accepts (absolute http/https on a public host); a relative path or a local address
 * (no public URL configured, a development machine) is plain text. */
function adminLinkHtml(id: number): string {
  const link = adminReportLink(id)
  const local = /^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/i.test(link)
  return /^https?:\/\//i.test(link) && !local ? `<a href="${escapeHtml(link)}">Admin panelda ochish</a>` : escapeHtml(link)
}

/** The report's text within `max` characters: the comment gets whatever the fixed lines leave. */
function reportText(report: TelegramReport, max: number): string {
  const head = [
    projectHeader(),
    `🐞 <b>Yangi xato xabari #${report.id}</b>`,
    `Mijoz: ${escapedWithin(report.userName || "-", 100)}`,
    `Sahifa: ${escapedWithin(report.pageUrl || "-", PAGE_URL_MAX)}`,
  ].join("\n")
  const foot = `Admin: ${adminLinkHtml(report.id)}`
  const label = "<b>Mijoz yozgani:</b>\n"
  const budget = max - head.length - foot.length - label.length - 4
  return `${head}\n\n${label}${escapedWithin(report.comment, budget)}\n\n${foot}`
}

async function callTelegram(method: string, body: FormData | Record<string, unknown>): Promise<TelegramAnswer> {
  const config = telegramConfig()
  if (!config) throw new Error("Telegram is not configured")
  const init: RequestInit =
    body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
  const response = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, { ...init, signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS) })
  const json = (await response.json().catch(() => null)) as TelegramAnswer | null
  if (!response.ok || !json?.ok) throw new Error(`Telegram ${method} ${response.status}: ${json?.description ?? "no answer"}`)
  return json
}

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error))

// --- The project's topic -----------------------------------------------------------------------------

/** After a failed topic creation (the chat has no topics) the next try waits this long, so turning topics
 * on later starts working without a restart, and plain chats are not asked on every message. */
const TOPIC_RETRY_MS = 60 * 60_000

declare global {
  var __mezonBugTopic: { chatId: string; threadId: number | null; checkedAt: number } | undefined
}

const topicKey = (chatId: string) => `bug_reports.telegram_topic:${chatId}:${projectName()}`

/** The topic of this project in the chat, created the first time; null when the chat has no topics. */
async function projectThreadId(chatId: string): Promise<number | null> {
  const pinned = Number(process.env.TELEGRAM_THREAD_ID)
  if (Number.isInteger(pinned) && pinned > 0) return pinned
  const cached = globalThis.__mezonBugTopic
  if (cached?.chatId === chatId && (cached.threadId !== null || Date.now() - cached.checkedAt < TOPIC_RETRY_MS)) return cached.threadId
  const db = getDb()
  const stored = Number(await readSetting(db, topicKey(chatId)).catch(() => null))
  if (Number.isInteger(stored) && stored > 0) {
    globalThis.__mezonBugTopic = { chatId, threadId: stored, checkedAt: Date.now() }
    return stored
  }
  let threadId: number | null = null
  try {
    const answer = (await callTelegram("createForumTopic", { chat_id: chatId, name: projectName() })) as TelegramAnswer & { result?: { message_thread_id?: number } }
    threadId = answer.result?.message_thread_id ?? null
    if (threadId) await writeSetting(db, topicKey(chatId), String(threadId), "bug-reports").catch(() => {})
  } catch (error) {
    // A private chat without Threaded Mode, or a group without Topics: messages go to the chat itself.
    console.info(`[bug-reports] no Telegram topic for ${projectName()} (${describe(error)}); posting to the chat`)
  }
  globalThis.__mezonBugTopic = { chatId, threadId, checkedAt: Date.now() }
  return threadId
}

/** Forgets a topic that no longer exists (deleted in Telegram), so the next message opens a new one. */
async function forgetThread(chatId: string): Promise<void> {
  globalThis.__mezonBugTopic = undefined
  await writeSetting(getDb(), topicKey(chatId), "", "bug-reports").catch(() => {})
}

const THREAD_GONE = /thread not found|TOPIC_DELETED|TOPIC_CLOSED|message thread/i

/** Sends into the project's topic (when there is one); a deleted topic is forgotten and the send is
 * repeated once in a new one. `build` gets the thread id (null: the chat itself). */
async function sendInThread(chatId: string, method: string, build: (threadId: number | null) => FormData | Record<string, unknown>): Promise<TelegramAnswer> {
  const threadId = await projectThreadId(chatId)
  try {
    return await callTelegram(method, build(threadId))
  } catch (error) {
    if (threadId === null || !THREAD_GONE.test(describe(error))) throw error
    await forgetThread(chatId)
    return callTelegram(method, build(await projectThreadId(chatId)))
  }
}

async function sendFile(report: TelegramReport, method: "sendPhoto" | "sendDocument", field: "photo" | "document"): Promise<number | null> {
  const config = telegramConfig()
  if (!config || !report.screenshot?.length) return null
  const type = report.screenshotType || "image/jpeg"
  const extension = type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg"
  const screenshot = report.screenshot
  const answer = await sendInThread(config.chatId, method, (threadId) => {
    const form = new FormData()
    form.set("chat_id", config.chatId)
    if (threadId) form.set("message_thread_id", String(threadId))
    form.set("caption", reportText(report, CAPTION_MAX))
    form.set("parse_mode", "HTML")
    form.set(field, new Blob([new Uint8Array(screenshot)], { type }), `bug-report-${report.id}.${extension}`)
    return form
  })
  return answer.result?.message_id ?? null
}

/**
 * Sends the report: the screenshot as a photo with the caption; a picture Telegram refuses as a photo
 * (a very long page: the sides may differ at most 20 times) as a document; without a picture, or when
 * both fail, the text alone. The message id (for the analysis' reply), or null when nothing was sent.
 */
export async function sendReportMessage(report: TelegramReport): Promise<number | null> {
  const config = telegramConfig()
  if (!config) return null
  if (report.screenshot?.length) {
    for (const [method, field] of [
      ["sendPhoto", "photo"],
      ["sendDocument", "document"],
    ] as const) {
      try {
        const id = await sendFile(report, method, field)
        if (id) return id
      } catch (error) {
        console.warn(`[bug-reports] report #${report.id}: ${method} failed:`, describe(error))
      }
    }
  }
  try {
    const answer = await sendInThread(config.chatId, "sendMessage", (threadId) => ({
      chat_id: config.chatId,
      ...(threadId ? { message_thread_id: threadId } : {}),
      text: reportText(report, MESSAGE_MAX),
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
    }))
    return answer.result?.message_id ?? null
  } catch (error) {
    console.warn(`[bug-reports] report #${report.id}: sendMessage failed:`, describe(error))
    return null
  }
}

const SEVERITY_MARK: Record<string, string> = { past: "⚪️", "o'rta": "🟡", yuqori: "🟠", kritik: "🔴" }

/** The customer's own words, as a quote (also in the reply, so the explanation reads on its own). */
function commentQuote(comment: string | undefined, max: number): string[] {
  return comment?.trim() ? ["<b>Mijoz yozgani:</b>", `<blockquote>${escapedWithin(comment.trim(), max)}</blockquote>`] : []
}

/** The analysis for the developer: what broke, the customer's words, where, why and what to do. */
export function analysisText(id: number, analysis: BugAnalysis, comment?: string): string {
  const field = (label: string, value: string, max = 450) => (value?.trim() ? [`<b>${label}:</b> ${escapedWithin(value.trim(), max)}`] : [])
  const lines = [
    projectHeader(),
    `🤖 <b>AI tahlili — xato #${id}</b>`,
    `${SEVERITY_MARK[analysis.jiddiylik] ?? "⚪️"} Jiddiylik: <b>${escapeHtml(analysis.jiddiylik)}</b> · Turi: ${escapeHtml(analysis.turi)} · Ishonch: ${escapeHtml(analysis.ishonch)}`,
    "",
    ...field("Qisqa", analysis.qisqa, 400),
    ...commentQuote(comment, 600),
    ...field("Mijoz nima demoqchi", analysis.mijoz_nima_demoqchi),
    ...field("Skrinshotda", analysis.skrinshotda_korinadi),
    ...field("Qayerda", analysis.qayerda),
    ...field("Texnik sabab", analysis.texnik_sabab),
    ...field("Yechim", analysis.yechim),
  ]
  if (analysis.ishonch === "taxmin") lines.push("", "⚠️ <i>Taxmin, tekshirib ko'ring</i>")
  lines.push("", `Admin: ${adminLinkHtml(id)}`)
  return lines.join("\n")
}

function failureText(id: number, error: string | null, comment?: string): string {
  const lines = [projectHeader(), `⚠️ <b>AI tahlil qila olmadi — xato #${id}</b>`, ...commentQuote(comment, 1500)]
  if (error) lines.push(`Xato: <code>${escapedWithin(error, 1500)}</code>`)
  lines.push(`Admin: ${adminLinkHtml(id)}`)
  return lines.join("\n")
}

/** The analysis (or "AI tahlil qila olmadi" with the error) as a reply to the report's message. Without
 * a first message (it failed) it is sent on its own. */
export async function replyWithAnalysis(
  report: Pick<TelegramReport, "id" | "telegramMessageId"> & { comment?: string },
  analysis: BugAnalysis | null,
  error: string | null,
): Promise<void> {
  const config = telegramConfig()
  if (!config) return
  const text = analysis ? analysisText(report.id, analysis, report.comment) : failureText(report.id, error, report.comment)
  try {
    await sendInThread(config.chatId, "sendMessage", (threadId) => ({
      chat_id: config.chatId,
      ...(threadId ? { message_thread_id: threadId } : {}),
      // The fields are cut one by one above; this only guards the total (no tag is ever cut through then).
      text: text.length > MESSAGE_MAX ? `${text.slice(0, MESSAGE_MAX - 1)}…` : text,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      ...(report.telegramMessageId ? { reply_parameters: { message_id: report.telegramMessageId, allow_sending_without_reply: true } } : {}),
    }))
  } catch (sendError) {
    console.warn(`[bug-reports] report #${report.id}: the analysis reply failed:`, describe(sendError))
  }
}
