"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

type AgentRoute = {
  agent: string
  routeDate: string
  routeVisited: number
  outsideVisited: number
}

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

export function VisitsByDayView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [range, setRange] = useState({ from: monthStart(), to: today })
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [routes, setRoutes] = useState<AgentRoute[]>([])

  const overlayOpen = dashboardOpen

  useEffect(() => {
    let cancelled = false
    fetch("/api/agent-routes")
      .then((response) => (response.ok ? (response.json() as Promise<AgentRoute[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setRoutes(data)
      })
      .catch(() => {
        if (!cancelled) setRoutes([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const agents = useMemo(() => Array.from(new Set(routes.map((route) => route.agent))).sort((a, b) => a.localeCompare(b, "ru")), [routes])

  // Marks a day "visited" for an agent when that day's route row recorded any
  // completed visit (on-route or off-route) — 1/0 matrix drawn straight from
  // real agent_routes rows, not fabricated.
  const visitedByAgentAndDay = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const route of routes) {
      if (route.routeVisited > 0 || route.outsideVisited > 0) {
        if (!map.has(route.agent)) map.set(route.agent, new Set())
        map.get(route.agent)!.add(route.routeDate)
      }
    }
    return map
  }, [routes])

  useEffect(() => {
    if (!overlayOpen) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDashboardOpen(false)
      }
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [overlayOpen])

  const days = useMemo(() => {
    const start = new Date(`${range.from}T00:00:00`)
    const end = new Date(`${range.to}T00:00:00`)
    const result: { day: number; iso: string }[] = []
    for (const date = start; date <= end && result.length < 31; date.setDate(date.getDate() + 1)) {
      result.push({ day: date.getDate(), iso: inputDate(date) })
    }
    return result
  }, [range])

  function downloadVisitsCsv() {
    const rows = [
      ["Агент", ...days.map((day) => String(day.day))],
      ...agents.map((agent) => [agent, ...days.map((day) => (visitedByAgentAndDay.get(agent)?.has(day.iso) ? "1" : "0"))]),
    ]
    downloadExcelTable("visits-by-day.xls", rows)
  }

  return (
    <ReportPage>
      <ReportHeader title="Визиты по дням" onExcel={downloadVisitsCsv} onDashboard={() => setDashboardOpen(true)} inDashboard={inDashboard} />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (draftFrom <= draftTo) setRange({ from: draftFrom, to: draftTo })
          }}
          applyDisabled={draftFrom > draftTo}
        >
          <ReportDateField label="Дата создания от" value={draftFrom} max={draftTo} onChange={setDraftFrom} />
          <ReportDateField label="Дата создания до" value={draftTo} min={draftFrom} onChange={setDraftTo} />
          <ReportChipField label="Колонка" value="Визит" />
        </ReportFilters>

        {agents.length === 0 ? (
          <ReportEmpty />
        ) : (
        <div className="mt-3 overflow-x-auto border border-slate-300 visits-scrollbar">
          <table className="min-w-max border-collapse text-[13px] text-slate-800">
            <thead>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-20 w-[375px] min-w-[260px] border-b border-r border-slate-300 bg-slate-50 px-3 py-4" />
                {days.map((day) => (
                  <th key={day.iso} className="h-14 w-[70px] min-w-[70px] border-b border-r border-slate-300 text-center font-medium">
                    {day.day}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-50 px-3 py-4 text-center font-semibold">
                  {t("Агент")}
                </th>
                {days.map((day) => (
                  <th key={day.iso} className="h-14 border-b border-r border-slate-300 text-center font-semibold">
                    {t("Визит")}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {agents.map((agent, agentIndex) => (
                <tr key={agent} className={agentIndex % 2 ? "bg-slate-50" : "bg-white"}>
                  <th className={`sticky left-0 z-10 border-b border-r border-slate-300 px-2 py-4 text-left font-normal ${agentIndex % 2 ? "bg-slate-50" : "bg-white"}`}>
                    {agent}
                  </th>
                  {days.map((day) => (
                    <td key={day.iso} className="border-b border-r border-slate-300 px-2 py-4 text-right">
                      {visitedByAgentAndDay.get(agent)?.has(day.iso) ? 1 : 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </ReportBand>

      
{overlayOpen && (
        <button
          type="button"
          aria-label={t("Закрыть окно")}
          onClick={() => setDashboardOpen(false)}
          className="fixed inset-0 z-[90] cursor-default bg-black/55"
        />
      )}

      {dashboardOpen && (
        <DashboardDialog
          reportSlug="visits-by-day"
          reportLabel="Визиты по дням"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
          onSave={() => setInDashboard(true)}
        />
      )}
    </ReportPage>
  )
}
