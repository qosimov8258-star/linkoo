"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { AgentRouteSummary } from "@/lib/agent-visits-repo"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportListSelectField, ReportPage } from "@/components/ref/report-kit"

type Row = (string | number)[]

type PositionRef = { name: string }

const HEADERS = [
  "Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит",
  "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту",
  "Вне маршрута", "Результативность, %", "Системность, %",
]
const PERCENT_COLUMNS = [4, 9, 13, 14]
const HEADERS_SHORT = ["Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит", "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту", "Вне маршрута", "%", "%"]

/** Case / spacing-insensitive name key (positions are free text on the employee card). */
function key(name: string) {
  return name.replace(/\s+/g, " ").trim().toLowerCase()
}

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0
}

function percentTone(value: number) {
  if (value >= 80) return "!bg-[#94f56f]"
  if (value >= 50) return "!bg-[#ffe27a]"
  return "!bg-[#f54242]"
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

// Системная дистрибуция, one row per agent, from the field activity data (GET /api/agent-visits?view=routes):
// - ОКБ: clients whose responsible agent is the employee; АКБ: distinct clients of his counted orders in the period;
// - План / Факт: planned client-days of his route and the client-days he visited (on the route / outside it);
// - Результативность: visits that ended with an order; Системность: those on the route against the plan.
export function SystemDistributionView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [position, setPosition] = useState("")
  const [applied, setApplied] = useState({ from: monthStart(), to: today, position: "" })
  const [summary, setSummary] = useState<AgentRouteSummary | null>(null)
  const [positions, setPositions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = dashboardOpen

  useEffect(() => {
    let cancelled = false
    fetch("/api/job-positions")
      .then((response) => (response.ok ? (response.json() as Promise<PositionRef[]>) : []))
      .then((data) => {
        if (!cancelled) setPositions(Array.from(new Set(data.map((item) => item.name).filter(Boolean))))
      })
      .catch(() => {
        if (!cancelled) setPositions([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/agent-visits?view=routes&from=${applied.from}&to=${applied.to}`)
      .then((response) => (response.ok ? (response.json() as Promise<AgentRouteSummary>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setSummary(data)
      })
      .catch(() => {
        if (!cancelled) setSummary(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applied.from, applied.to])

  const rows = useMemo<Row[]>(
    () =>
      (summary?.agents ?? [])
        .filter((agent) => !applied.position || key(agent.position) === key(applied.position))
        .map((agent) => {
          const fact = agent.route.visited + agent.outside.visited
          const effective = agent.route.effective + agent.outside.effective
          return [
            agent.name, agent.supervisor, agent.okb, agent.akb, percent(agent.akb, agent.okb), agent.plan, fact, agent.route.visited, agent.outside.visited,
            percent(agent.route.visited, agent.plan), effective, agent.route.effective, agent.outside.effective, percent(effective, fact), percent(agent.route.effective, agent.plan),
          ]
        }),
    [summary, applied.position],
  )

  const totalsRow = useMemo<Row>(() => {
    const sum = (index: number) => rows.reduce((acc, row) => acc + Number(row[index]), 0)
    const [base, active, plan, fact, planned, effective, routeEffective] = [sum(2), sum(3), sum(5), sum(6), sum(7), sum(10), sum(11)]
    return [
      "Итого", "", base, active, percent(active, base), plan, fact, planned, sum(8),
      percent(planned, plan), effective, routeEffective, sum(12), percent(effective, fact), percent(routeEffective, plan),
    ]
  }, [rows])

  function downloadCsv() {
    downloadExcelTable("system-distribution.xls", [HEADERS.map((label) => t(label)), ...rows, totalsRow.map((value, index) => (index === 0 ? t(String(value)) : value))])
  }

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

  return (
    <ReportPage>
      <ReportHeader title="Системная дистрибуция" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} inDashboard={inDashboard} />

      <ReportBand>
        <ReportFilters applyDisabled={from > to} onApply={() => setApplied({ from, to, position })}>
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportListSelectField label="Должность" value={position} onChange={setPosition} options={positions} />
        </ReportFilters>

        {loading ? null : rows.length === 0 ? <ReportEmpty /> : <SystemDistributionTable rows={rows} totals={totalsRow} />}
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
          reportSlug="system-distribution"
          reportLabel="Распределение по системе"
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

function SystemDistributionTable({ rows, totals }: { rows: Row[]; totals: Row }) {
  const { t } = useLanguage()
  const [sort, setSort] = useState<{ key: number; dir: "asc" | "desc" }>({ key: 0, dir: "asc" })
  const heads = useMemo<MatrixHead[]>(
    () =>
      HEADERS_SHORT.map((label, index) => ({
        label: t(label),
        width: index < 2 ? 200 : 100,
        sortable: true,
        align: index < 2 ? "left" : "right",
      })),
    [t],
  )
  const ordered = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1
    return [...rows].sort((a, b) => {
      const x = a[sort.key]
      const y = b[sort.key]
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "ru")) * dir
    })
  }, [rows, sort])
  const toCell = (value: string | number, index: number) =>
    index === 0 ? <span className="text-[#4f71dc]">{value}</span> : typeof value === "number" ? matrixNumber(value) : value
  const matrixRows: MatrixRow[] = [
    ...ordered.map((row, rowIndex) => ({
      key: `${row[0]}-${rowIndex}`,
      cells: row.map(toCell),
      cellClass: (index: number) => (PERCENT_COLUMNS.includes(index) ? percentTone(Number(row[index])) : ""),
    })),
    { key: "total", tone: "total" as const, cells: totals.map((value, index) => (index === 0 ? t(String(value)) : typeof value === "number" ? matrixNumber(value) : value)) },
  ]
  return (
    <ReportMatrix
      heads={heads}
      headHeight={60}
      groups={[
        { title: "", span: 2 },
        { title: t("Количественная дистрибуция"), span: 3 },
        { title: t("Анализ визитов"), span: 5 },
        { title: t("Результативность"), span: 4 },
        { title: t("Системность"), span: 1 },
      ]}
      sortKey={sort.key}
      sortDir={sort.dir}
      onSort={(index) => setSort((current) => ({ key: index, dir: current.key === index && current.dir === "asc" ? "desc" : "asc" }))}
      rows={matrixRows}
    />
  )
}
