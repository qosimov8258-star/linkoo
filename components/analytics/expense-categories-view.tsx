"use client"

import { ChevronLeft, ChevronRight, FileText, Pencil, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { expenseParameterOptions as parameterOptions, type ExpenseCategory } from "./expense-categories-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "родительская категория": "parentName", "родитель": "parentName", "parent category": "parentName",
  "параметр": "parameter", "параметры": "parameter", "parameter": "parameter",
  "прямой расход": "direct", "direct expense": "direct",
  "не учитывать в pnl": "excludeFromPnl", "исключить из pnl": "excludeFromPnl", "не учитывать в p l": "excludeFromPnl",
}

function parseBool(value: string) {
  return /^(да|yes|true|1|\+|✓)$/i.test(value.trim())
}

function emptyDraft() {
  return { name: "", parentId: "", hasParameter: false, parameter: parameterOptions[0], direct: false, excludeFromPnl: false }
}

export function ExpenseCategoriesView({ embedded = false }: { embedded?: boolean }) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/expense-categories")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить категории расходов")
        return (await response.json()) as ExpenseCategory[]
      })
      .then((data) => {
        if (cancelled) return
        setCategories(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить категории расходов с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return categories
    const q = query.trim().toLowerCase()
    return categories.filter((category) => category.name.toLowerCase().includes(q))
  }, [categories, query])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function parentName(parentId: number | null) {
    if (parentId === null) return "Не указано"
    return categories.find((category) => category.id === parentId)?.name ?? "Не указано"
  }

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(category: ExpenseCategory) {
    setDraft({
      name: category.name, parentId: category.parentId !== null ? String(category.parentId) : "",
      hasParameter: Boolean(category.parameter), parameter: category.parameter || parameterOptions[0],
      direct: category.direct, excludeFromPnl: category.excludeFromPnl,
    })
    setFormError("")
    setEditingId(category.id)
    setModalOpen(true)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить категорию расходов?")) return
    try {
      const response = await fetch(`/api/expense-categories/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить категорию")
        return
      }
      // Server also removes direct children pointing at this category — mirror that locally.
      setCategories((current) => current.filter((category) => category.id !== id && category.parentId !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name) return
    const parameter = draft.hasParameter ? draft.parameter : ""
    const parentId = draft.parentId ? Number(draft.parentId) : null

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editingId !== null
      const response = await fetch(isEdit ? `/api/expense-categories/${editingId}` : "/api/expense-categories", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parameter, parentId, direct: draft.direct, excludeFromPnl: draft.excludeFromPnl }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить категорию")
        return
      }
      const saved = (await response.json()) as ExpenseCategory
      setCategories((current) => (isEdit ? current.map((category) => (category.id === editingId ? saved : category)) : [saved, ...current]))
      setModalOpen(false)
      setPage(1)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("expense-categories-template", [["Наименование", "Родительская категория", "Параметры", "Прямой расход (да/нет)", "Не учитывать в P&L (да/нет)"]])
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

      type ParsedCategory = { name: string; parameter: string; parentId: number | null; direct: boolean; excludeFromPnl: boolean }
      const parsed: ParsedCategory[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.parentName = row[1] ?? ""
          record.parameter = row[2] ?? ""
          record.direct = row[3] ?? ""
          record.excludeFromPnl = row[4] ?? ""
        }
        if (!record.name) continue
        const parent = record.parentName ? categories.find((category) => category.name.toLowerCase() === record.parentName.trim().toLowerCase()) : undefined
        parsed.push({
          name: record.name.trim(),
          parameter: record.parameter?.trim() || "",
          parentId: parent ? parent.id : null,
          direct: parseBool(record.direct || ""),
          excludeFromPnl: parseBool(record.excludeFromPnl || ""),
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: ExpenseCategory[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/expense-categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ExpenseCategory)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) { setCategories((current) => [...created, ...current]); setPage(1) }
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white px-9 py-5"}>
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f71dc] hover:underline">
          + добавить категорию расходов
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className="flex items-center gap-1 text-[16px] text-[#4f71dc] hover:underline">
          <FileText className="h-4 w-4" /> Импорт с Excel
        </button>
        <label className="relative ml-auto w-64">
          <input
            value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(1) }}
            placeholder="Поиск"
            className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]"
          />
          <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
        </label>
        <span className="text-slate-500">25</span>
        <span className="text-slate-500">
          {filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}
        </span>
        <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage <= 1} aria-label="Назад" className="disabled:opacity-30">
          <ChevronLeft className="h-5 w-5 text-slate-400" />
        </button>
        <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage >= pageCount} aria-label="Вперед" className="disabled:opacity-30">
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </button>
      </div>

      <table className="w-full text-left">
        <thead className="bg-[#5d6474] text-white">
          <tr>
            <th className="px-9 py-5">Наименование</th>
            <th className="px-5 py-5">Параметры</th>
            <th className="px-5 py-5">Род. категория</th>
            <th className="px-5 py-5">Дата создания</th>
            <th className="px-5 py-5">Внутренний расход</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={6} className="px-9 py-10 text-center text-slate-400">Загрузка категорий...</td></tr>
          ) : loadError ? (
            <tr><td colSpan={6} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
          ) : visible.map((category) => (
            <tr key={category.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
              <td className="px-9 py-4 font-medium">{category.name}</td>
              <td className="px-5 py-4">
                {category.parameter && (
                  <span className="inline-block rounded bg-slate-100 px-3 py-1.5 text-sm text-slate-600">{category.parameter}</span>
                )}
              </td>
              <td className="px-5 py-4">{parentName(category.parentId)}</td>
              <td className="px-5 py-4">{category.createdDate}</td>
              <td className="px-5 py-4">{category.direct ? "Прямой расход на товар" : "Косвенный расход"}</td>
              <td className="px-5 py-4">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(category)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(category.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!loading && !loadError && visible.length === 0 && (
            <tr>
              <td colSpan={6} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editingId !== null ? "Изменить категорию расходов" : "Добавить категорию расходов"}</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Родительская категория
                <select value={draft.parentId} onChange={(event) => setDraft((value) => ({ ...value, parentId: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Не указано</option>
                  {categories.filter((category) => editingId === null || category.id !== editingId).map((category) => (
                    <option key={category.id} value={category.id}>{category.name}</option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.hasParameter} onChange={(event) => setDraft((value) => ({ ...value, hasParameter: event.target.checked }))} className="h-4 w-4 accent-[#4f71dc]" />
                Дополнительные параметры
              </label>
              {draft.hasParameter && (
                <select value={draft.parameter} onChange={(event) => setDraft((value) => ({ ...value, parameter: event.target.value }))} className="ml-6 rounded border border-slate-300 px-2 py-1.5 text-sm">
                  {parameterOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              )}
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={draft.direct} onChange={(event) => setDraft((value) => ({ ...value, direct: event.target.checked }))} className="mt-1 h-4 w-4 accent-[#4f71dc]" />
                <span>Это прямой расход на товар который связан с себестоимостью товара (Это тип расхода не будет показываться в генеральном отчете как косвенный расход)</span>
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={draft.excludeFromPnl} onChange={(event) => setDraft((value) => ({ ...value, excludeFromPnl: event.target.checked }))} className="h-4 w-4 accent-[#4f71dc]" />
                Не учитывать в отчёте P&L
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
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
    </main>
  )
}
