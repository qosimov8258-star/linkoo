"use client"

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react"
import { ChevronRight, Download, PlusCircle, Star, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"

type AgentRow = {
  name: string
  route: [number, number, number, number, number]
  outside: [number, number, number, number]
}

const rows: AgentRow[] = [
  {
    name: "Admin Ritm",
    route: [104, 0, 0, 0, 0],
    outside: [1, 1, 0, 9859375],
  },
  {
    name: "Samandar Abdurahmonov",
    route: [0, 0, 0, 0, 0],
    outside: [1, 1, 0, 220000],
  },
]

const supervisorGroups = [
  {
    title: "Admin Ritm",
    agent: "Admin Ritm",
    values: [104, 0, 0, 0, 0, 1, 1, 0, 9859375],
  },
  {
    title: "Азизхон Супервайзер",
    agent: "Samandar Abdurahmonov",
    values: [0, 0, 0, 0, 0, 1, 1, 0, 220000],
  },
]

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

export function AgentVisitsView({ supervisorMode = false }: { supervisorMode?: boolean }) {
  const today = useMemo(() => inputDate(new Date()), [])
  const [draftFrom, setDraftFrom] = useState(monthStart)
  const [draftTo, setDraftTo] = useState(today)
  const [favorite, setFavorite] = useState(false)
  const [inDashboard, setInDashboard] = useState(false)
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")
  const [supervisorAscending, setSupervisorAscending] = useState(true)
  const [expandedSupervisors, setExpandedSupervisors] = useState(() =>
    supervisorGroups.map((group) => group.title),
  )
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
    [],
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

  function apply(event: FormEvent) {
    event.preventDefault()
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
            <Star className={`h-6 w-6 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />
            Избранные
          </button>
          <span className="text-slate-500">|</span>
          <h1 className="text-slate-600">
            {supervisorMode ? "Визиты агентов по супервайзерам" : "Визиты агента"}
          </h1>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={downloadCsv}
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
          <div className="grid max-w-[920px] gap-5 sm:grid-cols-2">
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
          <table className="w-full min-w-[1220px] border-collapse text-[16px] text-slate-800">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[360px] border-b border-r border-slate-300" />
                <th colSpan={5} className="border-b border-r border-slate-300 py-4 text-center text-lg font-semibold">
                  По маршруту
                </th>
                <th colSpan={4} className="border-b border-slate-300 py-4 text-center text-lg font-semibold">
                  Вне маршрута
                </th>
              </tr>
              <tr>
                <th className="border-b border-r border-slate-300 px-3 py-4 text-center">
                  {supervisorMode ? (
                    <button
                      type="button"
                      onClick={() => setSupervisorAscending((value) => !value)}
                      className="inline-flex items-center gap-3 font-semibold"
                      aria-label="Сортировать по супервайзеру"
                    >
                      Супервайзер
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
                <th className="border-r border-slate-300 px-2 py-4 text-left">Итого</th>
                {(supervisorMode
                  ? [104, 0, 0, 2, 0, 2, 2, 2, 10079375]
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
          aria-labelledby="agent-dashboard-dialog-title"
          className="fixed left-1/2 top-1/2 z-[100] flex h-[min(646px,calc(100vh-32px))] w-[min(750px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col bg-white shadow-2xl"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-9 py-7">
            <h2 id="agent-dashboard-dialog-title" className="text-lg font-bold uppercase text-slate-900">
              Добавить в дашборд
            </h2>
            <button type="button" onClick={() => setDashboardOpen(false)} aria-label="Закрыть" className="rounded p-1 text-slate-500 hover:bg-slate-100">
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
                    name="agent-dashboard-visibility"
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
              <select value={dashboard} onChange={(event) => setDashboard(event.target.value)} className="mt-2 block w-full border-0 bg-white py-2 text-base font-normal outline-none">
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
          aria-labelledby="agent-favorites-title"
          className="fixed bottom-0 left-0 top-0 z-[100] w-[min(418px,calc(100vw-28px))] border-r-[10px] border-sky-500 bg-white shadow-2xl animate-in slide-in-from-left-full duration-200"
        >
          <header className="flex items-center justify-between border-b border-slate-200 px-9 py-7">
            <h2 id="agent-favorites-title" className="text-xl font-medium text-slate-900">Избранные</h2>
            <button type="button" onClick={() => setFavoritesOpen(false)} aria-label="Закрыть" className="rounded p-1 hover:bg-slate-100">
              <X className="h-7 w-7" />
            </button>
          </header>
          <nav aria-label="Избранные разделы">
            {["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"].map((item, index) => (
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
            ))}
          </nav>
        </aside>
      )}
    </main>
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
