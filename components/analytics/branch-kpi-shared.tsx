"use client"

import { useState, type ReactNode } from "react"

import { BRANCH_KPI_MONTHS } from "@/lib/branch-kpi-types"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared bits of "KPI план филиалов": fetch helpers, the demo number/date
// formatters (modules 16 and 59), the inline Месяц / Год filter (module 4220)
// and the dialog frame used by the page's dialogs.

export const BRANCH_KPI_API = "/api/branch-kpi-plans"

/** Demo flatButtonStyle2 colours. */
export const KPI_COLORS = { blue: "#4f71dc", green: "#71ce87", disabled: "#cfcfcf" } as const

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

export function sendJson<T>(url: string, method: "POST" | "PUT", payload: unknown): Promise<T> {
  return fetchJson<T>(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
}

/** Demo numberFormat (module 16): ru-RU grouping, ≤ `digits` decimals, 0 → "0", optional suffix. */
export function kpiNumber(value: number | null | undefined, suffix?: string, digits = 3): string {
  const number = Number(value ?? 0)
  const text = number && Number.isFinite(number) ? new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(number) : "0"
  return suffix ? `${text} ${suffix}` : text
}

const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."]
const EN_SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** Demo dateFormat (module 59) "DD MMM YYYY, HH:mm" of a local "YYYY-MM-DDTHH:mm:ss" (uz → ru months, like the demo). */
export function formatKpiDate(value: string | null | undefined, language: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value ?? "")
  if (!match) return value ?? ""
  const months = language === "en" ? EN_SHORT_MONTHS : RU_SHORT_MONTHS
  return `${match[3]} ${months[Number(match[2]) - 1] ?? match[2]} ${match[1]}, ${match[4] ?? "00"}:${match[5] ?? "00"}`
}

export function useMonthName() {
  const { t } = useLanguage()
  return (month: number) => t(BRANCH_KPI_MONTHS[month - 1] ?? "")
}

/** Demo module 4220: "Месяц" select (with clear) + "Год" text field. */
export function KpiMonthYearFilter({
  month,
  year,
  onChange,
  className = "",
  monthWidth = 192,
  yearWidth = 120,
  gap = 8,
  dialog = false,
}: {
  month: number
  year: number
  onChange: (next: { month: number; year: number }) => void
  className?: string
  monthWidth?: number
  yearWidth?: number
  gap?: number
  /** The reference's full-screen "Изменить планы" step lays the two fields out a little differently. */
  dialog?: boolean
}) {
  const { t } = useLanguage()
  const now = new Date()
  return (
    <div className={`flex ${dialog ? "h-[54px]" : "h-[50px]"} items-start ${className}`} style={{ gap }}>
      <label className={`relative block ${dialog ? "h-[52px] border-[#e8e8e8]" : "h-[50px] border-[#e0e0e0]"} border-b focus-within:border-[#4f71dc]`} style={{ width: monthWidth }}>
        <span className={dialog ? "absolute left-0 top-[2.5px] origin-top-left scale-75 text-[13px] font-semibold leading-[16.3px] text-black" : "absolute left-0 top-[2.8px] origin-top-left scale-75 text-[13px] font-semibold leading-[16.3px] text-black"}>{t("Месяц")}</span>
        <span className="absolute left-0 top-[28.5px] text-[13px] font-semibold leading-[18px] text-[#333]">{t(BRANCH_KPI_MONTHS[month - 1] ?? "")}</span>
        <select value={month} onChange={(event) => onChange({ month: Number(event.target.value), year })} aria-label={t("Месяц")} className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
          {BRANCH_KPI_MONTHS.map((name, index) => (
            <option key={name} value={index + 1}>
              {t(name)}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label={t("Очистить")}
          title="Clear value"
          data-native-tip=""
          onClick={() => onChange({ month: now.getMonth() + 1, year })}
          className={`absolute top-[29.4px] z-10 text-[18px] leading-[18px] text-[#999] hover:text-[#666] left-[161.3px]`}
        >
          ×
        </button>
        {dialog ? (
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-[173px] top-[27px] h-6 w-6 fill-[#999]"><path d="M7 10l5 5 5-5z" /></svg>
        ) : (
          <svg viewBox="0 0 10 7" className="pointer-events-none absolute right-[8px] top-[33px] h-[7px] w-[10px] fill-[#888]"><path d="M0 0l5 5.5L10 0z" /></svg>
        )}
      </label>
      <KpiYearField key={year} year={year} label={t("Год")} width={yearWidth} dialog={dialog} onApply={(value) => onChange({ month, year: value })} />
    </div>
  )
}

/** "Год" text field: applies a complete 4-digit year (2000…2100); remounted (key) when the year changes outside. */
function KpiYearField({ year, label, onApply, width = 120, dialog = false }: { year: number; label: string; onApply: (year: number) => void; width?: number; dialog?: boolean }) {
  const [draft, setDraft] = useState(String(year))
  return (
    <label className={`relative block ${dialog ? "h-[54px]" : "h-[50px]"} border-b border-[#e0e0e0] focus-within:border-[#4f71dc]`} style={{ width }}>
      <span className={dialog ? "absolute left-0 top-[9px] origin-top-left scale-75 text-[13px] font-semibold leading-[16.3px] text-black" : "absolute left-0 top-[9.5px] origin-top-left scale-75 text-[13px] font-semibold leading-[16.3px] text-black"}>{label}</span>
      <input
        value={draft}
        inputMode="numeric"
        maxLength={4}
        onChange={(event) => {
          const text = event.target.value.replace(/\D/g, "")
          setDraft(text)
          const value = Number(text)
          if (text.length === 4 && value >= 2000 && value <= 2100 && value !== year) onApply(value)
        }}
        onBlur={() => {
          if (draft.length !== 4) setDraft(String(year))
        }}
        className="absolute inset-x-0 top-[25px] h-[30px] w-full bg-transparent text-[13px] font-semibold text-[#333] outline-none"
      />
    </label>
  )
}

/** Demo dialog: white, 60px uppercase bold title row, close X; footer with right-aligned actions. */
export function KpiDialogFrame({
  title,
  width,
  onClose,
  children,
  footer,
  titleActions,
  fullScreen = false,
  footerInset = 0,
  footerPadRight = 10,
}: {
  title: ReactNode
  width?: number | string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Replaces the close X (full-screen step of "Изменить планы"). */
  titleActions?: ReactNode
  fullScreen?: boolean
  /** Side margin of the footer's top line (the reference's "Дублировать" dialog insets it). */
  footerInset?: number
  /** Right padding of the footer actions. */
  footerPadRight?: number
}) {
  const { t } = useLanguage()
  // The reference dialogs close only by their X / actions: neither Escape nor a click on the backdrop dismisses them.
  const frame = (
    <div
      role="dialog"
      aria-modal="true"
      className={fullScreen ? "flex h-full w-full flex-col bg-white" : "w-full rounded bg-white shadow-[0_11px_15px_-7px_rgba(0,0,0,0.2),0_24px_38px_3px_rgba(0,0,0,0.14),0_9px_46px_8px_rgba(0,0,0,0.12)]"}
      style={fullScreen ? undefined : { maxWidth: width ?? 450 }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className={`flex min-h-[60px] shrink-0 items-center justify-between gap-4 border-b border-[#efefef] pl-[30px] ${titleActions ? "pr-[10px]" : "pr-[15px]"}`}>
        <h2 className="flex min-w-0 items-center gap-2 py-2 text-[13px] font-bold uppercase leading-snug text-[#333]">{title}</h2>
        {titleActions ?? (
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-[#666]">
            <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
          </button>
        )}
      </div>
      {children}
      {footer && <div className="flex shrink-0 justify-end border-t border-[#efefef] py-[10px]" style={{ marginLeft: footerInset, marginRight: footerInset, paddingRight: footerPadRight, paddingLeft: 10 }}>{footer}</div>}
    </div>
  )
  if (fullScreen) return <div className="fixed inset-0 z-[110] bg-white">{frame}</div>
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/[0.54] px-4 pb-10 pt-16">
      {frame}
    </div>
  )
}

/** Demo dialog footer action ("Сохранить", "Далее"): blue-ish text button. */
export function KpiDialogAction({ label, onClick, disabled = false, type = "button" }: { label: string; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="rounded px-4 pb-[7px] pt-[9px] text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-40">
      {label}
    </button>
  )
}
