"use client"

import { useEffect, useState } from "react"
import { useCanManage } from "@/components/analytics/cash-management-shared"
import { SelectField } from "./select-field"
import { CARD_CLASS } from "./stat-cards"
import { MONTHS_NOMINATIVE } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"
import { notify } from "@/lib/notify"

const subTabs = ["Сегодня", "За месяц", "Своя"]
const TAB_PERIOD: Record<string, string> = { "Сегодня": "today", "За месяц": "month", "Своя": "ownDate" }
const YEARS = Array.from({ length: 11 }, (_, index) => String(2016 + index))
const RECALC_PERMISSION = ["settings.manage"] as const

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
  const [loading, setLoading] = useState(false)
  /** "Перерасчет" changes Посещаемость: settings.manage on the server (POST /api/work-attendance/recalc), hidden otherwise. */
  const canRecalc = useCanManage(RECALC_PERMISSION)

  // the reference app loads the picked tab and mirrors it in the address bar as ?period=
  function selectTab(tab: string) {
    setActiveTab(tab)
    setLoading(true)
    const params = new URLSearchParams(window.location.search)
    params.set("period", TAB_PERIOD[tab])
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
  }

  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => setLoading(false), 700)
    return () => clearTimeout(timer)
  }, [loading])

  const ownTab = activeTab === "Своя"

  // "Перерасчет": rebuilds the picked month of Посещаемость (the same POST /api/work-attendance/recalc as that page;
  // month 1..12), then the attendance tiles reload.
  async function handleRecalc() {
    const monthIndex = MONTHS_NOMINATIVE.indexOf(month)
    if (!canRecalc || monthIndex < 0 || recalculating) return
    setRecalculating(true)
    try {
      const response = await fetch("/api/work-attendance/recalc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year: Number(year), month: monthIndex + 1 }),
      })
      if (response.ok) {
        window.dispatchEvent(new CustomEvent("linko:attendance-recalculated"))
        return
      }
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      notify(t(body?.error || "Не удалось выполнить перерасчет"))
    } catch {
      notify(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setRecalculating(false)
    }
  }

  return (
    <div className={`${CARD_CLASS} flex ${ownTab ? "min-h-[383px]" : ""} flex-col p-[10px]`}>
      <div className="flex h-[50px] overflow-hidden rounded-t-[10px]">
        {subTabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => selectTab(tab)}
            className={`h-[50px] flex-1 text-[14px] font-semibold text-[#888] ${tab === activeTab ? "bg-[#f2f5f8]" : "bg-white"}`}
          >
            {t(tab)}
          </button>
        ))}
      </div>

      {ownTab && (
      <div className={`${CARD_CLASS} mt-[10px] h-[127px] px-[10px] pt-[14.7px]`}>
        <div className="grid grid-cols-2 gap-[10px]">
          <SelectField label={t("Месяц")} options={MONTHS_NOMINATIVE} value={month} onChange={onMonthChange} />
          <SelectField label={t("Год")} options={YEARS} value={year} onChange={onYearChange} />
        </div>
        <div className="mt-[18px] mr-[8px] flex items-end justify-end gap-[10px]">
          <span className="text-[13px] font-semibold leading-[16.25px]">{t("данные за")}</span>
          {canRecalc && (
          <button
            type="button"
            onClick={handleRecalc}
            disabled={recalculating}
            className="flex h-[30px] items-center rounded-[5px] leading-[18px] bg-[#4f71dc] pl-3 text-[13px] font-semibold text-white disabled:opacity-70"
          >
            <svg viewBox="0 0 24 24" className={`mb-1 h-[18px] w-[18px] fill-white ${recalculating ? "animate-spin" : ""}`} aria-hidden>
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="pl-2 pr-4">{t("Перерасчет")}</span>
          </button>
          )}
        </div>
      </div>
      )}

      {loading ? (
        <div className="mt-[10px] flex h-[176px] items-center justify-center" role="status" aria-label={t("Загрузка...")}>
          <svg viewBox="0 0 50 50" className="h-[50px] w-[50px] animate-spin" aria-hidden>
            {Array.from({ length: 8 }, (_, index) => (
              <circle key={index} cx={25 + 20 * Math.sin((index * Math.PI) / 4)} cy={25 - 20 * Math.cos((index * Math.PI) / 4)} r={1.5 + index * 0.25} fill="#4f71dc" />
            ))}
          </svg>
        </div>
      ) : (
      <div
        role="img"
        aria-label={t("Робот-помощник")}
        className="flex h-[176px] items-end justify-center bg-[url('/robot-empty.png')] bg-[length:130px_auto] bg-[position:50%_20px] bg-no-repeat pb-5"
      >
        <p className="text-center text-[13px] leading-[16.25px] text-[#666]">{t("По вашему запросу ничего не найдено")}</p>
      </div>
      )}
    </div>
  )
}
