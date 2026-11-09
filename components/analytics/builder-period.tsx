"use client"

import { useState } from "react"

import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { builderRangeLabel } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

/**
 * The period of the report builders ("01 Нояб. 2026 - 30 Нояб. 2026"): a click opens the reference's 850 px picker
 * (six presets, two months). The label follows every pick while the picker is open; ✓ applies the period,
 * ✕ or a click outside puts the applied one back. `align`: the picker's edge under the field (the new
 * Конструктор opens it to the left of its right edge, Конструктор отчетов to the right of its left edge);
 * `textClassName`: the label's size (12 px in the new Конструктор, 13 px in Конструктор отчетов).
 */
export function BuilderPeriod({
  from,
  to,
  onApply,
  align = "right",
  textClassName = "text-[12px]",
  className = "",
}: {
  from: string
  to: string
  onApply: (from: string, to: string) => void
  align?: "left" | "right"
  textClassName?: string
  className?: string
}) {
  const { t, language } = useLanguage()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null)
  const shown = open && draft ? draft : { from, to }

  const close = () => {
    setOpen(false)
    setDraft(null)
  }

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        aria-label={t("Период")}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-[45px] w-full items-center whitespace-nowrap font-bold text-[#1E4A9A] ${textClassName} ${align === "right" ? "justify-end" : "justify-start pl-[11px]"}`}
      >
        {builderRangeLabel(shown.from, shown.to, language)}
      </button>
      {open && (
        <DateRangePicker
          variant="builder"
          begin={from}
          end={to}
          onChange={(begin, end) => setDraft({ from: begin, to: end })}
          onApply={(begin, end) => {
            close()
            onApply(begin, end)
          }}
          onClose={close}
          positionClassName={align === "right" ? "right-0 top-full" : "left-0 top-full"}
        />
      )}
    </div>
  )
}

/** The first and the last day of the current month ("YYYY-MM-DD"), the builders' default period. */
export function currentMonthPeriod(now = new Date()): { from: string; to: string } {
  const pad = (value: number) => String(value).padStart(2, "0")
  const year = now.getFullYear()
  const month = now.getMonth() + 1
  const last = new Date(year, month, 0).getDate()
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` }
}

/** A "YYYY-MM-DD" URL value, or null. */
export function isoParam(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime()) ? value : null
}
