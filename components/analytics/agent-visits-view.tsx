"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"

type AgentRow = {
  name: string
  route: [number, number, number, number, number]
  outside: [number, number, number, number]
}

type AgentRoute = {
  agent: string
  routeDate: string
  planVisits: number
  routeVisited: number
  routeEffective: number
  routeRefused: number
  routeSales: number
  outsideVisited: number
  outsideEffective: number
  outsideRefused: number
  outsideSales: number
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

export function AgentVisitsView({ supervisorMode = false }: { supervisorMode?: boolean }) {
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [range, setRange] = useState({ from: monthStart(), to: today })
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const { t } = useLanguage()
  const [sort, setSort] = useState<{ key: number; dir: "asc" | "desc" }>({ key: 0, dir: "asc" })
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [supervisors, setSupervisors] = useState<Record<string, string>>({})
  const [agentRoutes, setAgentRoutes] = useState<AgentRoute[]>([])
  const overlayOpen = dashboardOpen

  useEffect(() => {
    let cancelled = false
    fetch("/api/agent-routes")
      .then((response) => (response.ok ? (response.json() as Promise<AgentRoute[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setAgentRoutes(data)
      })
      .catch(() => {
        if (!cancelled) setAgentRoutes([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!supervisorMode) return
    let cancelled = false
    fetch("/api/agent-supervisors")
      .then((response) => (response.ok ? (response.json() as Promise<{ agent: string; supervisor: string }[]>) : Promise.reject()))
      .then((data) => {
        if (!cancelled) setSupervisors(Object.fromEntries(data.map((item) => [item.agent, item.supervisor])))
      })
      .catch(() => {
        if (!cancelled) setSupervisors({})
      })
    return () => {
      cancelled = true
    }
  }, [supervisorMode])

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

  // Aggregates the real per-day agent_routes rows within the selected date
  // range into the [План, Посещено, Результативно, Отказано, Продажа] shape
  // this view renders, split into route vs. outside-of-route columns.
  const rows = useMemo<AgentRow[]>(() => {
    const byAgent = new Map<string, AgentRow>()
    for (const route of agentRoutes) {
      if (route.routeDate < range.from || route.routeDate > range.to) continue
      const existing = byAgent.get(route.agent) ?? {
        name: route.agent,
        route: [0, 0, 0, 0, 0] as AgentRow["route"],
        outside: [0, 0, 0, 0] as AgentRow["outside"],
      }
      existing.route = [
        existing.route[0] + route.planVisits,
        existing.route[1] + route.routeVisited,
        existing.route[2] + route.routeEffective,
        existing.route[3] + route.routeRefused,
        existing.route[4] + route.routeSales,
      ]
      existing.outside = [
        existing.outside[0] + route.outsideVisited,
        existing.outside[1] + route.outsideEffective,
        existing.outside[2] + route.outsideRefused,
        existing.outside[3] + route.outsideSales,
      ]
      byAgent.set(route.agent, existing)
    }
    return Array.from(byAgent.values()).sort((a, b) => a.name.localeCompare(b.name, "ru"))
  }, [agentRoutes, range])

  function downloadCsv() {
    const header = [
      "Агент",
      "План",
      "Посещено по маршруту",
      "Результативно по маршруту",
      "Отказано по маршруту",
      "Продажа по маршруту",
      "Посещено вне маршрута",
      "Результативно вне маршрута",
      "Отказано вне маршрута",
      "Продажа вне маршрута",
    ]
    downloadExcelTable("agent-visits.xls", [header, ...rows.map((row) => [row.name, ...row.route, ...row.outside])])
  }

  const SUB_HEADS = ["План", "Посещено", "Результативно", "Отказано", "Продажа", "Посещено", "Результативно", "Отказано", "Продажа"]
  const heads = useMemo<MatrixHead[]>(
    () => [
      { label: t(supervisorMode ? "Супервайзер" : "Агент"), width: supervisorMode ? 300 : 400, sortable: true, align: "left" },
      ...SUB_HEADS.map((label) => ({ label: t(label), width: 100, sortable: true })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, supervisorMode],
  )
  const flat = (row: AgentRow) => [...row.route, ...row.outside]

  const matrixRows = useMemo<MatrixRow[]>(() => {
    const dir = sort.dir === "asc" ? 1 : -1
    const compare = (a: { name: string; values: number[] }, b: { name: string; values: number[] }) =>
      (sort.key === 0 ? a.name.localeCompare(b.name, "ru") : (a.values[sort.key - 1] ?? 0) - (b.values[sort.key - 1] ?? 0)) * dir
    const sum = (list: number[][]) => SUB_HEADS.map((_, index) => list.reduce((acc, values) => acc + (values[index] ?? 0), 0))
    const fmt = (values: number[]) => values.map((value) => matrixNumber(value))

    if (!supervisorMode) {
      const ordered = [...rows].map((row) => ({ name: row.name, values: flat(row) })).sort(compare)
      return [
        ...ordered.map((row) => ({ key: row.name, cells: [row.name, ...fmt(row.values)] })),
        { key: "total", tone: "total" as const, cells: [<span key="t" data-no-translate>Итого</span>, ...fmt(sum(ordered.map((row) => row.values)))] },
      ]
    }

    const groups = new Map<string, { name: string; values: number[] }[]>()
    for (const row of rows) {
      const supervisor = supervisors[row.name] || "Не указано"
      groups.set(supervisor, [...(groups.get(supervisor) ?? []), { name: row.name, values: flat(row) }])
    }
    const orderedGroups = [...groups.entries()]
      .map(([name, agents]) => ({ name, agents, values: sum(agents.map((agent) => agent.values)) }))
      .sort(compare)
    const out: MatrixRow[] = []
    for (const group of orderedGroups) {
      const open = !collapsed.includes(group.name)
      out.push({
        key: `g-${group.name}`,
        tone: "dark",
        onClick: () => setCollapsed((current) => (open ? [...current, group.name] : current.filter((name) => name !== group.name))),
        cells: [
          <span key="n" className="inline-flex items-center gap-[6px]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d={open ? "M7 10l5 5 5-5z" : "M10 17l5-5-5-5z"} />
            </svg>
            {group.name === "Не указано" ? t(group.name) : group.name}
          </span>,
          ...fmt(group.values),
        ],
      })
      if (open) {
        for (const agent of [...group.agents].sort(compare)) out.push({ key: `a-${agent.name}`, tone: "sub", cells: [agent.name, ...fmt(agent.values)] })
      }
    }
    out.push({ key: "total", tone: "dark", cells: [<span key="t" data-no-translate>Итого</span>, ...fmt(sum(orderedGroups.map((group) => group.values)))] })
    return out
  }, [rows, sort, supervisorMode, supervisors, collapsed, t])

  return (
    <ReportPage>
      <ReportHeader
        title={supervisorMode ? "Визиты агентов по супервайзерам" : "Визиты агента"}
        onExcel={downloadCsv}
        onDashboard={() => setDashboardOpen(true)}
        inDashboard={inDashboard}
      />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (draftFrom <= draftTo) setRange({ from: draftFrom, to: draftTo })
          }}
          applyDisabled={draftFrom > draftTo}
        >
          <ReportDateField label="Дата создания от" value={draftFrom} max={draftTo} onChange={setDraftFrom} />
          <ReportDateField label="Дата создания до" value={draftTo} min={draftFrom} onChange={setDraftTo} />
        </ReportFilters>

        {rows.length === 0 ? (
          <ReportEmpty />
        ) : (
          <ReportMatrix
            heads={heads}
            groups={[{ title: "", span: 1 }, { title: t("По маршруту"), span: 5 }, { title: t("Вне маршрута"), span: 4 }]}
            sortKey={sort.key}
            sortDir={sort.dir}
            onSort={(index) => setSort((current) => ({ key: index, dir: current.key === index && current.dir === "asc" ? "desc" : "asc" }))}
            rows={matrixRows}
          />
        )}
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
          reportSlug="agent-visits"
          reportLabel="Визиты агента"
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

export function SupervisorAgentVisitsView() {
  return <AgentVisitsView supervisorMode />
}
