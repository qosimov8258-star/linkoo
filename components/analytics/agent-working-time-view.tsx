"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"

type WorkTimeRow = {
  agent: string
  date: string
  first: string
  last: string
  totalSec: number
  storeSec: number
  plan: number
  visitedPlan: number
  visitedOutside: number
  notVisited: number
  akb: number
  sales: number
}

/** 11 -> "11 сек.", 193 -> "3 мин. 13 сек.", 3725 -> "1 ч. 2 мин. 5 сек." */
function duration(seconds: number, tr: (text: string) => string) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const rest = seconds % 60
  return [hours ? `${hours} ${tr("ч.")}` : "", minutes ? `${minutes} ${tr("мин.")}` : "", rest || !seconds ? `${rest} ${tr("сек.")}` : ""].filter(Boolean).join(" ")
}

const ALL_AGENTS = ""
const ALL_SUPERVISORS = ""

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

export function AgentWorkingTimeView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [metric, setMetric] = useState("Время нахождения")
  const [supervisor, setSupervisor] = useState(ALL_SUPERVISORS)
  const [agent, setAgent] = useState(ALL_AGENTS)
  const { t } = useLanguage()
  const [applied, setApplied] = useState({ from: monthStart(), to: today, agent: ALL_AGENTS, supervisor: ALL_SUPERVISORS })
  const [data, setData] = useState<WorkTimeRow[]>([])
  const [supervisorOf, setSupervisorOf] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [sort, setSort] = useState<{ key: number; dir: "asc" | "desc" }>({ key: 0, dir: "asc" })
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [employees, setEmployees] = useState<{ name: string; position: string }[]>([])
  const overlayOpen = dashboardOpen

  // Real employees stand in for "agents"/"supervisors" (this app has no
  // separate field-force-automation domain); no table anywhere records
  // actual clock-in/out or time-in-store, so the result panel below keeps
  // showing "not found" rather than fabricated hours — see report notes.
  useEffect(() => {
    let cancelled = false
    fetch("/api/employees")
      .then((response) => (response.ok ? (response.json() as Promise<{ name: string; position: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setEmployees(data)
      })
      .catch(() => {
        if (!cancelled) setEmployees([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/agent-visits?view=work-time&begin=${applied.from}&end=${applied.to}`)
      .then((response) => (response.ok ? (response.json() as Promise<WorkTimeRow[]>) : Promise.reject()))
      .then((rows) => {
        if (!cancelled) setData(rows)
      })
      .catch(() => {
        if (!cancelled) setData([])
      })
    return () => {
      cancelled = true
    }
  }, [applied.from, applied.to])

  useEffect(() => {
    fetch("/api/agent-supervisors")
      .then((response) => (response.ok ? (response.json() as Promise<{ agent: string; supervisor: string }[]>) : Promise.reject()))
      .then((list) => setSupervisorOf(Object.fromEntries(list.map((item) => [item.agent, item.supervisor]))))
      .catch(() => setSupervisorOf({}))
  }, [])

  const HEADS = ["Агент", "Первая активность", "Последняя активность", "Общее рабочее время", "Время в магазине", "Время вне магазина", "План", "Посещенные по плану", "Посещенные вне плана", "Не посещенные", "АКБ", "Сумма заказов"]
  const heads = useMemo<MatrixHead[]>(
    () => HEADS.map((label, index) => ({ label: t(label), width: index === 0 ? 300 : 100, sortable: index === 0, align: index <= 5 ? "left" : "right" })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t],
  )

  const matrixRows = useMemo<MatrixRow[]>(() => {
    const byAgent = new Map<string, WorkTimeRow[]>()
    for (const row of data) {
      if (applied.agent && row.agent !== applied.agent) continue
      if (applied.supervisor && supervisorOf[row.agent] !== applied.supervisor) continue
      byAgent.set(row.agent, [...(byAgent.get(row.agent) ?? []), row])
    }
    const dir = sort.dir === "asc" ? 1 : -1
    const out: MatrixRow[] = []
    for (const [agent, list] of [...byAgent.entries()].sort(([a], [b]) => a.localeCompare(b, "ru") * dir)) {
      const sum = (pick: (row: WorkTimeRow) => number) => list.reduce((acc, row) => acc + pick(row), 0)
      const total = sum((row) => row.totalSec)
      const store = sum((row) => row.storeSec)
      const open = !collapsed.includes(agent)
      out.push({
        key: `g-${agent}`,
        tone: "dark",
        onClick: () => setCollapsed((current) => (open ? [...current, agent] : current.filter((name) => name !== agent))),
        cells: [
          <span key="n" className="inline-flex items-center gap-[6px]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d={open ? "M7 10l5 5 5-5z" : "M10 17l5-5-5-5z"} /></svg>
            {agent}
          </span>,
          list.map((row) => row.first).sort()[0],
          list.map((row) => row.last).sort().slice(-1)[0],
          duration(total, t),
          duration(store, t),
          duration(Math.max(total - store, 0), t),
          matrixNumber(sum((row) => row.plan)),
          matrixNumber(sum((row) => row.visitedPlan)),
          matrixNumber(sum((row) => row.visitedOutside)),
          matrixNumber(sum((row) => row.notVisited)),
          matrixNumber(sum((row) => row.akb)),
          matrixNumber(sum((row) => row.sales)),
        ],
      })
      if (open) {
        for (const row of [...list].sort((a, b) => a.date.localeCompare(b.date))) {
          out.push({
            key: `d-${agent}-${row.date}`,
            tone: "sub",
            cells: [
              `${row.date.slice(8, 10)}.${row.date.slice(5, 7)}.${row.date.slice(0, 4)}`,
              row.first,
              row.last,
              duration(row.totalSec, t),
              duration(row.storeSec, t),
              matrixNumber(Math.max(row.totalSec - row.storeSec, 0)),
              matrixNumber(row.plan),
              matrixNumber(row.visitedPlan),
              matrixNumber(row.visitedOutside),
              matrixNumber(row.notVisited),
              matrixNumber(row.akb),
              matrixNumber(row.sales),
            ],
          })
        }
      }
    }
    return out
  }, [data, applied.agent, applied.supervisor, supervisorOf, sort, collapsed, t])

  const agents = useMemo(() => [...employees.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"))], [employees])
  const supervisors = useMemo(() => {
    const supervisorNames = employees.filter((employee) => /супервайзер|supervisor/i.test(employee.position)).map((employee) => employee.name)
    const names = supervisorNames.length > 0 ? supervisorNames : employees.map((employee) => employee.name)
    return Array.from(new Set(names)).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"))
  }, [employees])

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

  function downloadCsv() {
    downloadExcelTable("agent-working-time.xls", [
      HEADS,
      ...data.filter((row) => (!applied.agent || row.agent === applied.agent) && (!applied.supervisor || supervisorOf[row.agent] === applied.supervisor)).map((row) => [row.agent, row.first, row.last, row.totalSec, row.storeSec, Math.max(row.totalSec - row.storeSec, 0), row.plan, row.visitedPlan, row.visitedOutside, row.notVisited, row.akb, row.sales]),
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title="Время работы агента" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (from <= to) setApplied({ from, to, agent, supervisor })
          }}
          applyDisabled={from > to}
        >
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportChipField label="Показать по" value={metric} options={["Время нахождения", "Время визита", "Время в пути", "Рабочее время"]} onChange={setMetric} />
          <ReportSelectField label="Супервайзер" value={supervisor} onChange={setSupervisor} options={supervisors} />
          <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={agents} />
        </ReportFilters>

        {matrixRows.length === 0 ? (
          <ReportEmpty />
        ) : (
          <ReportMatrix
            heads={heads}
            headHeight={84}
            headLeading={20}
            sortKey={sort.key}
            sortDir={sort.dir}
            onSort={() => setSort((current) => ({ key: 0, dir: current.dir === "asc" ? "desc" : "asc" }))}
            rows={matrixRows}
          />
        )}
      </ReportBand>

      {overlayOpen && (
        <button type="button" aria-label="Закрыть окно" onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />
      )}

      {dashboardOpen && (
        <DashboardDialog
          reportSlug="agent-working-time"
          reportLabel="Рабочее время агента"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
        />
      )}
    </ReportPage>
  )
}
