"use client"

import { useEffect, useMemo, useState } from "react"

import { BRANCH_KPI_API, fetchJson, kpiNumber, useMonthName } from "@/components/analytics/branch-kpi-shared"
import type { BranchKpiBalance, BranchKpiDetail } from "@/lib/branch-kpi-types"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

// Detail of one branch (demo module 5081, GET staff/branch_performance/:id/):
// title + Excel, "Фикс. зарплата / Бонусы / Итог зарплата", and the KPI table
// KPI | Уровень | План | Продажи | Возврат | Факт | % | Дневной план | Прогноз | % | Бонус
// (fact/% cells red ≤ 30 %, green > 70 %, orange between; forecast cells by the forecast %).

type SortKey = "discounts" | "levels" | "plan" | "totalSales" | "orderReturnFact" | "fact" | "factPercent" | "planFact" | "forecast" | "forecastPercent" | "bonus"

type Line = BranchKpiBalance & { levelText: string; factPercent: number; forecastPercent: number }

const COLUMNS: Array<{ key: SortKey; label: string; width: string }> = [
  { key: "discounts", label: "KPI", width: "9.85%" },
  { key: "levels", label: "Уровень", width: "9.85%" },
  { key: "plan", label: "План", width: "9.85%" },
  { key: "totalSales", label: "Продажи", width: "9.85%" },
  { key: "orderReturnFact", label: "Возврат", width: "9.85%" },
  { key: "fact", label: "Факт", width: "9.85%" },
  { key: "factPercent", label: "%", width: "5.75%" },
  { key: "planFact", label: "Дневной план", width: "9.85%" },
  { key: "forecast", label: "Прогноз", width: "9.85%" },
  { key: "forecastPercent", label: "%", width: "5.75%" },
  { key: "bonus", label: "Бонус", width: "9.85%" },
]

function sortValue(line: Line, key: SortKey): number | string {
  switch (key) {
    case "discounts":
      return line.performanceIndicator.name.toLowerCase()
    case "levels":
      return line.performanceIndicatorLevel?.level ?? 0
    case "plan":
      return line.planAmount
    case "totalSales":
      return line.salesAmount ?? -Infinity
    case "orderReturnFact":
      return line.returnAmount ?? -Infinity
    case "fact":
      return line.factAmount ?? -Infinity
    case "factPercent":
      return line.factPercent
    case "planFact":
      return line.dailyPlan ?? -Infinity
    case "forecast":
      return line.planForecast ?? -Infinity
    case "forecastPercent":
      return line.forecastPercent
    case "bonus":
      return line.bonusAmount
  }
}

/** Demo cell colour by achievement %. */
function percentColor(percent: number): string {
  if (percent <= 30) return "#e57373"
  if (percent > 70) return "#81c784"
  return "#f0ad4e"
}

function levelText(balance: BranchKpiBalance): string {
  const level = balance.performanceIndicatorLevel
  if (!level) return ""
  return `${level.level} (${kpiNumber(level.fromAmount, "%")}-${kpiNumber(level.toAmount, "%")})`
}

export function BranchKpiDetailPanel({
  branchId,
  month,
  year,
  version,
  onClose,
  onOpenIndicator,
}: {
  branchId: number
  month: number
  year: number
  /** Bumped by the page after writes / recalculation to refetch. */
  version: number
  onClose: () => void
  /** KPI name click (demo: link to the KPI card) → reward levels of the indicator. */
  onOpenIndicator: (indicatorId: number) => void
}) {
  const { t } = useLanguage()
  const monthName = useMonthName()
  const [data, setData] = useState<BranchKpiDetail | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetchJson<BranchKpiDetail>(`${BRANCH_KPI_API}/${branchId}?month=${month}&year=${year}`, { signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [branchId, month, year, version])

  const lines = useMemo<Line[]>(() => {
    const list = (data?.balances ?? []).map((balance) => {
      const plan = Number(balance.planAmount) || 0
      return {
        ...balance,
        levelText: levelText(balance),
        factPercent: plan ? ((balance.factAmount ?? 0) / plan) * 100 : 0,
        forecastPercent: plan ? ((balance.planForecast ?? 0) / plan) * 100 : 0,
      }
    })
    if (!sort) return list
    return [...list].sort((a, b) => {
      const x = sortValue(a, sort.key)
      const y = sortValue(b, sort.key)
      const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y, "ru") : Number(x) - Number(y) || 0
      return sort.desc ? -order : order
    })
  }, [data, sort])

  const currency = data?.currency ?? "SUM"
  const salary = data?.salary ?? 0
  const bonuses = lines.reduce((sum, line) => sum + (Number(line.bonusAmount) || 0), 0)
  // the reference's "Итог зарплата" is the fixed salary only (bonuses are listed separately)
  const total = salary

  const downloadExcel = () => {
    if (!data) return
    const header = COLUMNS.map((column) => t(column.label))
    const rows = lines.map((line) => [
      line.performanceIndicator.name,
      line.performanceIndicatorLevel
        ? `${line.performanceIndicatorLevel.level} (${line.performanceIndicatorLevel.fromAmount}%-${line.performanceIndicatorLevel.toAmount}%)`
        : "",
      line.planAmount,
      line.salesAmount,
      line.returnAmount,
      line.factAmount,
      Math.round(line.factPercent * 100) / 100,
      line.dailyPlan,
      line.planForecast,
      Math.round(line.forecastPercent * 100) / 100,
      line.bonusAmount,
    ])
    downloadExcelTable(`KPI ${data.name} ${monthName(month)} ${year}`, [header, ...rows])
  }

  // Reference: two stacked 15px triangles (up, down); the one that is not the current direction turns transparent.
  const sortIcon = (key: SortKey) => {
    const active = sort?.key === key
    const upFill = active && !sort.desc ? "transparent" : "#fff"
    const downFill = active && sort.desc ? "transparent" : "#fff"
    return (
      <span className="inline-block h-[20px] w-[20px] align-top">
        <svg viewBox="0 0 24 24" className="ml-[5px] block h-[15px] w-[15px] overflow-hidden" style={{ fill: upFill }}><path d="M7 14l5-5 5 5z" /></svg>
        <svg viewBox="0 0 24 24" className="ml-[5px] -mt-[5px] block h-[15px] w-[15px] overflow-hidden" style={{ fill: downFill }}><path d="M7 10l5 5 5-5z" /></svg>
      </span>
    )
  }

  if (loading && !data) return <div className="flex h-[160px] items-center justify-center text-[#999]">{t("Загрузка...")}</div>
  if (error && !data)
    return (
      <div className="px-[30px] py-6 text-[#e57373]">
        {t("Не удалось загрузить данные")}: {t(error)}
      </div>
    )
  if (!data) return null

  const dash = <span className="text-[#999]">—</span>
  const head = "h-[30px] bg-[#4f71dc] px-1 font-bold text-white"
  const cell = "h-[30px] bg-[#d7e0ff] px-1 font-bold text-[#666]"
  return (
    <div className="bg-[#f1f5f8] py-[20px]">
    <div className={`-mx-[15px] bg-white text-[#333] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)] ${loading ? "opacity-60" : ""}`}>
      <div className="relative flex h-[60px] items-center justify-between border-b border-[#efefef] pl-[30px] pr-[42px]">
        <button type="button" onClick={onClose} className="absolute inset-y-0 left-0 right-[100px] cursor-pointer" aria-label={t("Закрыть")} />
        <span className="text-[18px] font-semibold">{data.name}</span>
        <button type="button" onClick={downloadExcel} title={t("Скачать Excel")} aria-label={t("Скачать Excel")} className="relative z-[1] flex h-6 w-6 items-center justify-center">
          <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" /></svg>
        </button>
      </div>
      <div className="flex h-[60px] items-center justify-between px-[30px] text-[#666]">
        <div>
          <span className="block leading-[16.3px]">{t("Фикс. зарплата")}</span>
          <div className="text-[16px] font-semibold leading-[20px] text-[#333]">{kpiNumber(salary, currency)}</div>
        </div>
        <div>
          <span className="block leading-[16.3px]">{t("Бонусы")}</span>
          <div className="text-[16px] font-semibold leading-[20px] text-[#333]">{kpiNumber(bonuses, currency)}</div>
        </div>
        <div className="text-right">
          <span className="block leading-[16.3px]">{t("Итог зарплата")}</span>
          <div className="text-[16px] leading-[22px] text-black">{kpiNumber(total, currency)}</div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px] table-fixed border-separate border-spacing-[2px] text-center text-[13px]">
          <thead>
            <tr>
              {COLUMNS.map((column) => (
                <th key={column.key} style={{ width: column.width }} className={head}>
                  <button
                    type="button"
                    onClick={() => setSort((current) => (current?.key === column.key ? (current.desc ? null : { key: column.key, desc: true }) : { key: column.key, desc: false }))}
                    className="inline-flex items-center gap-1 leading-[20px]"
                  >
                    {column.label === "KPI" ? "KPI" : t(column.label)} {sortIcon(column.key)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const supported = line.factAmount !== null
              const factStyle = supported ? { background: percentColor(line.factPercent), color: "#fff" } : undefined
              const forecastStyle = supported ? { background: percentColor(line.forecastPercent), color: "#fff" } : undefined
              return (
                <tr key={line.performanceIndicator.id}>
                  <td className={`${cell} cursor-pointer`} onClick={() => onOpenIndicator(line.performanceIndicator.id)}>
                    {line.performanceIndicator.name}
                    {!supported && <span className="block text-[11px] font-normal text-[#999]">{t("нет данных в системе")}</span>}
                  </td>
                  <td className={cell}>{line.levelText}</td>
                  <td className={cell}>{kpiNumber(line.planAmount)}</td>
                  <td className={cell}>{supported ? kpiNumber(line.salesAmount) : dash}</td>
                  <td className={cell}>{supported ? kpiNumber(line.returnAmount) : dash}</td>
                  <td className={`${cell} whitespace-nowrap`} style={factStyle}>
                    {supported ? kpiNumber(line.factAmount) : dash}
                  </td>
                  <td className={`${cell} whitespace-nowrap`} style={factStyle}>
                    {supported ? kpiNumber(line.factPercent, "%", 1) : dash}
                  </td>
                  <td className={cell}>{supported ? kpiNumber(line.dailyPlan, undefined, 0) : dash}</td>
                  <td className={`${cell} whitespace-nowrap`} style={forecastStyle}>
                    {supported ? kpiNumber(line.planForecast, undefined, 0) : dash}
                  </td>
                  <td className={`${cell} whitespace-nowrap`} style={forecastStyle}>
                    {supported ? kpiNumber(line.forecastPercent, "%", 0) : dash}
                  </td>
                  <td className={cell}>{kpiNumber(line.bonusAmount, undefined, 0)}</td>
                </tr>
              )
            })}
            {!lines.length && (
              <tr>
                <td colSpan={COLUMNS.length} className="px-4 py-8 text-center font-normal text-[#999]">
                  {data.lastDate ? t("Нет данных") : t("Нет данных. Нажмите «Перерасчет KPI»")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  )
}
