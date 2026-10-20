"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import type { PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import { WidgetsPanel } from "./widgets-panel"
import { DateRangePicker } from "./date-range-picker"

const rangeButtons: PeriodKey[] = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"]

export function DateRangeBar({
  period,
  onPeriodChange,
  label,
  selectedWidgets,
  onWidgetsChange,
  begin,
  end,
  onCustomRange,
}: {
  period: PeriodKey
  onPeriodChange: (period: PeriodKey) => void
  label: string
  selectedWidgets: string[]
  onWidgetsChange: (keys: string[]) => void
  begin: string
  end: string
  onCustomRange: (begin: string, end: string) => void
}) {
  const { t } = useLanguage()
  // The signed-in user's name (filled from /api/auth/me), never a placeholder person.
  const [displayName, setDisplayName] = useState("")
  // This server's address (after mount), never another company's server.
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])
  const searchParams = useSearchParams()
  const [widgetsOpen, setWidgetsOpen] = useState(searchParams.get("widgets") === "1")
  const [pickerOpen, setPickerOpen] = useState(false)

  // the Analytics menu's "Виджеты" entry links to /?widgets=1
  useEffect(() => {
    if (searchParams.get("widgets") === "1") setWidgetsOpen(true)
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { displayName?: string } | null) => {
        if (!cancelled && data?.displayName) setDisplayName(data.displayName)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex h-[75px] items-center justify-between rounded-[2px] bg-white px-[30px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
      <div className="flex items-center">
        <span className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full bg-[#5d6474]/80">
          <svg viewBox="0 0 24 24" className="mt-[6px] h-6 w-6 fill-white/80" aria-hidden>
            <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
          </svg>
        </span>
        <h4 className="mx-[10px] text-[16px] font-semibold leading-5 text-[#333]">{displayName}</h4>
        {origin && <span className="-ml-[5px] text-[12px] font-semibold text-[#999]">{t("Сервер")}: ({origin})</span>}
      </div>

      <div className="flex items-center gap-[10px]">
        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setPickerOpen((open) => !open)
            }}
            className="w-[200px] text-right text-[13px] font-bold text-[#4f71dc]"
          >
            {t(label)}
          </button>
          {pickerOpen && (
            <DateRangePicker
              begin={begin}
              end={end}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                onCustomRange(from, to)
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <div className="mr-[10px] flex items-center">
          {rangeButtons.map((btn) => (
            <button
              key={btn}
              type="button"
              onClick={() => onPeriodChange(btn)}
              className={`h-8 min-w-[70px] rounded-[5px] px-4 text-[13px] font-normal uppercase ${
                btn === period
                  ? "bg-[#4f71dc] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
                  : "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"
              }`}
            >
              {t(btn)}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setWidgetsOpen(true)}
          aria-expanded={widgetsOpen}
          className="flex h-9 items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white hover:brightness-95"
        >
          <svg viewBox="0 0 24 24" className="mb-1 h-[18px] w-[18px] fill-white" aria-hidden>
            <path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z" />
          </svg>
          <span className="pl-2 pr-4">{t("Виджеты")}</span>
        </button>
      </div>

      <WidgetsPanel
        open={widgetsOpen}
        selected={selectedWidgets}
        onClose={() => setWidgetsOpen(false)}
        onSave={(keys) => {
          onWidgetsChange(keys)
          setWidgetsOpen(false)
        }}
      />
    </div>
  )
}
