"use client"

import { CheckBox, LineField, LineSelect } from "@/components/analytics/catalog-ui"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, Filter, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { RefHeader, RefPage, RefTabs } from "@/components/ref/list-kit"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "организация": "organization",
  "тип магазина": "storeType",
  "комментарий": "comment",
}

type Survey = {
  id: number
  name: string
  createdAt: string
  active: boolean
  organization: string
  storeType: string
  comment: string
}

const organizations = ["Linko", "Time3 Distribution", "energetik"]
const storeTypes = ["Не указано", "horeca", "market", "market100", "market101"]

const initial: Survey[] = []

type Tab = "active" | "inactive" | "all"

function emptyDraft(): Omit<Survey, "id"> {
  return { name: "", createdAt: "", active: true, organization: organizations[0], storeType: storeTypes[0], comment: "" }
}

function now() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(".", "")
}

export function QuestionnaireView() {
  const [surveys, setSurveys] = useState(initial)
  useEffect(() => {
    let cancelled = false
    fetch("/api/surveys")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Survey[]
      })
      .then((data) => {
        if (!cancelled) setSurveys(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить опросники с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [tab, setTab] = useState<Tab>("active")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [organizationFilter, setOrganizationFilter] = useState("Все организации")
  const [selected, setSelected] = useState<number | null>(null)
  const [editing, setEditing] = useState<number | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [orderNo, setOrderNo] = useState("")
  const [flags, setFlags] = useState({ required: false, storeCheck: false, scoring: false, perfect: false })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    return surveys
      .filter((survey) => (tab === "active" ? survey.active : tab === "inactive" ? !survey.active : true))
      .filter((survey) => organizationFilter === "Все организации" || survey.organization === organizationFilter)
      .filter((survey) => survey.name.toLowerCase().includes(query.toLowerCase()))
  }, [surveys, tab, organizationFilter, query])

  const counts = useMemo(
    () => ({
      active: surveys.filter((survey) => survey.active).length,
      inactive: surveys.filter((survey) => !survey.active).length,
      all: surveys.length,
    }),
    [surveys],
  )

  const detail = selected !== null ? surveys.find((survey) => survey.id === selected) ?? null : null

  function openCreate() {
    setDraft(emptyDraft())
    setEditing("new")
  }

  function openEdit(survey: Survey) {
    setDraft({ name: survey.name, createdAt: survey.createdAt, active: survey.active, organization: survey.organization, storeType: survey.storeType, comment: survey.comment })
    setEditing(survey.id)
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/surveys/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить опросник")
        return
      }
      setSurveys((list) => list.filter((survey) => survey.id !== id))
      setSelected((current) => (current === id ? null : current))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    const payload = { ...draft, name: draft.name.trim() }
    try {
      if (editing === "new") {
        const response = await fetch("/api/surveys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать опросник")
          return
        }
        const saved = (await response.json()) as Survey
        setSurveys((list) => [saved, ...list])
      } else if (editing !== null) {
        const response = await fetch(`/api/surveys/${editing}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить опросник")
          return
        }
        const saved = (await response.json()) as Survey
        setSurveys((list) => list.map((survey) => (survey.id === saved.id ? saved : survey)))
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("questionnaires-template", [["Название", "Организация", "Тип магазина", "Комментарий"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rows = await readExcelRows(importFile)
      if (!rows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: Omit<Survey, "id">[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.organization = row[1] ?? ""
          record.storeType = row[2] ?? ""
          record.comment = row[3] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          createdAt: now(),
          active: true,
          organization: record.organization || organizations[0],
          storeType: record.storeType || storeTypes[0],
          comment: record.comment || "",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Survey[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/surveys", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Survey)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setSurveys((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  function downloadSurvey(survey: Survey) {
    downloadExcelTable(`oprosnik-${survey.id}.xls`, [
      ["№", "Название", "Дата создания", "Статус", "Организация", "Тип магазина", "Комментарий"],
      [survey.id, survey.name, survey.createdAt, survey.active ? "Активный" : "Отключен", survey.organization, survey.storeType, survey.comment],
    ])
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "active", label: "Активные", count: counts.active },
    { key: "inactive", label: "Не активные", count: counts.inactive },
    { key: "all", label: "Все", count: counts.all },
  ]

  return (
    <RefPage>
      <RefHeader title="Опросник">
        <button type="button" onClick={openCreate} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95">
          <PlusCircle className="h-4 w-4" />
          Добавить
        </button>
      </RefHeader>

      <section className="overflow-hidden rounded bg-white shadow">
        <RefTabs labels={tabs.map((item) => item.label)} value={tabs.find((item) => item.key === tab)?.label ?? ""} onChange={(label) => setTab(tabs.find((item) => item.label === label)?.key ?? tab)} />

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="flex h-[30px] items-center gap-2 rounded-[5px] bg-[#4f71dc] px-4 text-[13px] font-semibold text-white hover:brightness-95">
            <Filter className="h-4 w-4" />
            Показать фильтр
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-3 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {filtered.length} из {filtered.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-end gap-4 border-t border-slate-200 bg-slate-50 px-5 py-4">
            <label className="text-sm font-medium text-slate-600">
              Организация
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f71dc]">
                <option>Все организации</option>
                {organizations.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#5d6474] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              Применить
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-[#5d6474] text-white">
              <tr>
                <th className="px-9 py-4 text-[13px]">№</th>
                <th className="px-5 py-4 text-[13px]">Название</th>
                <th className="px-5 py-4 text-[13px]">Дата создания</th>
                <th className="px-5 py-4 text-[13px]">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((survey) => (
                <tr key={survey.id} className={`border-b border-dashed border-slate-300 hover:bg-slate-50 ${selected === survey.id ? "bg-slate-50" : ""}`}>
                  <td className="px-12 py-3 text-[13px]">{survey.id}</td>
                  <td className="px-5 py-3 text-[13px]">
                    <button type="button" onClick={() => setSelected((current) => (current === survey.id ? null : survey.id))} className="text-left text-[#4f71dc] hover:underline">
                      {survey.name}
                    </button>
                  </td>
                  <td className="px-5 py-3 text-[13px]">{survey.createdAt}</td>
                  <td className="px-5 py-3 text-[13px]">
                    <span className={survey.active ? "text-[#71ce87]" : "text-slate-400"}>{survey.active ? "Активный" : "Отключен"}</span>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {detail && (
          <div className="border-t border-slate-200 p-7">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">
                № {detail.id} - {detail.name}
              </h2>
              <div className="flex items-center gap-4 text-slate-500">
                <button type="button" onClick={() => downloadSurvey(detail)} aria-label="Скачать" className="hover:text-[#4f71dc]">
                  <Download className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => openEdit(detail)} aria-label="Изменить" className="hover:text-[#4f71dc]">
                  <Pencil className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => remove(detail.id)} aria-label="Удалить" className="hover:text-red-500">
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="mt-5 space-y-2 border-t border-slate-100 pt-5 text-[15px]">
              <p>
                <span className="text-slate-500">Дата создания</span> <b className="ml-2">{detail.createdAt}</b>
              </p>
              <p>
                <span className="text-slate-500">Организация</span> <b className="ml-2">{detail.organization}</b>
              </p>
              <p>
                <span className="text-slate-500">Тип магазина</span> <b className="ml-2">{detail.storeType}</b>
              </p>
            </div>
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="font-bold text-slate-800">Комментарий:</p>
              <p className="mt-1 text-slate-700">{detail.comment || "—"}</p>
            </div>
          </div>
        )}
      </section>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex bg-white text-[13px]">
          <form onSubmit={save} className="flex h-full w-full flex-col">
            <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]">
              <b className="uppercase">{editing === "new" ? "Добавление" : "Изменить опросник"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть"><X className="h-6 w-6" /></button>
            </header>
            <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
              <aside className="space-y-[10px] overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[60px]">
                <LineField label="Название" autoFocus value={draft.name} onChange={(value) => setDraft((current) => ({ ...current, name: value }))} />
                <LineField label="Порядковый номер" value={orderNo} onChange={setOrderNo} />
                <LineSelect label="Организация" value={draft.organization} onChange={(value) => setDraft((current) => ({ ...current, organization: value }))} options={organizations} />
                <LineSelect label="Тип клиента" value={draft.storeType} onChange={(value) => setDraft((current) => ({ ...current, storeType: value }))} options={storeTypes} />
                <div className="space-y-[12px] pt-[10px]">
                  <CheckBox checked={flags.required} onChange={(value) => setFlags((current) => ({ ...current, required: value }))} label="Обязательный" />
                  <CheckBox checked={flags.storeCheck} onChange={(value) => setFlags((current) => ({ ...current, storeCheck: value }))} label="Store Check" />
                  <CheckBox checked={draft.active} onChange={(value) => setDraft((current) => ({ ...current, active: value }))} label="Активный" />
                  <CheckBox checked={flags.scoring} onChange={(value) => setFlags((current) => ({ ...current, scoring: value }))} label="Имеет систему оценки" />
                  <CheckBox checked={flags.perfect} onChange={(value) => setFlags((current) => ({ ...current, perfect: value }))} label="Perfect Store" />
                </div>
                <LineField label="Оставить комментарий..." value={draft.comment} onChange={(value) => setDraft((current) => ({ ...current, comment: value }))} />
              </aside>
              <main className="min-w-0 overflow-y-auto bg-[#f4f4f4] px-[14px] py-[12px]">
                <p className="text-[13px] font-semibold">Список вопросов</p>
                <div className="mt-[10px] bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12)]">
                  <div className="flex h-[60px] items-center justify-between bg-[#f2f5f8] px-[20px]"><b className="text-[15px]">Вопрос № 1</b><button type="button" className="flex h-[30px] w-[30px] items-center justify-center rounded-[3px] bg-[#4f71dc] text-white">+</button></div>
                  <div className="grid grid-cols-2 gap-[20px] px-[20px] py-[16px]">
                    <div className="space-y-[10px]"><LineField label="Напишите вопрос" value="" onChange={() => {}} /><LineSelect label="Тип" value="" onChange={() => {}} options={[]} /><LineField label="Максимум ответов" value="" onChange={() => {}} /><LineSelect label="Формат" value="" onChange={() => {}} options={[]} /><LineField label="Порядковый номер" value="" onChange={() => {}} /><CheckBox checked={false} onChange={() => {}} label="Обязательный вопрос" /></div>
                    <div><p className="text-[18px] font-semibold">Ответы</p><div className="mt-[14px] flex items-center justify-between border-b border-[#d5dae1] pb-[8px] font-semibold"><span>Ответ #1</span><span className="text-[18px]">+</span></div></div>
                  </div>
                </div>
              </main>
            </div>
            <footer className="flex h-[56px] shrink-0 items-center justify-end border-t border-[#efefef] px-[14px]">
              <button type="submit" className="text-[12px] font-bold uppercase text-[#0a9ddb]">Сохранить</button>
            </footer>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">Импорт с Excel</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f71dc] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f71dc] hover:text-[#4f71dc]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#71ce87] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </RefPage>
  )
}
