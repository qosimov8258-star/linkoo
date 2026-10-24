"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportListSelectField, ReportPage } from "@/components/ref/report-kit"

type Row = (string | number)[]

type AgentRoute = {
  agent: string
  routeDate: string
  planVisits: number
  routeVisited: number
  routeEffective: number
  routeSales: number
  outsideVisited: number
  outsideEffective: number
  outsideSales: number
}

type EmployeeRef = { name: string; login: string; position: string }
type ClientRef = { agent: string }
type PositionRef = { name: string }

const HEADERS = [
  "Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит",
  "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту",
  "Вне маршрута", "Результативность, %", "Системность, %",
]
const PERCENT_COLUMNS = [4, 9, 13, 14]
const HEADERS_SHORT = ["Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит", "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту", "Вне маршрута", "%", "%"]

function key(name: string) {
  return name.trim().toLowerCase()
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

function format(value: string | number) {
  return typeof value === "number" ? new Intl.NumberFormat("ru-RU").format(value) : value
}

export function SystemDistributionView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [position, setPosition] = useState("")
  const [applied, setApplied] = useState({ from: monthStart(), to: today, position: "" })
  const [routes, setRoutes] = useState<AgentRoute[]>([])
  const [employees, setEmployees] = useState<EmployeeRef[]>([])
  const [clients, setClients] = useState<ClientRef[]>([])
  const [positions, setPositions] = useState<string[]>([])
  const [supervisors, setSupervisors] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = dashboardOpen

  useEffect(() => {
    let cancelled = false
    async function load<T>(url: string): Promise<T[]> {
      try {
        const response = await fetch(url)
        return response.ok ? ((await response.json()) as T[]) : []
      } catch {
        return []
      }
    }
    Promise.all([
      load<AgentRoute>("/api/agent-routes"),
      load<EmployeeRef>("/api/employees"),
      load<ClientRef>("/api/clients"),
      load<PositionRef>("/api/job-positions"),
      load<{ agent: string; supervisor: string }>("/api/agent-supervisors"),
    ]).then(([routeData, employeeData, clientData, positionData, supervisorData]) => {
      if (cancelled) return
      setSupervisors(Object.fromEntries(supervisorData.map((item) => [key(item.agent), item.supervisor])))
      setRoutes(routeData)
      setEmployees(employeeData)
      setClients(clientData)
      setPositions(Array.from(new Set(positionData.map((item) => item.name))))
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // One row per agent: visits from the per-day route summaries inside the
  // applied period, ОКБ from the clients assigned to the agent. АКБ counts the
  // base clients the agent actually sold to (orders carry no year, so sales
  // visits are the period-aware signal), capped by ОКБ.
  const rows = useMemo<Row[]>(() => {
    const positionByAgent = new Map<string, string>()
    for (const employee of employees) {
      positionByAgent.set(key(employee.name), employee.position)
      if (employee.login) positionByAgent.set(key(employee.login), employee.position)
    }
    const baseByAgent = new Map<string, number>()
    for (const client of clients) baseByAgent.set(key(client.agent), (baseByAgent.get(key(client.agent)) ?? 0) + 1)

    const totals = new Map<string, { name: string; plan: number; route: number; outside: number; routeEff: number; outsideEff: number; sales: number; routeSales: number }>()
    for (const route of routes) {
      if (route.routeDate < applied.from || route.routeDate > applied.to) continue
      if (applied.position && positionByAgent.get(key(route.agent)) !== applied.position) continue
      const entry = totals.get(key(route.agent)) ?? { name: route.agent, plan: 0, route: 0, outside: 0, routeEff: 0, outsideEff: 0, sales: 0, routeSales: 0 }
      entry.plan += route.planVisits
      entry.route += route.routeVisited
      entry.outside += route.outsideVisited
      entry.routeEff += route.routeEffective
      entry.outsideEff += route.outsideEffective
      entry.sales += route.routeSales + route.outsideSales
      entry.routeSales += route.routeSales
      totals.set(key(route.agent), entry)
    }

    return Array.from(totals.entries())
      .sort(([, a], [, b]) => a.name.localeCompare(b.name, "ru"))
      .map(([agentKey, e]) => {
        const base = baseByAgent.get(agentKey) ?? 0
        const active = Math.min(base, e.sales)
        const fact = e.route + e.outside
        const effective = e.routeEff + e.outsideEff
        return [
          e.name, supervisors[agentKey] ?? "", base, active, percent(active, base), e.plan, fact, e.route, e.outside,
          percent(e.route, e.plan), effective, e.routeEff, e.outsideEff, percent(effective, fact), percent(e.routeSales, e.plan),
        ]
      })
  }, [routes, employees, clients, applied, supervisors])

  const totalsRow = useMemo<Row>(() => {
    const sum = (index: number) => rows.reduce((acc, row) => acc + Number(row[index]), 0)
    const [base, active, plan, fact, planned, effective] = [sum(2), sum(3), sum(5), sum(6), sum(7), sum(10)]
    const routeSales = rows.reduce((acc, row) => acc + (Number(row[14]) / 100) * Number(row[5]), 0)
    return [
      "Итого", "", base, active, percent(active, base), plan, fact, planned, sum(8),
      percent(planned, plan), effective, sum(11), sum(12), percent(effective, fact), percent(routeSales, plan),
    ]
  }, [rows])

  function downloadCsv() {
    downloadExcelTable("system-distribution.xls", [HEADERS, ...rows, totalsRow])
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
          aria-label="Окнони yopish"
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
    ...ordered.map((row) => ({
      key: String(row[0]),
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
