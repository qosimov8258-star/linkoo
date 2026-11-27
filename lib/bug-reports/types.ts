// «Xato haqida xabar berish» (bug reports) — the types and limits shared by the browser side (the AI assistant
// button of the top navigation, its chat/report panel, the context tracker), the API routes and the admin pages.
// Client-safe: no server imports here.
//
// API (all JSON unless noted):
//   POST /api/bug-reports                      multipart: comment, pageUrl, context (JSON string), screenshot (File, optional)
//                                              → 201 { id, helper: BugHelperResult | null, delivered }
//   POST /api/bug-reports/[id]/feedback        { helped: boolean } → { ok: true }  (own report, while it awaits feedback;
//                                              helped=false also when the panel is closed without an answer)
//   POST /api/bug-reports/[id]/clarify         { answer } → { ok: true }  (own report, while it awaits the one answer)
//   GET  /api/admin/bug-reports                ?status=&severity=&resolvedByAi=1&page=&pageSize= → { rows: BugReportListItem[], total }
//   GET  /api/admin/bug-reports/[id]           → BugReportDetail
//   PATCH /api/admin/bug-reports/[id]          { status } → BugReportDetail
//   POST /api/admin/bug-reports/[id]/reanalyze → { ok: true }
//   GET  /api/admin/bug-reports/[id]/screenshot → the stored image bytes
// The admin routes and pages are for the admin role only.

export const BUG_COMMENT_MIN = 5
export const BUG_COMMENT_MAX = 4000
/** The stored screenshot (the browser sends a JPEG of at most 1600 px width, about 1 MB). */
export const BUG_SCREENSHOT_MAX_BYTES = 1_500_000
/** The browser's context JSON. The tracker sends about 20 000 characters at most (3 lists of 10 entries of ≤ 500
 * characters, the browser and the screen); the rest is room for long page and request addresses. */
export const BUG_CONTEXT_MAX_CHARS = 64_000
/** One user may send at most this many reports per minute. */
export const BUG_REPORTS_PER_MINUTE = 3

export const BUG_AI_STATUSES = ["PENDING", "DONE", "FAILED"] as const
export type BugAiStatus = (typeof BUG_AI_STATUSES)[number]

export const BUG_REPORT_STATUSES = ["NEW", "IN_PROGRESS", "FIXED", "REJECTED"] as const
export type BugReportStatus = (typeof BUG_REPORT_STATUSES)[number]

export const BUG_TYPES = ["bug", "dizayn", "tushunmovchilik", "taklif"] as const
export const BUG_SEVERITIES = ["past", "o'rta", "yuqori", "kritik"] as const
export type BugSeverity = (typeof BUG_SEVERITIES)[number]
export const BUG_CONFIDENCES = ["aniq", "taxmin"] as const

/** The vision model's analysis (the JSON of the analysis system prompt). */
export type BugAnalysis = {
  qisqa: string
  skrinshotda_korinadi: string
  mijoz_nima_demoqchi: string
  qayerda: string
  texnik_sabab: string
  yechim: string
  turi: (typeof BUG_TYPES)[number]
  jiddiylik: BugSeverity
  ishonch: (typeof BUG_CONFIDENCES)[number]
  dalillar: string[]
}

export const BUG_HELPER_STATES = ["yordam", "aniqlashtirish", "xato"] as const
/** The text model's answer to the customer before the report goes to the developer. */
export type BugHelperResult = {
  holat: (typeof BUG_HELPER_STATES)[number]
  mijozga_javob: string
  savol: string
}

/** Where a report stands on its way to the developer. A report is always saved first; it is "delivered" (Telegram +
 * the screenshot analysis) at once, unless the helper is waiting for the customer's feedback or one answer. */
export const BUG_DELIVERY_STATES = ["awaiting_feedback", "awaiting_answer", "delivered", "resolved_by_ai"] as const
export type BugDeliveryState = (typeof BUG_DELIVERY_STATES)[number]

/** What the browser collects on its own (lib/bug-reports/tracker.ts). */
export type BugClientContext = {
  pageUrl: string
  time: string
  userAgent: string
  browser: string
  os: string
  language: string
  screen: { width: number; height: number; pixelRatio: number }
  viewport: { width: number; height: number }
  /** The last 10 console.error / window.onerror / unhandledrejection messages. */
  consoleErrors: Array<{ time: string; message: string }>
  /** The last 10 API requests that answered 4xx/5xx (or failed): the first 500 characters of the body. */
  failedRequests: Array<{ time: string; method: string; url: string; status: number; body: string }>
  /** The last 10 clicks on buttons and links. */
  actions: Array<{ time: string; kind: string; label: string; target: string }>
}

/** The stored context: the browser's part (masked) plus what the server adds. */
export type BugStoredContext = BugClientContext & {
  server: { userId: number; username: string; role: string; receivedAt: string; backendErrors: unknown[] }
}

export type BugReportListItem = {
  id: number
  createdAt: string
  userId: number
  userName: string
  pageUrl: string
  status: BugReportStatus
  aiStatus: BugAiStatus
  delivery: BugDeliveryState
  resolvedByAi: boolean
  /** The analysis' «qisqa» and «jiddiylik», when there is one. */
  short: string | null
  severity: BugSeverity | null
  confidence: (typeof BUG_CONFIDENCES)[number] | null
}

export type BugReportDetail = BugReportListItem & {
  comment: string
  screenshotUrl: string | null
  context: BugStoredContext | Record<string, unknown>
  aiAnalysis: BugAnalysis | null
  aiError: string | null
  helperResult: BugHelperResult | null
  updatedAt: string
}
