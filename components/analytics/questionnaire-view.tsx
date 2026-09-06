"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Download, FileText, Filter, Pencil, PlusCircle, Search, Trash2, X } from "lucide-react"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

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
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />{" "}
          <span className="mx-2 text-slate-400">|</span> Опросник
        </h1>
        <div className="flex items-center gap-3">
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-3 font-semibold text-white hover:brightness-95">
            <FileText className="h-4 w-4" /> Импорт с Excel
          </button>
          <button type="button" onClick={openCreate} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95">
            <PlusCircle className="mr-2 inline h-5 w-5" />
            Добавить
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex border-b border-slate-200 text-center">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === item.key ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-3 font-semibold text-white hover:brightness-95">
            <Filter className="h-4 w-4" />
            Показать фильтр
          </button>
          <label className="relative w-64">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-3 pr-10 outline-none focus:border-[#4f70e7]" />
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
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="mt-1 block w-56 border-0 border-b border-slate-300 bg-white px-0 py-2 outline-none focus:border-[#4f70e7]">
                <option>Все организации</option>
                {organizations.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={() => setFilterOpen(false)} className="rounded bg-[#626b7e] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              Применить
            </button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">№</th>
                <th className="px-5 py-5">Название</th>
                <th className="px-5 py-5">Дата создания</th>
                <th className="px-5 py-5">Статус</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((survey) => (
                <tr key={survey.id} className={`border-b border-dashed border-slate-300 hover:bg-slate-50 ${selected === survey.id ? "bg-slate-50" : ""}`}>
                  <td className="px-12 py-5">{survey.id}</td>
                  <td className="px-5 py-5">
                    <button type="button" onClick={() => setSelected((current) => (current === survey.id ? null : survey.id))} className="text-left text-[#4f70e7] hover:underline">
                      {survey.name}
                    </button>
                  </td>
                  <td className="px-5 py-5">{survey.createdAt}</td>
                  <td className="px-5 py-5">
                    <span className={survey.active ? "text-[#6ccd8b]" : "text-slate-400"}>{survey.active ? "Активный" : "Отключен"}</span>
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
                <button type="button" onClick={() => downloadSurvey(detail)} aria-label="Скачать" className="hover:text-[#4f70e7]">
                  <Download className="h-5 w-5" />
                </button>
                <button type="button" onClick={() => openEdit(detail)} aria-label="Изменить" className="hover:text-[#4f70e7]">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить опросник" : "Изменить опросник"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-4 p-8">
              <label className="block border-b pb-2">
                Название
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-3 block w-full outline-none" />
              </label>
              <label className="block border-b pb-2">
                Организация
                <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-3 block w-full bg-white outline-none">
                  {organizations.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b pb-2">
                Тип магазина
                <select value={draft.storeType} onChange={(event) => setDraft((value) => ({ ...value, storeType: event.target.value }))} className="mt-3 block w-full bg-white outline-none">
                  {storeTypes.map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b pb-2">
                Комментарий
                <textarea value={draft.comment} onChange={(event) => setDraft((value) => ({ ...value, comment: event.target.value }))} rows={3} className="mt-3 block w-full resize-none outline-none" />
              </label>
              <label className="flex items-center gap-3 font-medium">
                <input type="checkbox" checked={draft.active} onChange={(event) => setDraft((value) => ({ ...value, active: event.target.checked }))} className="h-5 w-5 accent-[#4f70e7]" />
                Активный
              </label>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95">
                Сохранить
              </button>
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
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                1. Скачать шаблон
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
