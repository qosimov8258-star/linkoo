"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"

import { DateRangeBar } from "./date-range-bar"
import { StatCards } from "./stat-cards"
import { UnitStatCards } from "./unit-stat-cards"
import { LeftPanel } from "./left-panel"
import { CenterPanel } from "./center-panel"
import { RightPanel } from "./right-panel"
import { AgentBranchVisitsWidget } from "./agent-branch-visits-widget"
import { CashboxesSummaryWidget } from "./cashboxes-summary-widget"
import { ReportListRow } from "./report-list-row"
import { HOME_WIDGETS, loadSelectedHomeWidgets, saveSelectedHomeWidgets } from "@/lib/dashboard-home-widgets"
import {
  MONTHS_NOMINATIVE,
  type PeriodKey,
  endOfMonth,
  formatRangeLabel,
  parseISODate,
  rangeForPeriod,
  startOfMonth,
  toISODate,
} from "@/lib/dashboard-date-range"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"

export function DashboardContent() {
  const searchParams = useSearchParams()
  const today = useMemo(() => new Date(), [])

  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const hasUrlCustomRange = searchParams.get("typeDate") === "ownDate" && !!urlBegin && !!urlEnd

  const [period, setPeriod] = useState<PeriodKey>(hasUrlCustomRange ? "СВОЯ" : "МЕСЯЦ")
  const [customBegin, setCustomBegin] = useState<Date>(() =>
    urlBegin ? parseISODate(urlBegin) : startOfMonth(today),
  )
  const [customEnd, setCustomEnd] = useState<Date>(() => (urlEnd ? parseISODate(urlEnd) : endOfMonth(today)))

  const { begin, end } = rangeForPeriod(period, today, { begin: customBegin, end: customEnd })
  const label = formatRangeLabel(begin, end)
  const beginISO = toISODate(begin)
  const endISO = toISODate(end)

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>(() => loadSelectedHomeWidgets())
  const visibleWidgets = useMemo(() => new Set(selectedWidgets), [selectedWidgets])

  function handleWidgetsChange(keys: string[]) {
    setSelectedWidgets(keys)
    saveSelectedHomeWidgets(keys)
  }

  useEffect(() => {
    let cancelled = false
    setSummary(null)
    fetch(`/api/dashboard-summary?begin=${beginISO}&end=${endISO}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: DashboardSummary | null) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [beginISO, endISO])

  function handleCustomMonthChange(monthName: string) {
    const monthIndex = MONTHS_NOMINATIVE.indexOf(monthName)
    if (monthIndex < 0) return
    const year = customBegin.getFullYear()
    setCustomBegin(new Date(year, monthIndex, 1))
    setCustomEnd(new Date(year, monthIndex + 1, 0))
    setPeriod("СВОЯ")
  }

  function handleCustomYearChange(yearText: string) {
    const year = Number.parseInt(yearText, 10)
    if (!Number.isFinite(year)) return
    const month = customBegin.getMonth()
    setCustomBegin(new Date(year, month, 1))
    setCustomEnd(new Date(year, month + 1, 0))
    setPeriod("СВОЯ")
  }

  const placeholderWidgets = HOME_WIDGETS.filter(
    (widget) => widget.kind === "placeholder" && visibleWidgets.has(widget.key),
  )

  return (
    <>
      <DateRangeBar
        period={period}
        onPeriodChange={setPeriod}
        label={label}
        selectedWidgets={selectedWidgets}
        onWidgetsChange={handleWidgetsChange}
      />
      <StatCards begin={begin} end={end} summary={summary} visible={visibleWidgets} />
      <UnitStatCards begin={begin} end={end} visible={visibleWidgets} />

      <div className="grid grid-cols-1 gap-6 px-3 py-4 sm:px-6 sm:py-6 xl:grid-cols-3">
        <LeftPanel
          month={MONTHS_NOMINATIVE[customBegin.getMonth()]}
          year={String(customBegin.getFullYear())}
          onMonthChange={handleCustomMonthChange}
          onYearChange={handleCustomYearChange}
        />
        <CenterPanel
          summary={summary}
          showAttendance={visibleWidgets.has("visitsDelivery")}
          showKpi={visibleWidgets.has("kpi")}
        />
        {visibleWidgets.has("productCategory") && <RightPanel summary={summary} />}
      </div>

      {visibleWidgets.has("agentBranchVisits") && (
        <div className="px-3 pb-4 sm:px-6 sm:pb-6">
          <AgentBranchVisitsWidget />
        </div>
      )}

      {visibleWidgets.has("cashboxes") && (
        <div className="px-3 pb-4 sm:px-6 sm:pb-6">
          <CashboxesSummaryWidget />
        </div>
      )}

      {placeholderWidgets.length > 0 && (
        <div className="px-3 pb-6 sm:px-6">
          <div className="divide-y divide-slate-100 rounded-lg bg-white shadow-sm">
            {placeholderWidgets.map((widget) => (
              <ReportListRow key={widget.key} title={widget.label} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
