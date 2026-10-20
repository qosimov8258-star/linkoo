"use client"

import Image from "next/image"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Copy, ListChecks, Pencil, PlusCircle, RefreshCw, Search, Trash2, X } from "lucide-react"

import { RefHeader, RefPage } from "@/components/ref/list-kit"
import { readExcelRows } from "@/lib/excel-import"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { useLanguage } from "@/lib/i18n/language-context"

type PlanEntry = { employee: string; survey: string }

const months = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const years = ["2024", "2025", "2026", "2027"]

function periodKey(month: string, year: string) {
  return `${month}-${year}`
}

const initialPlans: Record<string, PlanEntry[]> = {}

function currentMonthName() {
  return months[new Date().getMonth()]
}

function currentYear() {
  return String(new Date().getFullYear())
}

function parseImportedRows(rows: string[][]) {
  const entries: PlanEntry[] = []
  rows.forEach(([employee, survey], index) => {
    if (!employee || !survey) return
    if (index === 0 && /сотрудник/i.test(employee)) return
    entries.push({ employee, survey })
  })
  return entries
}

export function SurveyPlanView() {
  const { t } = useLanguage()
  // The factory's own employees and surveys (never another tenant's names).
  const employees = useDirectoryNames("employees")
  const [surveyOptions, setSurveyOptions] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/surveys")
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: unknown) => {
        if (cancelled || !Array.isArray(rows)) return
        setSurveyOptions([...new Set(rows.map((row) => String((row as { name?: unknown }).name ?? "").trim()).filter(Boolean))])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch("/api/survey-plans")
      .then((response) => (response.ok ? (response.json() as Promise<{ period: string; employee: string; survey: string }[]>) : Promise.reject()))
      .then((entries) => {
        const grouped: Record<string, PlanEntry[]> = {}
        for (const entry of entries) {
          grouped[entry.period] = [...(grouped[entry.period] ?? []), { employee: entry.employee, survey: entry.survey }]
        }
        setPlans(grouped)
      })
      .catch(() => {})
  }, [])

  async function savePeriod(period: string, entries: PlanEntry[]) {
    try {
      const response = await fetch("/api/survey-plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ period, entries }),
      })
      if (!response.ok) {
        window.alert("Не удалось сохранить план")
        return false
      }
      return true
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
      return false
    }
  }

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

  async function saveEdit() {
    const clean = draft.filter((row) => row.employee && row.survey)
    const ok = await savePeriod(key, clean)
    if (!ok) return
    setPlans((current) => ({ ...current, [key]: clean }))
    setEditing(false)
  }

  function addDraftRow() {
    setDraft((rows) => [...rows, { employee: employees[0] ?? "", survey: surveyOptions[0] ?? "" }])
  }

  function updateDraftRow(index: number, patch: Partial<PlanEntry>) {
    setDraft((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)))
  }

  function removeDraftRow(index: number) {
    setDraft((rows) => rows.filter((_, position) => position !== index))
  }

  async function copyPlan() {
    const targetKey = periodKey(copyMonth, copyYear)
    const entries = plans[key] ?? []
    const ok = await savePeriod(targetKey, entries)
    if (!ok) return
    setPlans((current) => ({ ...current, [targetKey]: entries }))
    setCopyDone(true)
    setTimeout(() => setCopyDone(false), 2000)
  }

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void readExcelRows(file).then(async (rows) => {
      const entries = parseImportedRows(rows)
      if (!entries.length) return
      const ok = await savePeriod(key, entries)
      if (ok) setPlans((current) => ({ ...current, [key]: entries }))
    })
  }

  return (
    <RefPage>
      <RefHeader title={t("План опроса")}>
        <input ref={fileInputRef} type="file" accept=".csv,.xls,.xlsx,text/csv" onChange={handleImport} className="hidden" />
        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          <RefreshCw className="h-4 w-4" />
          {t("Установить с EXCEL")}
        </button>
      </RefHeader>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-end gap-[15px] px-[10px] py-[8px] text-[13px]">
          <label className="text-[10px] font-bold text-black">
            {t("Месяц")}
            <div className="mt-1 flex items-center gap-2 border-b border-slate-300 pb-1 pr-1">
              <select value={month} onChange={(event) => setMonth(event.target.value)} className="bg-white text-[13px] text-black outline-none">
                {months.map((item) => (
                  <option key={item} value={item}>
                    {t(item)}
                  </option>
                ))}
              </select>
              <button type="button" aria-label={t("Очистить месяц")} onClick={() => setMonth(currentMonthName())} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
          </label>
          <label className="text-[10px] font-bold text-black">
            {t("Год")}
            <select value={year} onChange={(event) => setYear(event.target.value)} className="mt-1 block border-b border-slate-300 bg-white pb-1 text-[13px] font-normal text-black outline-none">
              {years.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="relative ml-[18px] w-[248px]">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-full border-b border-[#e0e0e0] py-1 pr-10 text-[13px] outline-none focus:border-[#5d6474]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <span className="text-slate-500">25</span>
            <span className="text-slate-500">
              1 - {rows.length} {t("из")} {rows.length}
            </span>
            <ChevronLeft className="h-5 w-5 text-slate-300" />
            <ChevronRight className="h-5 w-5 text-slate-300" />
            <button type="button" onClick={() => setGrouped((value) => !value)} aria-pressed={grouped} aria-label={t("Группировать по опросу")} className={`rounded p-2 ${grouped ? "bg-[#4f71dc] text-white" : "text-slate-500 hover:bg-slate-100"}`}>
              <ListChecks className="h-5 w-5" />
            </button>
            <button type="button" onClick={openEdit} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Pencil className="h-4 w-4" />
              {t("Изменить планы")}
            </button>
            <div className="relative">
              <button type="button" onClick={() => setCopyOpen((value) => !value)} aria-label={t("Скопировать план")} className="rounded border border-slate-300 p-2.5 text-slate-500 hover:bg-slate-100">
                <Copy className="h-5 w-5" />
              </button>
              {copyOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-72 rounded border border-slate-200 bg-white p-4 shadow-xl">
                  <p className="mb-3 text-sm font-semibold text-slate-700">{t("Скопировать план в период")}</p>
                  <div className="flex gap-2">
                    <select value={copyMonth} onChange={(event) => setCopyMonth(event.target.value)} className="flex-1 border-b border-slate-300 bg-white py-1.5 text-sm outline-none">
                      {months.map((item) => (
                        <option key={item} value={item}>
                          {t(item)}
                        </option>
                      ))}
                    </select>
                    <select value={copyYear} onChange={(event) => setCopyYear(event.target.value)} className="border-b border-slate-300 bg-white py-1.5 text-sm outline-none">
                      {years.map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <button type="button" onClick={copyPlan} className="mt-4 w-full rounded bg-[#71ce87] py-2 text-sm font-semibold text-white hover:brightness-95">
                    {copyDone ? t("Скопировано ✓") : t("Скопировать")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">{t("Сотрудник")}</th>
              <th className="px-5 py-5">{t("Опрос")}</th>
            </tr>
          </thead>
          <tbody>
            {!grouped &&
              rows.map((row, index) => (
                <tr key={`${row.employee}-${index}`} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.employee}</td>
                  <td className="px-5 py-4 text-[#4f71dc]">{row.survey}</td>
                </tr>
              ))}
            {grouped &&
              grouping?.map(([survey, names]) => (
                <tr key={survey} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{names.join(", ")}</td>
                  <td className="px-5 py-4 text-[#4f71dc]">{survey}</td>
                </tr>
              ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="flex min-h-[340px] flex-col items-center justify-center gap-4 py-10">
            <Image src="/robot-empty.png" alt={t("Робот-помощник")} width={190} height={190} priority className="h-36 w-36 object-contain" />
            <p className="text-lg text-slate-400">{t("По вашему запросу ничего не найдено")}</p>
          </div>
        )}
      </section>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">
                {t("План опроса")} — {t(month)} {year}
              </b>
              <button type="button" onClick={() => setEditing(false)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="flex-1 space-y-3 overflow-y-auto p-6">
              {draft.map((row, index) => (
                <div key={index} className="flex items-center gap-3">
                  <select value={row.employee} onChange={(event) => updateDraftRow(index, { employee: event.target.value })} className="flex-1 border-b border-slate-300 bg-white py-2 outline-none">
                    {[...new Set([...employees, row.employee].filter(Boolean))].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <select value={row.survey} onChange={(event) => updateDraftRow(index, { survey: event.target.value })} className="flex-1 border-b border-slate-300 bg-white py-2 outline-none">
                    {[...new Set([...surveyOptions, row.survey].filter(Boolean))].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => removeDraftRow(index)} aria-label={t("Удалить строку")} className="text-slate-400 hover:text-red-500">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addDraftRow} className="flex items-center gap-2 text-[#4f71dc] hover:underline">
                <PlusCircle className="h-5 w-5" />
                {t("Добавить сотрудника")}
              </button>
            </div>
            <footer className="flex justify-end gap-3 border-t p-5">
              <button type="button" onClick={() => setEditing(false)} className="rounded border border-slate-300 px-5 py-2.5 font-semibold text-slate-600">
                {t("Отмена")}
              </button>
              <button type="button" onClick={saveEdit} className="rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">
                {t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </RefPage>
  )
}
