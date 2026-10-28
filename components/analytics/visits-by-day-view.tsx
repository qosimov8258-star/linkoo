"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { AgentRouteSummary } from "@/lib/agent-visits-repo"
import { ReportMatrix, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"

type VisitAgent = { employeeId: number; name: string; days: Set<string> }

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

// Визиты по дням: 1 / 0 per agent and day — whether the agent visited any client that day, from the field
// activity visits (GET /api/agent-visits?view=routes, the visits of Активность / Отслеживание). Like the
// reference report, only agents with at least one visit inside the applied period get a row.
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
  const [summary, setSummary] = useState<AgentRouteSummary | null>(null)

  const overlayOpen = dashboardOpen

  useEffect(() => {
    let cancelled = false
    fetch(`/api/agent-visits?view=routes&from=${range.from}&to=${range.to}`)
      .then((response) => (response.ok ? (response.json() as Promise<AgentRouteSummary>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
    return () => {
      cancelled = true
    }
  }, [range])

  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc")

  const agents = useMemo<VisitAgent[]>(() => {
    const list = (summary?.agents ?? [])
      .filter((agent) => agent.visitDays.length > 0)
      .map((agent) => ({ employeeId: agent.employeeId, name: agent.name, days: new Set(agent.visitDays) }))
      .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.employeeId - b.employeeId)
    return sortDir === "asc" ? list : list.reverse()
  }, [summary, sortDir])

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
      [t("Агент"), ...days.map((day) => String(day.day))],
      ...agents.map((agent) => [agent.name, ...days.map((day) => (agent.days.has(day.iso) ? "1" : "0"))]),
    ]
    downloadExcelTable("visits-by-day.xls", rows)
  }

  const matrixHeads = useMemo<MatrixHead[]>(
    () => [{ label: t("Агент"), width: 300, sortable: true, align: "left" }, ...days.map(() => ({ label: t("Визит"), width: 55 }))],
    [days, t],
  )
  const matrixRows = useMemo<MatrixRow[]>(
    () => agents.map((agent) => ({ key: String(agent.employeeId), cells: [agent.name, ...days.map((day) => (agent.days.has(day.iso) ? 1 : 0))] })),
    [agents, days],
  )

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
          <ReportMatrix
            stickyFirst
            heads={matrixHeads}
            groups={[{ title: "", span: 1 }, ...days.map((day) => ({ title: day.day, span: 1 }))]}
            sortKey={0}
            sortDir={sortDir}
            onSort={() => setSortDir((dir) => (dir === "asc" ? "desc" : "asc"))}
            rows={matrixRows}
          />
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
