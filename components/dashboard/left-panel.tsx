"use client"

import { useState } from "react"
import { SelectField } from "./select-field"
import { CARD_CLASS } from "./stat-cards"
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
    <div className={`${CARD_CLASS} flex min-h-[383px] flex-col p-[10px]`}>
      <div className="flex h-[50px] overflow-hidden rounded-t-[10px]">
        {subTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`h-[50px] flex-1 text-[14px] font-semibold text-[#888] ${tab === activeTab ? "bg-[#f2f5f8]" : "bg-white"}`}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      <div className={`${CARD_CLASS} mt-[10px] h-[127px] px-[10px] pt-[20px]`}>
        <div className="grid grid-cols-2 gap-5">
          <SelectField label={t("Месяц")} options={MONTHS_NOMINATIVE} value={month} onChange={onMonthChange} />
          <SelectField label={t("Год")} options={YEARS} value={year} onChange={onYearChange} />
        </div>
        <div className="mt-[20px] flex items-center justify-end gap-[10px]">
          <span className="text-[13px] font-semibold">{t("данные за")}</span>
          <button
            type="button"
            onClick={handleRecalc}
            disabled={recalculating}
            className="flex h-[30px] items-center rounded-[5px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white disabled:opacity-70"
          >
            <svg viewBox="0 0 24 24" className={`mb-1 h-[18px] w-[18px] fill-white ${recalculating ? "animate-spin" : ""}`} aria-hidden>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="pl-2 pr-4">{t("Перерасчет")}</span>
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center pb-6 pt-5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/robot-empty.png" alt={t("Робот-помощник")} className="w-[120px]" />
        <p className="-mt-[22px] text-center text-[13px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
      </div>
    </div>
  )
}
