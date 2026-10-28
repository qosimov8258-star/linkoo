"use client"

import { useMemo, useState, type ReactNode } from "react"
import { endOfMonth, formatRangeLabel, rangeForPeriod, startOfMonth, toISODate, type PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared pieces of the dashboard widget tabs (Баланс / Филиал): the reference's
// period state, "Показать еще" pill, sort arrows and signed amount colouring.

/** Period buttons of a widget tab → ISO range + the label of the user card. */
export function useWidgetPeriod(initial: PeriodKey = "МЕСЯЦ") {
  const [period, setPeriod] = useState<PeriodKey>(initial)
  const today = useMemo(() => new Date(), [])
  const { begin, end } = useMemo(() => rangeForPeriod(period, today, { begin: startOfMonth(today), end: endOfMonth(today) }), [period, today])
  return { period, setPeriod, beginIso: toISODate(begin), endIso: toISODate(end), label: formatRangeLabel(begin, end) }
}

/** Amount with the reference's thousands separator (nbsp) and up to 3 decimals. */
export function formatAmount(value: number) {
  const rounded = Math.round(value * 1000) / 1000
  return new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(rounded).replace(/[   ]/g, " ")
}

/** Green for a positive, red for a negative, plain for zero (table cells). */
export function signedColor(value: number) {
  if (value > 0) return "text-[#8acb8d]"
  if (value < 0) return "text-[#e57373]"
  return "text-[#333]"
}

export function SortArrows() {
  return (
    <svg viewBox="0 0 10 14" className="ml-[8px] inline h-[10px] w-[7px] fill-[#8a94a6]" aria-hidden>
      <path d="M5 0l4 5H1zM5 14L1 9h8z" />
    </svg>
  )
}

/** The rounded "Показать еще ⌄" strip under the widget tables. */
export function MoreButton({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { t } = useLanguage()
  return (
    <button
      type="button"
      onClick={onToggle}
      className="mx-[17.5px] my-[5px] flex h-[30px] w-[calc(100%-35px)] items-center justify-center gap-[6px] rounded-[100px] bg-[#f0f4f8] text-[13px] text-[#5869f0]"
    >
      {expanded ? t("Скрыть") : t("Показать еще")}
      <svg viewBox="0 0 24 24" className={`h-4 w-4 fill-[#5869f0] ${expanded ? "rotate-180" : ""}`} aria-hidden>
        <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6z" />
      </svg>
    </button>
  )
}

/** Segmented 32px buttons of the widget tabs (blue / green active tone). */
export function ToggleButtons<T extends string>({ options, value, onChange, tone, className = "" }: { options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (value: T) => void; tone: "blue" | "green"; className?: string }) {
  const active = tone === "blue" ? "bg-[#4f71dc] text-white" : "bg-[#2bcd53] text-white"
  return (
    <div className={`flex ${className}`}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`h-[32px] rounded-[5px] px-[16px] text-[13px] font-normal uppercase shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${value === option.value ? active : "bg-white text-black"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
