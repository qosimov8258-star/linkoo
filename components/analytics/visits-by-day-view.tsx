"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { AgentRouteSummary, AgentRouteSummaryRow } from "@/lib/agent-visits-repo"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { nextMatrixSort } from "@/components/ref/sort-arrows"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"

/** The reference's «Колонка» choices (select_field of its visit_by_day report), in its order. */
const COLUMNS = [
  { id: "visit", label: "Визит" },
  { id: "order", label: "Заказ" },
  { id: "report", label: "Фотоотчёт колв." },
  { id: "percent", label: "Strike Rate" },
  { id: "work_start_time", label: "Начало работы" },
  { id: "work_end_time", label: "Конец работы" },
] as const
type ColumnId = (typeof COLUMNS)[number]["id"]
const DEFAULT_COLUMN: ColumnId = "visit"
const columnOf = (label: string) => COLUMNS.find((column) => column.label === label)?.id ?? DEFAULT_COLUMN
const labelOf = (id: ColumnId) => COLUMNS.find((column) => column.id === id)?.label ?? "Визит"

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

/** One cell of the chosen column: a number, or the "HH:mm" of the work start / end ("" on a day without visits). */
function cellValue(agent: AgentRouteSummaryRow, day: string, column: ColumnId): number | string {
  const visits = agent.visitsByDay?.[day] ?? 0
  const orders = agent.ordersByDay?.[day] ?? 0
  switch (column) {
    case "order":
      return orders
    case "report":
      return agent.reportsByDay?.[day] ?? 0
    case "percent":
      // Strike Rate: visited clients with an order against the visited clients, whole percent (Linko's 81.8 → 82).
      return visits > 0 ? Math.round((orders / visits) * 100) : 0
    case "work_start_time":
      return agent.startByDay?.[day] ?? ""
    case "work_end_time":
      return agent.endByDay?.[day] ?? ""
    default:
      return visits
  }
}

// Визиты по дням: per agent and day the chosen «Колонка» (Визит / Заказ / Фотоотчёт колв. / Strike Rate / Начало
// / Конец работы), from the field activity visits (GET /api/agent-visits?view=routes; the visits of Активность /
// Отслеживание). Like the reference report, only agents with at least one visit inside the applied period get a
// row, and every day of the period is a column. A click on an agent's name opens the agent drawer.
export function VisitsByDayView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [draftColumn, setDraftColumn] = useState<string>(labelOf(DEFAULT_COLUMN))
  const [applied, setApplied] = useState<{ from: string; to: string; column: ColumnId }>({ from: monthStart(), to: today, column: DEFAULT_COLUMN })
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [summary, setSummary] = useState<AgentRouteSummary | null>(null)
  // No column sorted at first (agents by name); a header click: ascending, descending, none.
  const [sort, setSort] = useState<{ key: number | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" })

  const overlayOpen = dashboardOpen
  const range = useMemo(() => ({ from: applied.from, to: applied.to }), [applied.from, applied.to])

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

  // Every day of the applied period (the API takes at most 366 days).
  const days = useMemo(() => {
    const start = new Date(`${range.from}T00:00:00`)
    const end = new Date(`${range.to}T00:00:00`)
    const result: { day: number; iso: string }[] = []
    for (const date = start; date <= end && result.length < 366; date.setDate(date.getDate() + 1)) {
      result.push({ day: date.getDate(), iso: inputDate(date) })
    }
    return result
  }, [range])

  const agents = useMemo(() => {
    const list = (summary?.agents ?? [])
      .filter((agent) => agent.visitDays.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name, "ru") || a.employeeId - b.employeeId)
    if (sort.key === null) return list
    const dir = sort.dir === "asc" ? 1 : -1
    if (sort.key === 0) return [...list].sort((a, b) => a.name.localeCompare(b.name, "ru") * dir)
    const day = days[sort.key - 1]?.iso ?? ""
    return [...list].sort((a, b) => {
      const x = cellValue(a, day, applied.column)
      const y = cellValue(b, day, applied.column)
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * dir
    })
  }, [summary, sort, days, applied.column])

  const columnLabel = t(labelOf(applied.column))
  const textColumn = applied.column === "work_start_time" || applied.column === "work_end_time"

  function downloadVisitsCsv() {
    const rows = [
      [t("Агент"), ...days.map((day) => `${day.day} · ${columnLabel}`)],
      ...agents.map((agent) => [agent.name, ...days.map((day) => String(cellValue(agent, day.iso, applied.column)))]),
    ]
    downloadExcelTable("visits-by-day.xls", rows)
  }

  const matrixHeads = useMemo<MatrixHead[]>(
    () => [{ label: t("Агент"), width: 300, sortable: true, align: "left" }, ...days.map(() => ({ label: columnLabel, width: 55, align: textColumn ? ("center" as const) : ("right" as const) }))],
    [days, t, columnLabel, textColumn],
  )
  const matrixRows = useMemo<MatrixRow[]>(
    () =>
      agents.map((agent) => ({
        key: String(agent.employeeId),
        cells: [
          agent.name,
          ...days.map((day) => {
            const value = cellValue(agent, day.iso, applied.column)
            return typeof value === "number" ? matrixNumber(value) : value
          }),
        ],
      })),
    [agents, days, applied.column],
  )

  return (
    <ReportPage>
      <ReportHeader title="Визиты по дням" onExcel={downloadVisitsCsv} onDashboard={() => setDashboardOpen(true)} inDashboard={inDashboard} />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (draftFrom <= draftTo) setApplied({ from: draftFrom, to: draftTo, column: columnOf(draftColumn) })
          }}
          applyDisabled={draftFrom > draftTo}
        >
          <ReportDateField label="Дата создания от" value={draftFrom} max={draftTo} onChange={setDraftFrom} />
          <ReportDateField label="Дата создания до" value={draftTo} min={draftFrom} onChange={setDraftTo} />
          <ReportChipField label="Колонка" value={draftColumn} options={COLUMNS.map((column) => column.label)} onChange={setDraftColumn} />
        </ReportFilters>

        {agents.length === 0 ? (
          <ReportEmpty />
        ) : (
          <ReportMatrix
            stickyFirst
            heads={matrixHeads}
            groups={[{ title: "", span: 1 }, ...days.map((day) => ({ title: day.day, span: 1 }))]}
            sortKey={sort.key}
            sortDir={sort.dir}
            onSort={(index) => setSort((current) => nextMatrixSort(current, index))}
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
