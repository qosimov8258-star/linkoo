"use client"

import { useEffect, useState, type ReactNode } from "react"
import { X } from "lucide-react"

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

const RU_SHORT_MONTHS = ["янв.", "февр.", "мар.", "апр.", "мая", "июн.", "июл.", "авг.", "сент.", "окт.", "нояб.", "дек."]
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
}: {
  month: number
  year: number
  onChange: (next: { month: number; year: number }) => void
  className?: string
}) {
  const { t } = useLanguage()
  const now = new Date()
  return (
    <div className={`flex items-end gap-4 ${className}`}>
      <label className="block w-[170px] text-[12px] text-[#999]">
        {t("Месяц")}
        <span className="mt-0.5 flex items-center border-b border-[#e0e0e0] focus-within:border-[#4f71dc]">
          <select
            value={month}
            onChange={(event) => onChange({ month: Number(event.target.value), year })}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13px] text-[#333] outline-none"
          >
            {BRANCH_KPI_MONTHS.map((name, index) => (
              <option key={name} value={index + 1}>
                {t(name)}
              </option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("Очистить")}
            title={t("Очистить")}
            onClick={() => onChange({ month: now.getMonth() + 1, year })}
            className="p-1 text-[#999] hover:text-[#666]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      </label>
      <KpiYearField key={year} year={year} label={t("Год")} onApply={(value) => onChange({ month, year: value })} />
    </div>
  )
}

/** "Год" text field: applies a complete 4-digit year (2000…2100); remounted (key) when the year changes outside. */
function KpiYearField({ year, label, onApply }: { year: number; label: string; onApply: (year: number) => void }) {
  const [draft, setDraft] = useState(String(year))
  return (
    <label className="block w-[110px] text-[12px] text-[#999]">
      {label}
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
        className="mt-0.5 block h-8 w-full border-b border-[#e0e0e0] bg-transparent text-[13px] text-[#333] outline-none focus:border-[#4f71dc]"
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
}: {
  title: ReactNode
  width?: number | string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Replaces the close X (full-screen step of "Изменить планы"). */
  titleActions?: ReactNode
  fullScreen?: boolean
}) {
  const { t } = useLanguage()
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])
  const frame = (
    <div
      role="dialog"
      aria-modal="true"
      className={fullScreen ? "flex h-full w-full flex-col bg-white" : "w-full rounded bg-white shadow-xl"}
      style={fullScreen ? undefined : { maxWidth: width ?? 450 }}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex min-h-[60px] shrink-0 items-center justify-between gap-4 border-b border-[#efefef] pl-[30px] pr-[10px]">
        <h2 className="flex min-w-0 items-center gap-2 py-2 text-[14px] font-bold uppercase leading-snug text-[#333]">{title}</h2>
        {titleActions ?? (
          <button type="button" onClick={onClose} aria-label={t("Закрыть")} className="flex h-[38px] w-[38px] shrink-0 items-center justify-center text-[#666]">
            <X className="h-6 w-6" />
          </button>
        )}
      </div>
      {children}
      {footer && <div className="flex shrink-0 justify-end border-t border-[#efefef] p-[10px]">{footer}</div>}
    </div>
  )
  if (fullScreen) return <div className="fixed inset-0 z-[110] bg-white">{frame}</div>
  return (
    <div className="fixed inset-0 z-[110] flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10" onClick={onClose}>
      {frame}
    </div>
  )
}

/** Demo dialog footer action ("Сохранить", "Далее"): blue-ish text button. */
export function KpiDialogAction({ label, onClick, disabled = false, type = "button" }: { label: string; onClick?: () => void; disabled?: boolean; type?: "button" | "submit" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled} className="rounded px-4 py-2 text-[13px] font-semibold uppercase text-[#129fdd] hover:bg-[#f2f5f8] disabled:opacity-40">
      {label}
    </button>
  )
}
