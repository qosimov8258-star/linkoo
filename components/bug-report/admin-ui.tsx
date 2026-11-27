"use client"

import type { ReactNode } from "react"

import type { BugAiStatus, BugDeliveryState, BugReportStatus, BugSeverity } from "@/lib/bug-reports/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Pieces shared by the admin list and detail of «Xato xabarlari» (bug reports).

/** Russian labels of the report statuses (translated through t()). */
export const STATUS_LABELS: Record<BugReportStatus, string> = {
  NEW: "Новый",
  IN_PROGRESS: "В работе",
  FIXED: "Исправлен",
  REJECTED: "Отклонён",
}

const STATUS_COLORS: Record<BugReportStatus, string> = {
  NEW: "bg-[#e8efff] text-[#1E4A9A]",
  IN_PROGRESS: "bg-[#fff4e0] text-[#a35a00]",
  FIXED: "bg-[#e3f6e8] text-[#1f7a3a]",
  REJECTED: "bg-[#eeeeee] text-[#666]",
}

export const DELIVERY_LABELS: Record<BugDeliveryState, string> = {
  awaiting_feedback: "Ждёт отзыва клиента",
  awaiting_answer: "Ждёт ответа клиента",
  delivered: "Передано разработчику",
  resolved_by_ai: "Решено ИИ",
}

// The severities come from the AI in Uzbek and are shown as they are; only the colour says how bad it is.
const SEVERITY_COLORS: Record<BugSeverity, string> = {
  past: "bg-[#eeeeee] text-[#555]",
  "o'rta": "bg-[#e3ecfb] text-[#1E4A9A]",
  yuqori: "bg-[#ffe9d6] text-[#b65300]",
  kritik: "bg-[#fde2e2] text-[#c62828]",
}

export function SeverityBadge({ value }: { value: BugSeverity | null | undefined }) {
  if (!value) return <span className="text-[#999]">—</span>
  const color = SEVERITY_COLORS[value] ?? "bg-[#eeeeee] text-[#555]"
  return (
    <span data-no-translate className={`inline-block whitespace-nowrap rounded-[10px] px-[8px] py-[2px] text-[12px] font-semibold leading-[16px] ${color}`}>
      {value}
    </span>
  )
}

export function StatusBadge({ value }: { value: BugReportStatus }) {
  const { t } = useLanguage()
  return (
    <span className={`inline-block whitespace-nowrap rounded-[10px] px-[8px] py-[2px] text-[12px] font-semibold leading-[16px] ${STATUS_COLORS[value] ?? "bg-[#eeeeee] text-[#555]"}`}>
      {t(STATUS_LABELS[value] ?? value)}
    </span>
  )
}

/** «AI hal qildi»: the helper's answer was enough and the customer said so (no developer, no analysis). */
export function ResolvedByAiBadge() {
  const { t } = useLanguage()
  return <span className="inline-block whitespace-nowrap rounded-[10px] bg-[#e3f6e8] px-[8px] py-[2px] text-[12px] font-semibold leading-[16px] text-[#1f7a3a]">{t("Решено ИИ")}</span>
}

const pad = (value: number) => String(value).padStart(2, "0")

/** dd.mm.yyyy hh:mm in the browser's time zone; the raw text when it is not a date. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** hh:mm:ss of a context entry (they all happen within minutes of the report). */
export function formatClock(value: string | null | undefined): string {
  if (!value) return ""
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** The page of a report as an address of this app (only then, else null). A report stores a path ("/clients?…",
 * lib/bug-reports/mask.ts maskPageUrl), so it is resolved against this app's origin; an older or forged report
 * may still hold a full address of another site, which resolves to that site and is not this app's page. */
function sameOriginPageUrl(value: string): URL | null {
  if (!value || typeof window === "undefined") return null
  try {
    const url = new URL(value, window.location.origin)
    return url.origin === window.location.origin ? url : null
  } catch {
    return null
  }
}

/** The page's path and query for the list. Anything that is not a page of this app is shown as it is, host
 * included, so another site's address never passes for an internal path. */
export function shortPageUrl(value: string): string {
  const url = sameOriginPageUrl(value)
  return url ? `${url.pathname}${url.search}${url.hash}` || value : value
}

/** The link of the «Страница» line: the page's full address, only for a page of this app (a link to another
 * site from a report would open whatever the reporter typed). */
export function safeHttpUrl(value: string): string | null {
  return sameOriginPageUrl(value)?.toString() ?? null
}

/** The short line of the list's «Анализ ИИ» column. */
export function AiSummary({ short, aiStatus, delivery, resolvedByAi }: { short: string | null; aiStatus: BugAiStatus; delivery: BugDeliveryState; resolvedByAi: boolean }) {
  const { t } = useLanguage()
  if (resolvedByAi) {
    return (
      <span className="flex flex-wrap items-center gap-[6px]">
        <ResolvedByAiBadge />
        {short ? <span data-no-translate className="line-clamp-2 break-words">{short}</span> : null}
      </span>
    )
  }
  if (aiStatus === "FAILED") return <span className="text-[#999]">{t("ИИ не смог проанализировать")}</span>
  if (aiStatus === "PENDING") {
    return <span className="italic text-[#999]">{delivery === "delivered" ? t("Анализ…") : t(DELIVERY_LABELS[delivery] ?? "Анализ…")}</span>
  }
  return short ? <span data-no-translate className="line-clamp-2 break-words">{short}</span> : <span className="text-[#999]">—</span>
}

/** The white card of the detail page with its grey heading. */
export function AdminCard({ title, children, aside, className = "" }: { title: ReactNode; children: ReactNode; aside?: ReactNode; className?: string }) {
  const { t } = useLanguage()
  return (
    <section className={`min-w-0 bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${className}`}>
      <div className="flex min-h-[46px] items-center justify-between gap-3 bg-[#5d6474] px-5 py-2 text-[14px] font-semibold text-white">
        <h2>{typeof title === "string" ? t(title) : title}</h2>
        {aside}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

/** The error text of an API answer ({ error } in Russian), or the fallback. */
export async function apiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown }
    return typeof body.error === "string" && body.error ? body.error : fallback
  } catch {
    return fallback
  }
}
