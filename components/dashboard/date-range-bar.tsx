"use client"

import { useEffect, useState } from "react"
import { SlidersHorizontal, User } from "lucide-react"
import type { PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import { WidgetsPanel } from "./widgets-panel"

const rangeButtons: PeriodKey[] = ["СЕГОДНЯ", "ВЧЕРА", "ПОСЛ. 7", "МЕСЯЦ", "СВОЯ"]

export function DateRangeBar({
  period,
  onPeriodChange,
  label,
  selectedWidgets,
  onWidgetsChange,
}: {
  period: PeriodKey
  onPeriodChange: (period: PeriodKey) => void
  label: string
  selectedWidgets: string[]
  onWidgetsChange: (keys: string[]) => void
}) {
  const { t } = useLanguage()
  const [displayName, setDisplayName] = useState("admin")
  const [widgetsOpen, setWidgetsOpen] = useState(false)

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
    <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-2.5 rounded-[2px] bg-white px-[30px] py-5 shadow-sm">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] items-center justify-center overflow-hidden rounded-full bg-slate-100">
          <User className="h-[18px] w-[18px] text-slate-400" />
        </span>
        <div className="flex items-center gap-[5px]">
          <span className="text-base font-semibold text-[#333333]">{displayName}</span>
          <span className="text-xs font-semibold text-[#999999]">{t("Сервер: (https://time3.linko.uz)")}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <span className="mr-[5px] text-[13px] font-bold text-[#4f71dc]">{label}</span>
        <div className="flex items-center">
          {rangeButtons.map((btn) => (
            <button
              key={btn}
              onClick={() => onPeriodChange(btn)}
              className={`h-8 rounded-[5px] px-4 text-[13px] font-normal transition-colors ${
                btn === period
                  ? "bg-[#4f71dc] text-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"
                  : "bg-white text-black shadow-[inset_0_0_2px_rgba(0,0,0,0.12)] hover:bg-slate-50"
              }`}
            >
              {t(btn)}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setWidgetsOpen((open) => !open)}
            aria-expanded={widgetsOpen}
            className="flex h-9 items-center gap-2 rounded-[5px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white transition-colors hover:brightness-95"
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" />
            {t("Виджеты")}
          </button>
          {widgetsOpen && (
            <WidgetsPanel
              selected={selectedWidgets}
              onClose={() => setWidgetsOpen(false)}
              onSave={(keys) => {
                onWidgetsChange(keys)
                setWidgetsOpen(false)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
