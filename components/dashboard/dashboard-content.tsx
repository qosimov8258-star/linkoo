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

const PERIOD_TO_TYPE: Record<PeriodKey, string> = {
  "СЕГОДНЯ": "today",
  "ВЧЕРА": "yesterday",
  "ПОСЛ. 7": "week",
  "МЕСЯЦ": "month",
  "СВОЯ": "ownDate",
}
const TYPE_TO_PERIOD: Record<string, PeriodKey> = Object.fromEntries(Object.entries(PERIOD_TO_TYPE).map(([period, type]) => [type, period as PeriodKey]))

export function DashboardContent() {
  const searchParams = useSearchParams()
  const today = useMemo(() => new Date(), [])

  const urlBegin = searchParams.get("beginDate")
  const urlEnd = searchParams.get("endDate")
  const urlType = searchParams.get("typeDate")
  const hasUrlCustomRange = (!urlType || urlType === "ownDate") && !!urlBegin && !!urlEnd

  const [period, setPeriodState] = useState<PeriodKey>(() => TYPE_TO_PERIOD[urlType ?? ""] ?? "СВОЯ")
  const [customBegin, setCustomBegin] = useState<Date>(() =>
    urlBegin && hasUrlCustomRange ? parseISODate(urlBegin) : today,
  )
  const [customEnd, setCustomEnd] = useState<Date>(() => (urlEnd && hasUrlCustomRange ? parseISODate(urlEnd) : today))

  const [touched, setTouched] = useState(false)

  function setPeriod(next: PeriodKey) {
    // like the reference app, switching to СВОЯ shows the whole month picked in the left panel
    if (next === "СВОЯ" && period !== "СВОЯ") {
      setCustomBegin(startOfMonth(customBegin))
      setCustomEnd(endOfMonth(customBegin))
    }
    setTouched(true)
    setPeriodState(next)
  }

  function selectOwnRange() {
    setTouched(true)
    setPeriodState("СВОЯ")
  }

  const { begin, end } = rangeForPeriod(period, today, { begin: customBegin, end: customEnd })
  // Like the reference, the own range stays "Укажите Дату" until a date is picked (the widgets show today meanwhile).
  const label = period === "СВОЯ" && !touched && !hasUrlCustomRange ? "Укажите Дату" : formatRangeLabel(begin, end)
  const beginISO = toISODate(begin)
  const endISO = toISODate(end)

  // keep the range in the address bar (beginDate / endDate / typeDate), as the reference app does
  useEffect(() => {
    if (!touched) return
    const params = new URLSearchParams({ beginDate: beginISO, endDate: endISO, typeDate: PERIOD_TO_TYPE[period] })
    window.history.replaceState(window.history.state, "", `${window.location.pathname}?${params}`)
  }, [touched, period, beginISO, endISO])

  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>(() => loadSelectedHomeWidgets())
  const visibleWidgets = useMemo(() => new Set(selectedWidgets), [selectedWidgets])

  function handleWidgetsChange(keys: string[]) {
    setSelectedWidgets(keys)
    saveSelectedHomeWidgets(keys)
  }

  // bumped when "Перерасчет" took a new attendance snapshot, so the tiles are fetched again
  const [recalcStamp, setRecalcStamp] = useState(0)
  useEffect(() => {
    const onRecalc = () => setRecalcStamp((value) => value + 1)
    window.addEventListener("linko:attendance-recalculated", onRecalc)
    return () => window.removeEventListener("linko:attendance-recalculated", onRecalc)
  }, [])

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
  }, [beginISO, endISO, recalcStamp])

  function handleCustomMonthChange(monthName: string) {
    const monthIndex = MONTHS_NOMINATIVE.indexOf(monthName)
    if (monthIndex < 0) return
    const year = customBegin.getFullYear()
    setCustomBegin(new Date(year, monthIndex, 1))
    setCustomEnd(new Date(year, monthIndex + 1, 0))
    selectOwnRange()
  }

  function handleCustomYearChange(yearText: string) {
    const year = Number.parseInt(yearText, 10)
    if (!Number.isFinite(year)) return
    const month = customBegin.getMonth()
    setCustomBegin(new Date(year, month, 1))
    setCustomEnd(new Date(year, month + 1, 0))
    selectOwnRange()
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
          selectOwnRange()
        }}
        selectedWidgets={selectedWidgets}
        onWidgetsChange={handleWidgetsChange}
      />
      <StatCards begin={begin} end={end} summary={summary} visible={visibleWidgets} />
      <UnitStatCards begin={begin} end={end} visible={visibleWidgets} />

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
          <AgentBranchVisitsWidget showTrends={visibleWidgets.has("agentSales") || visibleWidgets.has("akbTrend")} showCouriers={visibleWidgets.has("couriers")} begin={beginISO} end={endISO} />
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
