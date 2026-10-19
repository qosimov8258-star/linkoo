"use client"

import { CheckBox, LineField, LineSelect, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { Clock3, FileText, Pencil, PlusCircle, X } from "lucide-react"
import Image from "next/image"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
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
  const [repeatPlan, setRepeatPlan] = useState(false)
  const [taskDate, setTaskDate] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [pageSize, setPageSize] = useState(25)

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
        .filter((task) => !filterActive || task.date.startsWith(new Date().toISOString().slice(0, 7)))
        .filter((task) => `${task.responsible} ${task.store} ${task.description}`.toLowerCase().includes(query.toLowerCase())),
    [tasks, tab, storeFilter, query, filterActive],
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
    <RefPage>
      <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
      <RefHeader title="Задачи">
        <RefButton icon={RI.chart} label="Импортировать" onClick={() => setImportOpen(true)} />
        <RefButton icon={RI.add} green label="Добавить" onClick={() => { setDraft(emptyDraft()); setEditing("new") }} />
      </RefHeader>

      <RefCard className="bg-white">
        <RefTabs labels={tabs.map((item) => item.label)} value={tabs.find((item) => item.key === tab)?.label ?? ""} onChange={(label) => { setTab(tabs.find((item) => item.label === label)?.key ?? tab); setPage(1) }} />
      </RefCard>

      <RefCard className="mt-[20px] bg-white">
        <RefToolbar
          leftSlot={
            filterActive ? (
              <div className="relative mr-[10px] flex h-[40px] items-center bg-[#f2f5f8] pl-[12px] text-[13px] text-[#5d6474]">
                <span>Фильтр: 1 элемента</span>
                <button type="button" onClick={() => setFilterEditOpen((value) => !value)} aria-label="Изменить фильтр" className="ml-[8px] flex h-[40px] w-[40px] items-center justify-center"><Pencil className="h-4 w-4 text-[#5d6474]" /></button>
                <button type="button" onClick={() => setFilterActive(false)} aria-label="Очистить фильтр" className="flex h-[40px] w-[40px] items-center justify-center"><X className="h-5 w-5 rounded-full border border-[#5d6474] p-0.5 text-[#5d6474]" /></button>
                {filterEditOpen && (
                  <div className="absolute left-0 top-full z-20 mt-1 w-64 border border-slate-200 bg-white p-4 shadow-xl">
                    <label className="block text-[10px] font-bold">
                      Магазин
                      <select value={storeFilter} onChange={(event) => setStoreFilter(event.target.value)} className="mt-1 block w-full border-b border-[#e0e0e0] bg-white py-2 text-[13px] font-normal outline-none">
                        <option>Все магазины</option>
                        {stores.map((item) => <option key={item}>{item}</option>)}
                      </select>
                    </label>
                    <button type="button" onClick={() => setFilterEditOpen(false)} className="mt-4 h-[30px] w-full rounded-[5px] bg-[#4f71dc] text-[13px] font-semibold text-white">Применить</button>
                  </div>
                )}
              </div>
            ) : (
              <button type="button" onClick={() => setFilterActive(true)} className="pl-[5px] text-[13px] text-[#4f71dc]">Показать фильтр ⌄</button>
            )
          }
          query={query}
          onQuery={(value) => { setQuery(value); setPage(1) }}
          pageSize={pageSize}
          onPageSize={(value) => { setPageSize(value); setPage(1) }}
          from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filtered.length)}
          total={filtered.length}
          page={safePage}
          pageCount={pageCount}
          onPage={setPage}
        />
        {loadError && <p className="px-5 pb-3 text-sm text-red-500">{loadError}</p>}
        <RefTable
          cols="110px 207px 103px 206px minmax(0,1fr) 60px"
          heads={["№", "Ответственный", "Дата задачи", "Магазин", "Описание", ""]}
          rows={visible}
          rowKey={(task) => task.id}
          empty={loading ? "" : <div className="flex min-h-[200px] flex-col items-center justify-center gap-3"><Image src="/robot-empty.png" alt="" width={120} height={120} className="h-[110px] w-[110px] object-contain" /><p className="text-[13px] text-[#666]">По вашему запросу ничего не найдено</p></div>}
          render={(task) => [
            task.id,
            task.responsible,
            task.date ? new Date(`${task.date}T00:00:00`).toLocaleDateString("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).replace(" г.", "") : "",
            task.store,
            task.description,
            <button
              key="s"
              type="button"
              onClick={() => cycleStatus(task.id)}
              aria-label={`Статус: ${statusLabels[task.status]}`}
              title={statusLabels[task.status]}
              className={task.status === "in_progress" ? "text-amber-500" : task.status === "fulfilled" ? "text-[#71ce87]" : "text-slate-400"}
            >
              <Clock3 className="h-5 w-5" />
            </button>,
          ]}
        />
      </RefCard>

      {editing === "new" && (
        <Modal title="Добавить задачу" onClose={() => setEditing(null)} footer={<SaveButton disabled={saving} onClick={() => void save({ preventDefault() {} } as FormEvent)}>{saving ? "Сохранение..." : "Сохранить"}</SaveButton>}>
          <LineField label="Описание" required autoFocus value={draft.description} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} />
          <div className="mt-[10px]"><LineSelect label="Магазин" required value={draft.store} onChange={(value) => setDraft((current) => ({ ...current, store: value }))} options={stores} /></div>
          <div className="mt-[10px]"><LineSelect label="Ответственный пользователь" required value={draft.responsible} onChange={(value) => setDraft((current) => ({ ...current, responsible: value }))} options={responsibles} /></div>
          <div className="mt-[10px]"><LineField label="Дата задачи" required value={taskDate} onChange={setTaskDate} /></div>
          <div className="mt-[18px]"><CheckBox checked={repeatPlan} onChange={setRepeatPlan} label="Повторить план" /></div>
        </Modal>
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
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f71dc] hover:text-[#4f71dc]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="inline-flex items-center h-[30px] rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </RefPage>
  )
}
