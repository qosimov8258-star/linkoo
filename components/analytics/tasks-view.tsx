"use client"

import { BarChart3, ChevronLeft, ChevronRight, Clock3, FileText, Pencil, PlusCircle, Search, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { taskResponsibles as responsibles, taskStatusLabels as statusLabels, taskStores as stores, type Task } from "./tasks-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "ответственный": "responsible", "responsible": "responsible",
  "магазин": "store", "store": "store",
  "описание": "description", "description": "description",
}

function emptyDraft() {
  return { responsible: responsibles[0], store: stores[0], description: "" }
}

export function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<"in_progress" | "fulfilled" | "closed" | "all">("all")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterActive, setFilterActive] = useState(true)
  const [filterEditOpen, setFilterEditOpen] = useState(false)
  const [storeFilter, setStoreFilter] = useState("Все магазины")
  const [editing, setEditing] = useState<"new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/tasks")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить задачи")
        return (await response.json()) as Task[]
      })
      .then((data) => {
        if (cancelled) return
        setTasks(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить задачи с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () =>
      tasks
        .filter((task) => tab === "all" || task.status === tab)
        .filter((task) => storeFilter === "Все магазины" || task.store === storeFilter)
        .filter((task) => `${task.responsible} ${task.store} ${task.description}`.toLowerCase().includes(query.toLowerCase())),
    [tasks, tab, storeFilter, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  async function cycleStatus(id: number) {
    const task = tasks.find((item) => item.id === id)
    if (!task) return
    const order: Task["status"][] = ["in_progress", "fulfilled", "closed"]
    const status = order[(order.indexOf(task.status) + 1) % order.length]
    try {
      const response = await fetch(`/api/tasks/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsible: task.responsible, store: task.store, description: task.description, status }),
      })
      if (!response.ok) return
      const saved = (await response.json()) as Task
      setTasks((current) => current.map((item) => (item.id === id ? saved : item)))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.description.trim()) return
    setSaving(true)
    try {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responsible: draft.responsible, store: draft.store, description: draft.description.trim(), status: "in_progress" }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось создать задачу")
        return
      }
      const saved = (await response.json()) as Task
      setTasks((current) => [saved, ...current])
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
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
        window.alert("Не удалось найти задачи для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("description") || Array.from(fieldByIndex.values()).includes("store")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { responsible: string; store: string; description: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.responsible = row[0] ?? ""
          record.store = row[1] ?? ""
          record.description = row[2] ?? ""
        }
        if (!record.description && !record.store) continue
        parsed.push({
          responsible: record.responsible || responsibles[0],
          store: record.store || stores[0],
          description: record.description || "",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти задачи для импорта в выбранном файле")
        return
      }

      const created: Task[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/tasks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...item, status: "in_progress" }),
          })
          if (response.ok) created.push((await response.json()) as Task)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setTasks((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: "in_progress", label: "В процессе" },
    { key: "fulfilled", label: "Выполнено" },
    { key: "closed", label: "Завершенный" },
    { key: "all", label: "Все" },
  ]

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-slate-600">
          <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
          <span className="mx-2 text-slate-400">|</span> Задачи
        </h1>
        <div className="flex items-center gap-3">
          <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <BarChart3 className="h-4 w-4" /> Импортировать
          </button>
          <button type="button" onClick={() => { setDraft(emptyDraft()); setEditing("new") }} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <PlusCircle className="h-4 w-4" /> Добавить
          </button>
        </div>
      </header>

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex border-b border-slate-200 text-center">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => { setTab(item.key); setPage(1) }}
              className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === item.key ? "border-[#4f70e7] text-[#4f70e7]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="relative flex flex-wrap items-center gap-4 px-5 py-3">
          {filterActive ? (
            <div className="flex items-center gap-2 rounded-md bg-[#f6f9fc] px-4 py-2 text-[#586174]">
              Фильтр: 1 элемента
              <button type="button" onClick={() => setFilterEditOpen((value) => !value)} aria-label="Изменить фильтр"><Pencil className="h-4 w-4 text-[#9aa3b6] hover:text-[#4f70e7]" /></button>
              <button type="button" onClick={() => setFilterActive(false)} aria-label="Очистить фильтр"><X className="h-5 w-5 rounded-full border border-[#9aa3b6] p-0.5 text-[#9aa3b6] hover:text-[#e5484d]" /></button>
              {filterEditOpen && (
                <div className="absolute left-5 top-full z-20 mt-2 w-64 border border-slate-200 bg-white p-4 shadow-xl">
                  <label className="block text-xs font-medium text-slate-500">
                    Магазин
                    <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="mt-1 block w-full border-b border-slate-300 bg-white py-2 text-sm outline-none">
                      <option>Все магазины</option>
                      {stores.map((item) => <option key={item}>{item}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={() => setFilterEditOpen(false)} className="mt-4 w-full rounded bg-[#626b7e] py-2 text-sm font-semibold text-white">Применить</button>
                </div>
              )}
            </div>
          ) : (
            <button type="button" onClick={() => setFilterActive(true)} className="text-[#4f70e7]">Показать фильтр⌄</button>
          )}
          <label className="relative ml-auto w-64">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="text-slate-500">25</span>
          <span className="text-slate-500">
            {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
          </span>
          <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="rounded-full border-2 p-1 disabled:opacity-30">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="rounded-full border-2 p-1 disabled:opacity-30">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {loadError && <p className="px-5 pb-3 text-sm text-red-500">{loadError}</p>}

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Ответственный</th>
              <th className="px-5 py-5">Дата задачи</th>
              <th className="px-5 py-5">Магазин</th>
              <th className="px-5 py-5">Описание</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {visible.map((task) => (
              <tr key={task.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{task.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{task.responsible}</td>
                <td className="px-5 py-4">{task.date}</td>
                <td className="px-5 py-4">{task.store}</td>
                <td className="px-5 py-4">{task.description}</td>
                <td className="px-5 py-4 text-right">
                  <button
                    type="button"
                    onClick={() => cycleStatus(task.id)}
                    aria-label={`Статус: ${statusLabels[task.status]}`}
                    title={statusLabels[task.status]}
                    className={task.status === "in_progress" ? "text-amber-500" : task.status === "fulfilled" ? "text-[#6ccd8b]" : "text-slate-400"}
                  >
                    <Clock3 className="h-5 w-5" />
                  </button>
                </td>
              </tr>
            ))}
            {!loading && visible.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing === "new" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">Добавить задачу</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">Ответственный</label>
            <select value={draft.responsible} onChange={(event) => setDraft((value) => ({ ...value, responsible: event.target.value }))} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {responsibles.map((item) => <option key={item}>{item}</option>)}
            </select>
            <label className="mb-2 block font-medium">Магазин</label>
            <select value={draft.store} onChange={(event) => setDraft((value) => ({ ...value, store: event.target.value }))} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {stores.map((item) => <option key={item}>{item}</option>)}
            </select>
            <label className="mb-2 block font-medium">Описание</label>
            <textarea autoFocus value={draft.description} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} rows={3} className="w-full resize-none rounded border border-slate-300 px-3 py-2.5" />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white disabled:opacity-60">
                <PlusCircle className="h-4 w-4" />
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </div>
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
