"use client"

import Image from "next/image"
import { ChangeEvent, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, ListChecks, Pencil, PlusCircle, RefreshCw, Search, Star, Trash2, X } from "lucide-react"

type PlanEntry = { employee: string; survey: string }

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const years = ["2024", "2025", "2026", "2027"]

const employees = [
  "Zaynillo Sadullayev",
  "Salohiddin Agent Tashkent",
  "Islom Toirjonov",
  "Maykl Jekson",
  "Admin Ritm",
  "Samandar Abdurahmonov",
  "Fozil Agent",
  "Пулатов Аббос",
]

const surveyOptions = [
  "distr",
  "oprosnik taski",
  "so'rovnoma 1",
  "narxlar royxat",
  "ebferbfhjbf1",
  "salom GG",
  "test yangi",
  "mijozlar fikri",
  "Клиент | Обратная связь",
  "qayta test",
  "demo oprosnik",
  "Агент | Функции",
]

function periodKey(month: string, year: string) {
  return `${month}-${year}`
}

const initialPlans: Record<string, PlanEntry[]> = {
  [periodKey("Июль", "2026")]: [
    { employee: "Zaynillo Sadullayev", survey: "distr" },
    { employee: "Salohiddin Agent Tashkent", survey: "so'rovnoma 1" },
    { employee: "Islom Toirjonov", survey: "narxlar royxat" },
    { employee: "Maykl Jekson", survey: "salom GG" },
    { employee: "Admin Ritm", survey: "oprosnik taski" },
  ],
  [periodKey("Июнь", "2026")]: [
    { employee: "Fozil Agent", survey: "demo oprosnik" },
    { employee: "Samandar Abdurahmonov", survey: "mijozlar fikri" },
  ],
}

function currentMonthName() {
  return months[new Date().getMonth()]
}

function currentYear() {
  return String(new Date().getFullYear())
}

function parseImportedText(text: string) {
  const isHtml = /<table/i.test(text)
  const lines = isHtml
    ? Array.from(text.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)).map((match) =>
        Array.from(match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
          .map((cell) => cell[1].replace(/<[^>]+>/g, "").trim())
          .join(";"),
      )
    : text.split(/\r?\n/).filter(Boolean)

  const entries: PlanEntry[] = []
  lines.forEach((line, index) => {
    const [employee, survey] = line.split(/[;,\t]/).map((value) => value?.trim())
    if (!employee || !survey) return
    if (index === 0 && /сотрудник/i.test(employee)) return
    entries.push({ employee, survey })
  })
  return entries
}

export function SurveyPlanView() {
  const [month, setMonth] = useState(currentMonthName)
  const [year, setYear] = useState(currentYear)
  const [query, setQuery] = useState("")
  const [grouped, setGrouped] = useState(false)
  const [plans, setPlans] = useState(initialPlans)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<PlanEntry[]>([])
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyMonth, setCopyMonth] = useState(currentMonthName)
  const [copyYear, setCopyYear] = useState(currentYear)
  const [copyDone, setCopyDone] = useState(false)
  const [favorite, setFavorite] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const key = periodKey(month, year)
  const rows = useMemo(() => (plans[key] ?? []).filter((row) => row.employee.toLowerCase().includes(query.toLowerCase()) || row.survey.toLowerCase().includes(query.toLowerCase())), [plans, key, query])

  const grouping = useMemo(() => {
    if (!grouped) return null
    const map = new Map<string, string[]>()
    rows.forEach((row) => {
      map.set(row.survey, [...(map.get(row.survey) ?? []), row.employee])
    })
    return Array.from(map.entries())
  }, [rows, grouped])

  function openEdit() {
    setDraft(plans[key] ?? [])
    setEditing(true)
  }

  function saveEdit() {
    const clean = draft.filter((row) => row.employee && row.survey)
    setPlans((current) => ({ ...current, [key]: clean }))
    setEditing(false)
  }

  function addDraftRow() {
    setDraft((rows) => [...rows, { employee: employees[0], survey: surveyOptions[0] }])
  }

  function updateDraftRow(index: number, patch: Partial<PlanEntry>) {
    setDraft((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  function removeDraftRow(index: number) {
    setDraft((rows) => rows.filter((_, position) => position !== index))
  }

  function copyPlan() {
    const targetKey = periodKey(copyMonth, copyYear)
    setPlans((current) => ({ ...current, [targetKey]: plans[key] ?? [] }))
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2000)
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const entries = parseImportedText(String(reader.result ?? ""))
      if (entries.length) setPlans((current) => ({ ...current, [key]: entries }))
    }
    reader.readAsText(file)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 px-4 pb-8 sm:px-9">
      <header className="flex flex-wrap items-center justify-between gap-3 py-4">
        <h1 className="text-2xl font-bold text-slate-600">
          <button type="button" onClick={() => setFavorite((value) => !value)} className="inline-flex items-center gap-2 text-[#4f70e7]">
            <Star className={`h-6 w-6 ${favorite ? "fill-[#4f70e7]" : "fill-slate-500 text-slate-500"}`} />
            Избранные
          </button>
          <span className="mx-2 text-slate-400">|</span> План опроса
        </h1>
        <div className="flex items-center gap-3">
          <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={handleImport} className="hidden" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <RefreshCw className="h-4 w-4" />
            Установить с EXCEL
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-end gap-5 border-b border-slate-200 px-6 py-4">
          <label className="text-xs font-medium text-slate-500">
            Месяц
            <div className="mt-1 flex items-center gap-2 border-b border-slate-300 pb-1 pr-1">
              <select value={month} onChange={(event) => setMonth(event.target.value)} className="bg-white text-base font-semibold text-slate-800 outline-none">
                {months.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <button type="button" aria-label="Очистить месяц" onClick={() => setMonth(currentMonthName())} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Год
            <select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 block border-b border-slate-300 bg-white pb-1 text-base font-semibold text-slate-800 outline-none">
              {years.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <span className="text-slate-500">25</span>
            <span className="text-slate-500">
              1 - {rows.length} из {rows.length}
            </span>
            <ChevronLeft className="h-5 w-5 text-slate-300" />
            <ChevronRight className="h-5 w-5 text-slate-300" />
            <button type="button" onClick={() => setGrouped((value) => !value)} aria-pressed={grouped} aria-label="Группировать по опросу" className={`rounded p-2 ${grouped ? "bg-[#4f70e7] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              <ListChecks className="h-5 w-5" />
            </button>
            <button type="button" onClick={openEdit} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Pencil className="h-4 w-4" />
              Изменить планы
            </button>
            <div className="relative">
              <button type="button" onClick={() => setCopyOpen((value) => !value)} aria-label="Скопировать план" className="rounded border border-slate-300 p-2.5 text-slate-500 hover:bg-slate-100">
                <Copy className="h-5 w-5" />
              </button>
              {copyOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded border border-slate-200 bg-white p-4 shadow-xl">
                  <p className="mb-3 text-sm font-semibold text-slate-700">Скопировать план в период</p>
                  <div className="flex gap-2">
                    <select value={copyMonth} onChange={(event) => setCopyMonth(event.target.value)} className="flex-1 border-b border-slate-300 bg-white py-1.5 text-sm outline-none">
                      {months.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                    <select value={copyYear} onChange={(event) => setCopyYear(event.target.value)} className="border-b border-slate-300 bg-white py-1.5 text-sm outline-none">
                      {years.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={copyPlan} className="mt-4 w-full rounded bg-[#6ccd8b] py-2 text-sm font-semibold text-white hover:brightness-95">
                    {copyDone ? "Скопировано ✓" : "Скопировать"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Сотрудник</th>
              <th className="px-5 py-5">Опрос</th>
            </tr>
          </thead>
          <tbody>
            {!grouped &&
              rows.map((row, index) => (
                <tr key={`${row.employee}-${index}`} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.employee}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{row.survey}</td>
                </tr>
              ))}
            {grouped &&
              grouping?.map(([survey, names]) => (
                <tr key={survey} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{names.join(", ")}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{survey}</td>
                </tr>
              ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
            <Image src="/robot-mascot.png" alt="Робот-помощник" width={150} height={150} priority className="h-36 w-36 object-contain" />
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">
                План опроса — {month} {year}
              </b>
              <button type="button" onClick={() => setEditing(false)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {draft.map((row, index) => (
                <div key={index} className="flex items-center gap-3">
                  <select value={row.employee} onChange={(event) => updateDraftRow(index, { employee: event.target.value })} className="flex-1 border-b border-slate-300 bg-white py-2 outline-none">
                    {employees.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <select value={row.survey} onChange={(event) => updateDraftRow(index, { survey: event.target.value })} className="flex-1 border-b border-slate-300 bg-white py-2 outline-none">
                    {surveyOptions.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeDraftRow(index)} aria-label="Удалить строку" className="text-slate-400 hover:text-red-500">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addDraftRow} className="flex items-center gap-2 text-[#4f70e7] hover:underline">
                <PlusCircle className="h-5 w-5" />
                Добавить сотрудника
              </button>
            </div>
            <footer className="flex justify-end gap-3 border-t p-5">
              <button type="button" onClick={() => setEditing(false)} className="rounded border border-slate-300 px-5 py-2.5 font-semibold text-slate-600">
                Отмена
              </button>
              <button type="button" onClick={saveEdit} className="rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
                Сохранить
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
