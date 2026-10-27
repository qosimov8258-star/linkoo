"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportChipField, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"

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
      ["Агент", "Супервайзер", "Показатель", "Дата от", "Дата до"],
      [agent, supervisor, metric, from, to],
    ])
  }

  return (
    <ReportPage>
      <ReportHeader title="Время работы агента" onExcel={downloadCsv} onDashboard={() => setDashboardOpen(true)} />

      <ReportBand>
        <ReportFilters
          onApply={() => {
            if (from <= to) setAppliedAgent(agent)
          }}
          applyDisabled={from > to}
        >
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportChipField label="Показать по" value={metric} options={["Время нахождения", "Время визита", "Время в пути", "Рабочее время"]} onChange={setMetric} />
          <ReportSelectField label="Супервайзер" value={supervisor} onChange={setSupervisor} options={supervisors} />
          <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={agents} />
        </ReportFilters>

        <ReportEmpty text={appliedAgent ? `${appliedAgent}: данные не найдены...` : undefined} />
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
