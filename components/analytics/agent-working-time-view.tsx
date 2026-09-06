"use client"

import Image from "next/image"
import { FormEvent, useEffect, useMemo, useState } from "react"
import { Download, PlusCircle } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const ALL_AGENTS = "Все агенты"
const ALL_SUPERVISORS = "Все супервайзеры"

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
  const [appliedAgent, setAppliedAgent] = useState(ALL_AGENTS)
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

  const agents = useMemo(() => [ALL_AGENTS, ...employees.map((employee) => employee.name).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"))], [employees])
  const supervisors = useMemo(() => {
    const supervisorNames = employees.filter((employee) => /супервайзер|supervisor/i.test(employee.position)).map((employee) => employee.name)
    const names = supervisorNames.length > 0 ? supervisorNames : employees.map((employee) => employee.name)
    return [ALL_SUPERVISORS, ...Array.from(new Set(names)).filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"))]
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

  function apply(event: FormEvent) {
    event.preventDefault()
    if (from <= to) setAppliedAgent(agent)
  }

  function downloadCsv() {
    downloadExcelTable("agent-working-time.xls", [
      ["Агент", "Супервайзер", "Показатель", "Дата от", "Дата до"],
      [agent, supervisor, metric, from, to],
    ])
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Время работы агента</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-md bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Download className="h-5 w-5" /> Скачать Excel
          </button>
          <button type="button" onClick={() => setDashboardOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <PlusCircle className="h-5 w-5" /> Добавить в дашборд
          </button>
        </div>
      </header>

      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className="grid gap-x-5 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-xs font-medium">
              Дата создания от
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            <label className="text-xs font-medium">
              Дата создания до
              <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            <label className="text-xs font-medium">
              Показать по
              <select value={metric} onChange={(event) => setMetric(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-white px-0 py-2 text-base font-semibold outline-none">
                <option>Время нахождения</option>
                <option>Время визита</option>
                <option>Время в пути</option>
                <option>Рабочее время</option>
              </select>
            </label>
            <label className="text-xs font-medium">
              Супервайзер
              <select value={supervisor} onChange={(event) => setSupervisor(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-white px-0 py-2 text-base font-semibold outline-none">
                {supervisors.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="text-xs font-medium md:col-span-2 xl:col-span-1">
              Агент
              <select value={agent} onChange={(event) => setAgent(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-white px-0 py-2 text-base font-semibold outline-none">
                {agents.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" disabled={from > to} className="mt-3 w-full rounded-md bg-[#6ccd8b] py-3 font-bold text-white hover:brightness-95 disabled:opacity-50">
            Применить
          </button>
        </form>

        <div className="flex min-h-[380px] flex-col items-center justify-center py-12">
          <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
          <p className="mt-7 text-lg text-slate-400">
            {appliedAgent === "Все агенты" ? "По вашему запросу ничего не найдено..." : `${appliedAgent}: данные не найдены...`}
          </p>
        </div>
      </section>

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
    </main>
  )
}
