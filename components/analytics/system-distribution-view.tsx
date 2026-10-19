"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"

const data: (string | number)[][] = []

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

function downloadCsv() {
  const header = [
    "Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит",
    "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту",
    "Вне маршрута", "Результативность, %", "Системность, %",
  ]
  downloadExcelTable("system-distribution.xls", [header, ...data])
}

export function SystemDistributionView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [position, setPosition] = useState("")
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const overlayOpen = dashboardOpen

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
        <ReportFilters applyDisabled={from > to}>
          <ReportDateField label="Дата создания от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата создания до" value={to} min={from} onChange={setTo} />
          <ReportSelectField label="Должность" value={position} onChange={setPosition} options={["Агент", "Супервайзер"]} />
        </ReportFilters>

        {data.length === 0 ? <ReportEmpty /> : <SystemDistributionTable />}
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

function SystemDistributionTable() {
  const totals = ["Итого", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  return (
        <div className="mt-3 overflow-x-auto border border-slate-300 visits-scrollbar">
          <table className="min-w-[1840px] border-collapse text-[13px] text-slate-800">
            <thead className="bg-slate-50">
              <tr>
                <th colSpan={2} className="border-b border-r border-slate-300" />
                <th colSpan={3} className="border-b border-r border-slate-300 py-4 text-center">Количественная дистрибуция</th>
                <th colSpan={5} className="border-b border-r border-slate-300 py-4 text-center">Анализ визитов</th>
                <th colSpan={4} className="border-b border-r border-slate-300 py-4 text-center">Результативность</th>
                <th className="border-b border-slate-300 py-4 text-center">Системность</th>
              </tr>
              <tr>
                {["Агент", "Супервайзер", "ОКБ", "АКБ", "%", "План", "Факт", "Плановый визит", "Внеплановый визит", "Выполнение маршрута, %", "Общий", "По маршруту", "Вне маршрута", "%", "%"].map((heading, index) => (
                  <th key={`${heading}-${index}`} className="h-20 min-w-[125px] border-b border-r border-slate-300 px-2 text-center font-medium first:min-w-[245px]">
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, rowIndex) => (
                <tr key={row[0]} className={rowIndex % 2 ? "bg-slate-50" : "bg-white"}>
                  {row.map((value, index) => (
                    <td
                      key={index}
                      className={`border-b border-r border-slate-300 px-2 py-4 ${index < 2 ? "text-left" : "text-right"} ${
                        index === 4 || index === 9 || index === 14 ? "bg-red-500" : index === 13 ? "bg-[#94f56f]" : ""
                      } ${index === 0 ? "font-medium text-[#5470e8]" : ""}`}
                    >
                      {format(value)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="bg-[#555] font-bold text-white">
                {totals.map((value, index) => (
                  <td key={index} className={`border-r border-slate-300 px-2 py-4 ${index < 2 ? "text-left" : "text-right"}`}>
                    {format(value)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
  )
}
