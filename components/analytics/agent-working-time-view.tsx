"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { nextMatrixSort } from "@/components/ref/sort-arrows"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"

/** One employee-day of GET /api/agent-visits?view=work-time (lib/agent-visits-repo.ts getWorkTime). */
type WorkTimeRow = {
  employeeId: number
  agent: string
  date: string
  /** Local "YYYY-MM-DDTHH:mm:ss.ffffff" of the first / last activity (no last: a service never ended); first / last =
   * their "HH:mm" (""). */
  firstAt: string
  lastAt: string | null
  first: string
  last: string
  /** Seconds with their fraction (Linko's moments are kept to the microsecond). */
  totalSec: number
  moments: number
  storeSec: number
  plan: number
  visitedPlan: number
  visitedOutside: number
  notVisited: number
  akb: number
  sales: number
}

/** «Показать по» → Linko's data_type: «Задачи» = today_plan (the tasks done), «Время нахождения» = service_time
 * (the stays at the clients, the default; also when the chip is cleared). */
const METRIC_TASKS = "Задачи"
const METRIC_STAYS = "Время нахождения"
const basisOf = (metric: string) => (metric === METRIC_TASKS ? "today_plan" : "service_time")

const DAY_SEC = 24 * 3600

/** Linko's duration text (a Python timedelta): 3725 → "1 ч. 2 мин.", 193 → "3 мин.", 21600 → "6 ч.", 46 → "46 сек.";
 * seconds show only under a minute. */
function duration(seconds: number, tr: (text: string) => string) {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  if (!hours && !minutes) return `${whole % 60} ${tr("сек.")}`
  return [hours ? `${hours} ${tr("ч.")}` : "", minutes ? `${minutes} ${tr("мин.")}` : ""].filter(Boolean).join(" ")
}

/** A day's durations as Linko keeps them (a timedelta, to the microsecond), within one day — a span over several days
 * loses its whole days, a negative rest wraps to 23 ч. 59 мин. —; the time outside the clients = total − time at the
 * clients when there is any, else 0. */
function dayFigures(row: WorkTimeRow) {
  // To the microsecond first (Linko's resolution), so a difference of equal spans is 0, not a float's -0.000001.
  const wrap = (seconds: number) => (((Math.round(seconds * 1e6) / 1e6) % DAY_SEC) + DAY_SEC) % DAY_SEC
  return { total: wrap(row.totalSec), store: wrap(row.storeSec), outside: row.storeSec ? wrap(row.totalSec - row.storeSec) : 0 }
}

/** A day's duration cell: a zero is "0", a part of a second "0 сек." (also a zero span between several moments of one
 * second: Linko keeps them a fraction of a second apart). */
const dayDuration = (seconds: number, tr: (text: string) => string, several = false) => (seconds > 0 ? duration(seconds, tr) : several ? `0 ${tr("сек.")}` : "0")

/** The agent row's first / last activity: the mean clock time of its days in whole seconds, cut to the minute (Linko);
 * "" when no day has one. */
function meanClock(values: Array<string | null>) {
  const stamps = values.filter((stamp): stamp is string => Boolean(stamp))
  if (!stamps.length) return ""
  const seconds = stamps.map((stamp) => Number(stamp.slice(11, 13)) * 3600 + Number(stamp.slice(14, 16)) * 60 + (Math.floor(Number(stamp.slice(17))) || 0))
  const mean = Math.floor(seconds.reduce((sum, value) => sum + value, 0) / seconds.length)
  return `${String(Math.floor(mean / 3600)).padStart(2, "0")}:${String(Math.floor((mean % 3600) / 60)).padStart(2, "0")}`
}

/** The 11 value columns of a day row (texts and numbers). */
function dayValues(row: WorkTimeRow, tr: (text: string) => string): Array<string | number> {
  const figures = dayFigures(row)
  return [
    row.first,
    row.last,
    dayDuration(figures.total, tr, row.moments > 1),
    dayDuration(figures.store, tr),
    dayDuration(figures.outside, tr),
    row.plan,
    row.visitedPlan,
    row.visitedOutside,
    row.notVisited,
    row.akb,
    row.sales,
  ]
}

/** The 11 value columns of an agent row: mean clock times, the days' whole seconds and figures added up. */
function agentValues(days: WorkTimeRow[], tr: (text: string) => string): Array<string | number> {
  const figures = days.map(dayFigures)
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  return [
    meanClock(days.map((row) => row.firstAt)),
    meanClock(days.map((row) => row.lastAt)),
    duration(sum(figures.map((day) => Math.floor(day.total))), tr),
    duration(sum(figures.map((day) => Math.floor(day.store))), tr),
    duration(sum(figures.map((day) => Math.floor(day.outside))), tr),
    sum(days.map((row) => row.plan)),
    sum(days.map((row) => row.visitedPlan)),
    sum(days.map((row) => row.visitedOutside)),
    sum(days.map((row) => row.notVisited)),
    sum(days.map((row) => row.akb)),
    sum(days.map((row) => row.sales)),
  ]
}

const dayLabel = (date: string) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`

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
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [metric, setMetric] = useState(METRIC_STAYS)
  const [supervisor, setSupervisor] = useState(ALL_SUPERVISORS)
  const [agent, setAgent] = useState(ALL_AGENTS)
  const [applied, setApplied] = useState({ from: monthStart(), to: today, basis: basisOf(METRIC_STAYS), agent: ALL_AGENTS, supervisor: ALL_SUPERVISORS })
  const [data, setData] = useState<WorkTimeRow[]>([])
  const [supervisorOf, setSupervisorOf] = useState<Record<string, string>>({})
  const [collapsed, setCollapsed] = useState<number[]>([])
  // Agents in Linko's order (by employee id) at first; a click on «Агент»: by name ascending, descending, none.
  const [sort, setSort] = useState<{ key: number | null; dir: "asc" | "desc" }>({ key: null, dir: "asc" })
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [employees, setEmployees] = useState<{ name: string; position: string }[]>([])
  const overlayOpen = dashboardOpen

  // Real employees stand in for "agents"/"supervisors" (this app has no separate field-force-automation domain).
  // The agent / supervisor filters list only the employees of the reader's field scope (an agent
  // sees their own name, never the other agents'): GET /api/field-activity/people.
  useEffect(() => {
    let cancelled = false
    fetch("/api/field-activity/people")
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
    fetch(`/api/agent-visits?view=work-time&begin=${applied.from}&end=${applied.to}&dataType=${applied.basis}`)
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
  }, [applied.from, applied.to, applied.basis])

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

  /** The agents of the applied filters (by employee id, or by name once «Агент» sorts them), each with its days in date order. */
  const groups = useMemo(() => {
    const byAgent = new Map<number, WorkTimeRow[]>()
    for (const row of data) {
      if (applied.agent && row.agent !== applied.agent) continue
      if (applied.supervisor && supervisorOf[row.agent] !== applied.supervisor) continue
      byAgent.set(row.employeeId, [...(byAgent.get(row.employeeId) ?? []), row])
    }
    const byName = sort.key === 0
    const dir = byName && sort.dir === "desc" ? -1 : 1
    return [...byAgent.entries()]
      .map(([employeeId, days]) => ({ employeeId, agent: days[0].agent, days: [...days].sort((a, b) => a.date.localeCompare(b.date)) }))
      .sort((a, b) => (byName ? (a.agent.localeCompare(b.agent, "ru") || a.employeeId - b.employeeId) * dir : a.employeeId - b.employeeId))
  }, [data, applied.agent, applied.supervisor, supervisorOf, sort])

  const matrixRows = useMemo<MatrixRow[]>(() => {
    const cell = (value: string | number) => (typeof value === "number" ? matrixNumber(value) : value)
    const out: MatrixRow[] = []
    for (const group of groups) {
      const open = !collapsed.includes(group.employeeId)
      out.push({
        key: `g-${group.employeeId}`,
        tone: "dark",
        onClick: () => setCollapsed((current) => (open ? [...current, group.employeeId] : current.filter((id) => id !== group.employeeId))),
        cells: [
          <span key="n" className="inline-flex items-center gap-[6px]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d={open ? "M7 10l5 5 5-5z" : "M10 17l5-5-5-5z"} /></svg>
            {group.agent}
          </span>,
          ...agentValues(group.days, t).map(cell),
        ],
      })
      if (open) {
        for (const row of group.days) {
          out.push({ key: `d-${group.employeeId}-${row.date}`, tone: "sub", cells: [dayLabel(row.date), ...dayValues(row, t).map(cell)] })
        }
      }
    }
    return out
  }, [groups, collapsed, t])

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

  /** The table as it is shown: each agent's row, then its days. */
  function downloadCsv() {
    downloadExcelTable("agent-working-time.xls", [
      HEADS,
      ...groups.flatMap((group) => [[group.agent, ...agentValues(group.days, t)], ...group.days.map((row) => [dayLabel(row.date), ...dayValues(row, t)])]),
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title="Время работы агента" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (from <= to) setApplied({ from, to, basis: basisOf(metric), agent, supervisor })
          }}
          applyDisabled={from > to}
        >
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportChipField label="Показать по" value={metric} options={[METRIC_TASKS, METRIC_STAYS]} onChange={setMetric} />
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
            onSort={(index) => setSort((current) => nextMatrixSort(current, index))}
            rows={matrixRows}
          />
        )}
      </ReportBand>

      {overlayOpen && (
        <button type="button" aria-label={t("Закрыть окно")} onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] cursor-default bg-black/55" />
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
