"use client"

import { useState } from "react"
import Image from "next/image"
import { RefreshCw } from "lucide-react"
import { SelectField } from "./select-field"
import { MONTHS_NOMINATIVE } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

const subTabs = ["Сегодня", "За месяц", "Своя"]
const YEARS = ["2023", "2024", "2025", "2026", "2027"]

export function LeftPanel({
  month,
  year,
  onMonthChange,
  onYearChange,
}: {
  month: string
  year: string
  onMonthChange: (month: string) => void
  onYearChange: (year: string) => void
}) {
  const { t } = useLanguage()
  const [activeTab, setActiveTab] = useState("Своя")
  const [recalculating, setRecalculating] = useState(false)

  function handleRecalc() {
    setRecalculating(true)
    setTimeout(() => setRecalculating(false), 1200)
  }

  return (
    <div className="flex flex-col rounded-lg bg-white p-5 shadow-sm">
      {/* Sub tabs */}
      <div className="grid grid-cols-3 border-b border-slate-200 text-center">
        {subTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-base transition-colors ${
              tab === activeTab
                ? "border-b-2 border-brand-blue font-semibold text-slate-700"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      {/* Month / Year selects */}
      <div className="mt-6 grid grid-cols-2 gap-4">
        <SelectField label={t("Месяц")} options={MONTHS_NOMINATIVE} value={month} onChange={onMonthChange} />
        <SelectField label={t("Год")} options={YEARS} value={year} onChange={onYearChange} />
      </div>

      {/* Recalc row */}
      <div className="mt-6 flex items-center justify-end gap-3">
        <span className="text-base text-slate-600">{t("данные за")}</span>
        <button
          onClick={handleRecalc}
          disabled={recalculating}
          className="flex items-center gap-2 rounded-full bg-brand-blue px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:brightness-95 disabled:opacity-70"
        >
          <RefreshCw className={`h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
          {t("Перерасчет")}
        </button>
      </div>

      {/* Robot empty state */}
      <div className="flex flex-1 flex-col items-center justify-center gap-4 py-8">
        <Image
          src="/robot-mascot.png"
          alt={t("Робот-помощник")}
          width={130}
          height={130}
          priority
          className="h-32 w-32 object-contain"
        />
        <p className="text-center text-base text-link">{t("По вашему запросу ничего не найдено")}</p>
      </div>
    </div>
  )
}
