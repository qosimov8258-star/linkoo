"use client"

import { FileText, Pencil, Trash2, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import type { SupplierCategory as Category } from "./supplier-categories-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "категория": "name", "name": "name",
}

export function SupplierCategoriesView({ embedded = false }: { embedded?: boolean }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<Category | "new" | null>(null)
  const [name, setName] = useState("")
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/supplier-categories")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Category[]
      })
      .then((data) => {
        if (cancelled) return
        setCategories(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить категории поставщиков с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function openCreate() {
    setName("")
    setFormError("")
    setEditing("new")
  }

  function openEdit(category: Category) {
    setName(category.name)
    setFormError("")
    setEditing(category)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const id = isEdit ? (editing as Category).id : null
      const response = await fetch(isEdit ? `/api/supplier-categories/${id}` : "/api/supplier-categories", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить категорию")
        return
      }
      const saved = (await response.json()) as Category
      setCategories((current) => (isEdit ? current.map((category) => (category.id === id ? saved : category)) : [...current, saved]))
      setEditing(null)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить категорию поставщика?")) return
    try {
      const response = await fetch(`/api/supplier-categories/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить категорию")
        return
      }
      setCategories((current) => current.filter((category) => category.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("supplier-categories-template", [["Наименование"]])
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

      const parsed: string[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
        }
        if (!record.name) continue
        parsed.push(record.name)
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Category[] = []
      let failed = 0
      for (const name of parsed) {
        try {
          const response = await fetch("/api/supplier-categories", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name }),
          })
          if (response.ok) created.push((await response.json()) as Category)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setCategories((current) => [...current, ...created])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> Категории поставщиков
          </h1>
        </header>
      )}

      <div className={embedded ? "" : ""}>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={openCreate} className="text-[13px] text-[#4f71dc] hover:underline">
            + Добавить категорию поставщика
          </button>
        </div>

        <div className="overflow-hidden rounded bg-white shadow">
          <table className="w-full text-left">
            <thead className="bg-[#5d6474] text-white">
              <tr>
                <th className="px-9 py-4 text-[13px]">Категории</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={2} className="px-9 py-10 text-center text-slate-400">Загрузка категорий...</td></tr>
              ) : loadError ? (
                <tr><td colSpan={2} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
              ) : categories.map((category) => (
                <tr key={category.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4 text-[13px] font-bold">{category.name}</td>
                  <td className="px-5 py-4 text-[13px]">
                    <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
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
              {!loading && !loadError && categories.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-9 py-10 text-center text-slate-400">
                    Ничего не найдено
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить тип поставщика" : "Изменить тип поставщика"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование категории <span className="text-red-500">*</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
              </label>
              {formError && <p className="mt-3 text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={!name.trim() || saving} className="rounded bg-[#71ce87] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
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
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="inline-flex items-center h-[30px] rounded-[5px] bg-[#71ce87] px-4 text-[13px] font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
