"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

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

// Supervisor -> agent hierarchy isn't tracked anywhere in the schema
// (employees only carry a free-text "position", not a manager/supervisor
// relation), so the supervisor rollup view keeps showing an empty grouping.
const supervisorGroups: { title: string; agent: string; values: number[] }[] = []

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

function format(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value)
}

export function AgentVisitsView({ supervisorMode = false }: { supervisorMode?: boolean }) {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [range, setRange] = useState({ from: monthStart(), to: today })
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [supervisorAscending, setSupervisorAscending] = useState(true)
  const [expandedSupervisors, setExpandedSupervisors] = useState(() =>
    supervisorGroups.map((group) => group.title),
  )
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

  const totals = useMemo(
    () => ({
      route: rows.reduce(
        (sum, row) => sum.map((value, index) => value + row.route[index]) as AgentRow["route"],
        [0, 0, 0, 0, 0] as AgentRow["route"],
      ),
      outside: rows.reduce(
        (sum, row) => sum.map((value, index) => value + row.outside[index]) as AgentRow["outside"],
        [0, 0, 0, 0] as AgentRow["outside"],
      ),
    }),
    [rows],
  )
  const orderedSupervisorGroups = useMemo(
    () =>
      [...supervisorGroups].sort((left, right) =>
        supervisorAscending
          ? left.title.localeCompare(right.title, "ru")
          : right.title.localeCompare(left.title, "ru"),
      ),
    [supervisorAscending],
  )

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

        {(supervisorMode ? orderedSupervisorGroups.length : rows.length) === 0 ? (
          <ReportEmpty />
        ) : (
        <div className="mt-3 overflow-x-auto border border-slate-300 visits-scrollbar">
          <table className="w-full min-w-[1220px] border-collapse text-[16px] text-slate-800">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[360px] border-b border-r border-slate-300" />
                <th colSpan={5} className="border-b border-r border-slate-300 py-4 text-center text-lg font-semibold">
                  {t("По маршруту")}
                </th>
                <th colSpan={4} className="border-b border-slate-300 py-4 text-center text-lg font-semibold">
                  {t("Вне маршрута")}
                </th>
              </tr>
              <tr>
                <th className="border-b border-r border-slate-300 px-3 py-4 text-center">
                  {supervisorMode ? (
                    <button
                      type="button"
                      onClick={() => setSupervisorAscending((value) => !value)}
                      className="inline-flex items-center gap-3 font-semibold"
                      aria-label={t("Сортировать по супервайзеру")}
                    >
                      {t("Супервайзер")}
                      <span className="text-xs text-slate-400">{supervisorAscending ? "▲" : "▼"}</span>
                    </button>
                  ) : (
                    "Агент"
                  )}
                </th>
                {["План", "Посещено", "Результативно", "Отказано", "Продажа", "Посещено", "Результативно", "Отказано", "Продажа"].map(
                  (heading, index) => (
                    <th key={`${heading}-${index}`} className="border-b border-r border-slate-300 px-2 py-4 text-center font-medium">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {supervisorMode ? (
                <>
                  {orderedSupervisorGroups.map((group) => (
                    <Fragment key={group.title}>
                      <SupervisorGroupRow
                        title={group.title}
                        values={group.values}
                        expanded={expandedSupervisors.includes(group.title)}
                        onToggle={() =>
                          setExpandedSupervisors((current) =>
                            current.includes(group.title)
                              ? current.filter((title) => title !== group.title)
                              : [...current, group.title],
                          )
                        }
                      />
                      {expandedSupervisors.includes(group.title) && (
                        <SupervisorAgentRow title={group.agent} values={group.values} />
                      )}
                    </Fragment>
                  ))}
                </>
              ) : (
                rows.map((row, index) => (
                  <tr key={row.name} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                    <th className="border-b border-r border-slate-300 px-2 py-4 text-left font-normal">{row.name}</th>
                    {[...row.route, ...row.outside].map((value, cellIndex) => (
                      <td key={cellIndex} className="border-b border-r border-slate-300 px-2 py-4 text-right">
                        {format(value)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
              <tr className="bg-[#555] font-bold text-white">
                <th className="border-r border-slate-300 px-2 py-4 text-left">{t("Итого")}</th>
                {(supervisorMode
                  ? [0, 0, 0, 0, 0, 0, 0, 0, 0]
                  : [...totals.route, ...totals.outside]
                ).map((value, index) => (
                  <td key={index} className="border-r border-slate-300 px-2 py-4 text-right">
                    {format(value)}
                  </td>
                ))}
              </tr>
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

function SupervisorGroupRow({
  title,
  values,
  expanded,
  onToggle,
}: {
  title: string
  values: number[]
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <tr className="bg-[#555] text-white">
      <th className="border-b border-r border-slate-300 p-0 text-left font-medium">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-center px-3 py-3 text-left hover:bg-white/10"
        >
          <span className="mr-3 w-3 text-slate-300">{expanded ? "▾" : "▸"}</span>
          {title}
        </button>
      </th>
      {values.map((value, index) => (
        <td key={index} className="border-b border-r border-slate-300 px-2 py-3 text-right">
          {format(value)}
        </td>
      ))}
    </tr>
  )
}

function SupervisorAgentRow({ title, values }: { title: string; values: number[] }) {
  return (
    <tr className="bg-slate-50">
      <th className="border-b border-r border-slate-300 px-2 py-3 text-left font-normal">{title}</th>
      {values.map((value, index) => (
        <td key={index} className="border-b border-r border-slate-300 px-2 py-3 text-right">
          {format(value)}
        </td>
      ))}
    </tr>
  )
}

export function SupervisorAgentVisitsView() {
  return <AgentVisitsView supervisorMode />
}
