"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { Download, PlusCircle } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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
  const [position, setPosition] = useState("Все должности")
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

  function apply(event: FormEvent) {
    event.preventDefault()
  }

  const totals = ["Итого", "", 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <FavoritesButton className="flex items-center gap-2 text-[#5470e8]" />
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Системная дистрибуция</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-md bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <Download className="h-5 w-5" /> Скачать Excel
          </button>
          <button type="button" onClick={() => setDashboardOpen(true)} className="inline-flex items-center gap-2 rounded-md bg-[#5470e8] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <PlusCircle className="h-5 w-5" />
            {inDashboard ? "Добавлено в дашборд" : "Добавить в дашборд"}
          </button>
        </div>
      </header>

      <section className="bg-white px-4 py-3 sm:px-10">
        <form onSubmit={apply}>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="text-xs font-medium">
              Дата создания от
              <input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            <label className="text-xs font-medium">
              Дата создания до
              <input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-transparent px-0 py-2 text-base outline-none focus:border-brand-blue" />
            </label>
            <label className="text-xs font-medium">
              Должность
              <select value={position} onChange={(event) => setPosition(event.target.value)} className="mt-1 block w-full border-0 border-b border-slate-300 bg-white px-0 py-2 text-base outline-none focus:border-brand-blue">
                <option>Все должности</option>
                <option>Агент</option>
                <option>Супервайзер</option>
              </select>
            </label>
          </div>
          <button type="submit" disabled={from > to} className="mt-3 w-full rounded-md bg-[#71ce87] py-3 font-bold text-white hover:brightness-95 disabled:opacity-50">
            Применить
          </button>
        </form>

        <div className="mt-3 overflow-x-auto border border-slate-300 visits-scrollbar">
          <table className="min-w-[1840px] border-collapse text-[16px] text-slate-800">
            <thead className="bg-slate-50">
              <tr>
                <th colSpan={2} className="border-b border-r border-slate-300" />
                <th colSpan={3} className="border-b border-r border-slate-300 py-4 text-center text-lg">Количественная дистрибуция</th>
                <th colSpan={5} className="border-b border-r border-slate-300 py-4 text-center text-lg">Анализ визитов</th>
                <th colSpan={4} className="border-b border-r border-slate-300 py-4 text-center text-lg">Результативность</th>
                <th className="border-b border-slate-300 py-4 text-center text-lg">Системность</th>
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
    </main>
  )
}
