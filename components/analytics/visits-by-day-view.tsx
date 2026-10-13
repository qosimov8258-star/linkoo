"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Download, PlusCircle, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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

  function apply(event: FormEvent) {
    event.preventDefault()
    if (draftFrom <= draftTo) setRange({ from: draftFrom, to: draftTo })
  }

  function downloadVisitsCsv() {
    const rows = [
      ["Агент", ...days.map((day) => String(day.day))],
      ...agents.map((agent) => [agent, ...days.map((day) => (visitedByAgentAndDay.get(agent)?.has(day.iso) ? "1" : "0"))]),
    ]
    downloadExcelTable("visits-by-day.xls", rows)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-slate-100 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Визиты по дням</h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadVisitsCsv}
            className="inline-flex items-center gap-2 rounded-md bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95"
          >
            <Download className="h-5 w-5" />
            Скачать Excel
          </button>
          <button
            type="button"
            onClick={() => setDashboardOpen(true)}
            className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white hover:brightness-95"
          >
            <PlusCircle className="h-5 w-5" />
            {inDashboard ? "Добавлено в дашборд" : "Добавить в дашборд"}
          </button>
        </div>
      </header>

      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className="grid gap-4 md:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_minmax(260px,1fr)]">
            <label className="text-xs font-medium text-slate-800">
              Дата создания от
              <input
                type="date"
                value={draftFrom}
                max={draftTo}
                onChange={(event) => setDraftFrom(event.target.value)}
                className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue"
              />
            </label>
            <label className="text-xs font-medium text-slate-800">
              Дата создания до
              <input
                type="date"
                value={draftTo}
                min={draftFrom}
                onChange={(event) => setDraftTo(event.target.value)}
                className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue"
              />
            </label>
            <label className="text-xs font-medium text-slate-800">
              Колонка
              <span className="mt-1 flex min-h-10 items-center border-b border-slate-300">
                <span className="inline-flex items-center gap-2 bg-[#5c6df3] px-2 py-1 font-semibold text-white">
                  <X className="h-3 w-3" />
                  Визит
                </span>
              </span>
            </label>
          </div>
          <button
            type="submit"
            disabled={draftFrom > draftTo}
            className="mt-3 w-full rounded-md bg-[#71ce87] py-3 font-bold text-white hover:brightness-95 disabled:opacity-50"
          >
            Применить
          </button>
        </form>

        <div className="mt-3 overflow-x-auto border border-slate-300 visits-scrollbar">
          <table className="min-w-max border-collapse text-[15px] text-slate-800">
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
                  Агент
                </th>
                {days.map((day) => (
                  <th key={day.iso} className="h-14 border-b border-r border-slate-300 text-center font-semibold">
                    Визит
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
              {agents.length === 0 && (
                <tr>
                  <td colSpan={days.length + 1} className="border-b border-slate-300 px-3 py-10 text-center text-slate-400">
                    Нет данных по маршрутам агентов
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

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
    </main>
  )
}
