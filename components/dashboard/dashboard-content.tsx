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
  formatRangeLabel,
  parseISODate,
  rangeForPeriod,
  toISODate,
} from "@/lib/dashboard-date-range"
import type { DashboardSummary } from "@/lib/dashboard-summary-repo"

export function DashboardContent() {
  const searchParams = useSearchParams()
  const today = useMemo(() => new Date(), [])

  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const hasUrlCustomRange = searchParams.get("typeDate") === "ownDate" && !!urlBegin && !!urlEnd

  const [period, setPeriod] = useState<PeriodKey>("СВОЯ")
  const [customBegin, setCustomBegin] = useState<Date>(() =>
    urlBegin && hasUrlCustomRange ? parseISODate(urlBegin) : today,
  )
  const [customEnd, setCustomEnd] = useState<Date>(() => (urlEnd && hasUrlCustomRange ? parseISODate(urlEnd) : today))

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
    (widget) => widget.kind === "placeholder" && visibleWidgets.has(widget.key) && !["agentSales", "akbTrend", "couriers"].includes(widget.key),
  )

  return (
    <>
      <DateRangeBar
        period={period}
        onPeriodChange={setPeriod}
        label={label}
        begin={beginISO}
        end={endISO}
        onCustomRange={(from, to) => {
          setCustomBegin(parseISODate(from))
          setCustomEnd(parseISODate(to))
          setPeriod("СВОЯ")
        }}
        selectedWidgets={selectedWidgets}
        onWidgetsChange={handleWidgetsChange}
      />
      <StatCards begin={begin} end={end} summary={summary} visible={visibleWidgets} />
      <UnitStatCards begin={begin} end={end} visible={visibleWidgets} summary={summary} />

      <div className="mt-5 grid grid-cols-1 items-start gap-4 xl:grid-cols-3">
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
          begin={beginISO}
          end={endISO}
        />
        {visibleWidgets.has("productCategory") && <RightPanel summary={summary} />}
      </div>

      {visibleWidgets.has("agentBranchVisits") && (
        <div className="mt-5">
          <AgentBranchVisitsWidget showTrends={visibleWidgets.has("agentSales") || visibleWidgets.has("akbTrend")} showCouriers={visibleWidgets.has("couriers")} />
        </div>
      )}

      {visibleWidgets.has("cashboxes") && (
        <div className="mt-5">
          <CashboxesSummaryWidget />
        </div>
      )}

      {placeholderWidgets.length > 0 && (
        <div className="mt-5 pb-5">
          <div className="space-y-5">
            {placeholderWidgets.map((widget) => (
              <ReportListRow key={widget.key} title={widget.label} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}
