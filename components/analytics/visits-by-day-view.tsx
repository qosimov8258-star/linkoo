"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { ChevronRight, Download, PlusCircle, Star, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"

const agents = ["Admin Ritm", "Samandar Abdurahmonov"]

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

function downloadVisitsCsv(days: number[]) {
  const rows = [
    ["Агент", ...days.map(String)],
    ...agents.map((agent, agentIndex) => [
      agent,
      ...days.map((day) => (agentIndex === 1 && day === 12 ? "1" : "0")),
    ]),
  ]
  downloadExcelTable("visits-by-day.xls", rows)
}

export function VisitsByDayView() {
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [range, setRange] = useState({ from: monthStart(), to: today })
  const [favorite, setFavorite] = useState(false)
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")

  const overlayOpen = dashboardOpen || favoritesOpen

  useEffect(() => {
    if (!overlayOpen) return

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDashboardOpen(false)
        setFavoritesOpen(false)
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
    const result: number[] = []
    for (const date = start; date <= end && result.length < 31; date.setDate(date.getDate() + 1)) {
      result.push(date.getDate())
    }
    return result
  }, [range])

  function apply(event: FormEvent) {
    event.preventDefault()
    if (draftFrom <= draftTo) setRange({ from: draftFrom, to: draftTo })
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-300 bg-slate-100 px-5 py-4 sm:px-10">
        <div className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
          <button
            type="button"
            onClick={() => setFavoritesOpen(true)}
            aria-pressed={favorite}
            className="flex items-center gap-2 text-[#5470e8]"
          >
            <Star className={`h-6 w-6 text-slate-600 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600"}`} />
            Избранные
          </button>
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">Визиты по дням</h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => downloadVisitsCsv(days)}
            className="inline-flex items-center gap-2 rounded-md bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95"
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
            className="mt-3 w-full rounded-md bg-[#6ccd8b] py-3 font-bold text-white hover:brightness-95 disabled:opacity-50"
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
                  <th key={day} className="h-14 w-[70px] min-w-[70px] border-b border-r border-slate-300 text-center font-medium">
                    {day}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50">
                <th className="sticky left-0 z-20 border-b border-r border-slate-300 bg-slate-50 px-3 py-4 text-center font-semibold">
                  Агент
                </th>
                {days.map((day) => (
                  <th key={day} className="h-14 border-b border-r border-slate-300 text-center font-semibold">
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
                    <td key={day} className="border-b border-r border-slate-300 px-2 py-4 text-right">
                      {agentIndex === 1 && day === 12 ? 1 : 0}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {overlayOpen && (
        <button
          type="button"
          aria-label="Окнони yopish"
          onClick={() => {
            setDashboardOpen(false)
            setFavoritesOpen(false)
          }}
          className="fixed inset-0 z-[90] cursor-default bg-black/55"
        />
      )}

      {dashboardOpen && (
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="dashboard-dialog-title"
          className="fixed left-1/2 top-1/2 z-[100] flex h-[min(646px,calc(100vh-32px))] w-[min(750px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-9 py-7">
            <h2 id="dashboard-dialog-title" className="text-lg font-bold uppercase text-slate-900">
              Добавить в дашборд
            </h2>
            <button
              type="button"
              onClick={() => setDashboardOpen(false)}
              aria-label="Закрыть"
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
            >
              <X className="h-7 w-7" />
            </button>
          </header>

          <div className="flex-1 px-16 py-10">
            <fieldset className="space-y-5">
              <legend className="sr-only">Кому показывать виджет</legend>
              {[
                ["all", "Все"],
                ["employees", "Выбранным сотрудникам"],
                ["access", "Выбранным доступам"],
              ].map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-5 text-lg text-slate-900">
                  <input
                    type="radio"
                    name="dashboard-visibility"
                    value={value}
                    checked={visibility === value}
                    onChange={() => setVisibility(value)}
                    className="h-6 w-6 accent-slate-500"
                  />
                  {label}
                </label>
              ))}
            </fieldset>

            <label className="mt-12 block border-b border-slate-200 pb-2 text-base font-bold text-slate-900">
              Дашборд
              <select
                value={dashboard}
                onChange={(event) => setDashboard(event.target.value)}
                className="mt-2 block w-full border-0 bg-white py-2 text-base font-normal outline-none"
              >
                <option>Основной дашборд</option>
                <option>Продажи</option>
                <option>Контроль агентов</option>
              </select>
            </label>
          </div>

          <footer className="flex justify-end border-t border-slate-200 px-9 py-6">
            <button
              type="button"
              onClick={() => {
                setInDashboard(true)
                setDashboardOpen(false)
              }}
              className="font-semibold uppercase text-sky-500 hover:text-sky-600"
            >
              Сохранить
            </button>
          </footer>
        </section>
      )}

      {favoritesOpen && (
        <aside
          role="dialog"
          aria-modal="true"
          aria-labelledby="favorites-title"
          className="fixed bottom-0 left-0 top-0 z-[100] w-[min(418px,calc(100vw-28px))] border-r-[10px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-left-full duration-200"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-9 py-7">
            <h2 id="favorites-title" className="text-xl font-medium text-slate-900">Избранные</h2>
            <button
              type="button"
              onClick={() => setFavoritesOpen(false)}
              aria-label="Закрыть"
              className="rounded p-1 hover:bg-slate-100"
            >
              <X className="h-7 w-7" />
            </button>
          </header>
          <nav aria-label="Избранные разделы">
            {["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"].map(
              (item, index) => (
                <button
                  key={`${item}-${index}`}
                  type="button"
                  onClick={() => {
                    setFavorite(true)
                    setFavoritesOpen(false)
                  }}
                  className="flex w-full items-center justify-between border-b border-slate-200 px-6 py-3.5 text-left text-[17px] font-medium text-slate-900 hover:bg-slate-50"
                >
                  {item}
                  <ChevronRight className="h-5 w-5 text-slate-500" />
                </button>
              ),
            )}
          </nav>
        </aside>
      )}
    </main>
  )
}
