"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import type { AgentRouteSummary } from "@/lib/agent-visits-repo"
import { ReportMatrix, matrixNumber, type MatrixHead, type MatrixRow } from "@/components/ref/report-matrix"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"

type AgentRow = {
  employeeId: number
  name: string
  supervisorId: number | null
  supervisor: string
  route: [number, number, number, number, number]
  outside: [number, number, number, number]
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

const SUB_HEADS = ["План", "Посещено", "Результативно", "Отказано", "Продажа", "Посещено", "Результативно", "Отказано", "Продажа"]
const NO_SUPERVISOR = "Не указано"

// Визиты агента / Визиты агентов по супервайзерам: per agent the plan of the route and the visits on it,
// plus the visits outside it, from the field activity data (GET /api/agent-visits?view=routes, the same
// visits and route plans as Активность / Отслеживание). Продажа = counted orders in the base currency.
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

  // [План, Посещено, Результативно, Отказано, Продажа] on the route, [Посещено, Результативно, Отказано, Продажа] outside it.
  const rows = useMemo<AgentRow[]>(
    () =>
      (summary?.agents ?? [])
        .filter((agent) => agent.plan > 0 || agent.route.visited + agent.outside.visited > 0)
        .map((agent) => ({
          employeeId: agent.employeeId,
          name: agent.name,
          supervisorId: agent.supervisorId,
          supervisor: agent.supervisor,
          route: [agent.plan, agent.route.visited, agent.route.effective, agent.route.refused, agent.route.sales],
          outside: [agent.outside.visited, agent.outside.effective, agent.outside.refused, agent.outside.sales],
        })),
    [summary],
  )

  function downloadCsv() {
    const sales = `${t("Продажа")}${summary?.baseCurrency ? `, ${summary.baseCurrency}` : ""}`
    const header = [
      t(supervisorMode ? "Супервайзер" : "Агент"),
      ...(supervisorMode ? [t("Агент")] : []),
      t("План"),
      `${t("Посещено")} (${t("По маршруту")})`,
      `${t("Результативно")} (${t("По маршруту")})`,
      `${t("Отказано")} (${t("По маршруту")})`,
      `${sales} (${t("По маршруту")})`,
      `${t("Посещено")} (${t("Вне маршрута")})`,
      `${t("Результативно")} (${t("Вне маршрута")})`,
      `${t("Отказано")} (${t("Вне маршрута")})`,
      `${sales} (${t("Вне маршрута")})`,
    ]
    const body = rows.map((row) => [
      ...(supervisorMode ? [row.supervisor || t(NO_SUPERVISOR)] : []),
      row.name,
      ...row.route,
      ...row.outside,
    ])
    downloadExcelTable("agent-visits.xls", [header, ...body])
  }

  const heads = useMemo<MatrixHead[]>(
    () => [
      { label: t(supervisorMode ? "Супервайзер" : "Агент"), width: supervisorMode ? 300 : 400, sortable: true, align: "left" },
      ...SUB_HEADS.map((label) => ({ label: t(label), width: 100, sortable: true })),
    ],
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
      const ordered = rows.map((row) => ({ key: row.employeeId, name: row.name, values: flat(row) })).sort(compare)
      return [
        ...ordered.map((row) => ({ key: String(row.key), cells: [row.name, ...fmt(row.values)] })),
        { key: "total", tone: "total" as const, cells: [t("Итого"), ...fmt(sum(ordered.map((row) => row.values)))] },
      ]
    }

    // Grouped by the supervisor set on the employee card (by id); agents without one under "Не указано".
    const groups = new Map<string, { name: string; agents: { key: number; name: string; values: number[] }[] }>()
    for (const row of rows) {
      const groupKey = row.supervisorId === null ? "none" : String(row.supervisorId)
      const group = groups.get(groupKey) ?? { name: row.supervisorId === null ? t(NO_SUPERVISOR) : row.supervisor, agents: [] }
      group.agents.push({ key: row.employeeId, name: row.name, values: flat(row) })
      groups.set(groupKey, group)
    }
    const orderedGroups = [...groups.entries()]
      .map(([key, group]) => ({ key, name: group.name, agents: group.agents, values: sum(group.agents.map((agent) => agent.values)) }))
      .sort(compare)
    const out: MatrixRow[] = []
    for (const group of orderedGroups) {
      const open = !collapsed.includes(group.key)
      out.push({
        key: `g-${group.key}`,
        tone: "dark",
        onClick: () => setCollapsed((current) => (open ? [...current, group.key] : current.filter((key) => key !== group.key))),
        cells: [
          <span key="n" className="inline-flex items-center gap-[6px]">
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white">
              <path d={open ? "M7 10l5 5 5-5z" : "M10 17l5-5-5-5z"} />
            </svg>
            {group.name}
          </span>,
          ...fmt(group.values),
        ],
      })
      if (open) {
        for (const agent of [...group.agents].sort(compare)) out.push({ key: `a-${agent.key}`, tone: "sub", cells: [agent.name, ...fmt(agent.values)] })
      }
    }
    out.push({ key: "total", tone: "dark", cells: [t("Итого"), ...fmt(sum(orderedGroups.map((group) => group.values)))] })
    return out
  }, [rows, sort, supervisorMode, collapsed, t])

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
          aria-label={t("Закрыть окно")}
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
