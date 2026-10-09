"use client"

import { FileText, Pencil, Trash2, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"
import type { SupplierCategory as Category } from "./supplier-categories-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "категория": "name", "name": "name",
}

export function SupplierCategoriesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
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
        setFormError(data.error ? t(data.error) : t("Не удалось сохранить категорию"))
        return
      }
      const saved = (await response.json()) as Category
      setCategories((current) => (isEdit ? current.map((category) => (category.id === id ? saved : category)) : [...current, saved]))
      setEditing(null)
    } catch {
      setFormError(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!window.confirm(t("Удалить категорию поставщика?"))) return
    try {
      const response = await fetch(`/api/supplier-categories/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error ? t(data.error) : t("Не удалось удалить категорию"))
        return
      }
      setCategories((current) => current.filter((category) => category.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("supplier-categories-template", [[t("Наименование")]])
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
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
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
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
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
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> {t("Категории поставщиков")}
          </h1>
        </header>
      )}

      <div className={embedded ? "" : ""}>
        <div className="mb-4 flex flex-wrap items-center gap-4">
          <button type="button" onClick={openCreate} className="text-[17px] text-[#4f70e7] hover:underline">
            + {t("Добавить категорию")}
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <FileText className="h-4 w-4" /> {t("Импорт с Excel")}
          </button>
        </div>

        <div className="overflow-hidden rounded bg-white shadow">
          <table className="w-full text-left">
            <thead className="bg-[#626b7e] text-white">
              <tr>
                <th className="px-9 py-5">{t("Категории")}</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={2} className="px-9 py-10 text-center text-slate-400">{t("Загрузка категорий...")}</td></tr>
              ) : loadError ? (
                <tr><td colSpan={2} className="px-9 py-10 text-center text-red-600">{t(loadError)}</td></tr>
              ) : categories.map((category) => (
                <tr key={category.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-5">{category.name}</td>
                  <td className="px-5 py-5">
                    <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                      <button type="button" onClick={() => openEdit(category)} aria-label={t("Изменить")}>
                        <Pencil className="h-5 w-5" />
                      </button>
                      <button type="button" onClick={() => remove(category.id)} aria-label={t("Удалить")}>
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !loadError && categories.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-9 py-10 text-center text-slate-400">
                    {t("Ничего не найдено")}
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
              <b className="uppercase">{editing === "new" ? t("Добавить категорию") : t("Изменить категорию")}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                {t("Наименование категории")} <span className="text-red-500">*</span>
                <input autoFocus value={name} onChange={(event) => setName(event.target.value)} className="mt-2 block w-full outline-none" />
              </label>
              {formError && <p className="mt-3 text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={!name.trim() || saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {saving ? t("Сохранение...") : t("Сохранить")}
              </button>
            </footer>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{t("Импорт с Excel")}</b>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}>
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="p-8">
              <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">
                1. {t("Скачать шаблон")}
              </button>
              <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
              <button
                type="button"
                onClick={() => importInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? t("Импорт...") : t("Сохранить")}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
