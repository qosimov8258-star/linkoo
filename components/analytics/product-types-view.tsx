"use client"

import { FileText, ImagePlus, Pencil, Trash2, X } from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { productTypeOrganizations as organizations, type ProductType } from "./product-types-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование категории": "name", "название": "name", "наименование": "name", "name": "name",
  "организация": "organization", "organization": "organization",
  "показывать в боте": "showInBot",
  "родительская категория": "parentName",
}

function emptyDraft() {
  return { parentId: "", name: "", organization: organizations[0], order: "", showInBot: false, photoName: "" }
}

export function ProductTypesView({ embedded = false }: { embedded?: boolean }) {
  const [types, setTypes] = useState<ProductType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<ProductType | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/product-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы продуктов")
        return (await response.json()) as ProductType[]
      })
      .then((data) => {
        if (cancelled) return
        setTypes(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить типы продуктов с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const topLevel = types.filter((type) => type.parentId === null)
  const childrenOf = (id: number) => types.filter((type) => type.parentId === id)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(type: ProductType) {
    setDraft({
      parentId: type.parentId !== null ? String(type.parentId) : "",
      name: type.name,
      organization: type.organization,
      order: "",
      showInBot: type.showInBot,
      photoName: "",
    })
    setFormError("")
    setEditing(type)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить тип продукта?")) return
    try {
      const response = await fetch(`/api/product-types/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить тип продукта")
        return
      }
      // Server also removes direct children pointing at this type — mirror that locally.
      setTypes((current) => current.filter((type) => type.id !== id && type.parentId !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function pickPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (file) setDraft((value) => ({ ...value, photoName: file.name }))
    event.target.value = ""
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.name.trim()
    if (!trimmed || !draft.organization) return
    const parentId = draft.parentId ? Number(draft.parentId) : null

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const targetId = isEdit ? (editing as ProductType).id : null
      const response = await fetch(isEdit ? `/api/product-types/${targetId}` : "/api/product-types", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, organization: draft.organization, showInBot: draft.showInBot, parentId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить тип продукта")
        return
      }
      const saved = (await response.json()) as ProductType
      setTypes((current) => (isEdit ? current.map((type) => (type.id === targetId ? saved : type)) : [...current, saved]))
      setEditing(null)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("product-types-template", [["Наименование категории", "Организация", "Показывать в боте", "Родительская категория"]])
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

      const parsed: { name: string; organization: string; showInBot: boolean; parentId: number | null }[] = []
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
          record.showInBot = row[2] ?? ""
          record.parentName = row[3] ?? ""
        }
        if (!record.name) continue
        const parent = record.parentName
          ? topLevel.find((type) => type.name.trim().toLowerCase() === record.parentName.trim().toLowerCase())
          : undefined
        parsed.push({
          name: record.name.trim(),
          organization: record.organization || organizations[0],
          showInBot: /^(да|yes|true|1)$/i.test((record.showInBot || "").trim()),
          parentId: parent ? parent.id : null,
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: ProductType[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/product-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ProductType)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setTypes((current) => [...current, ...created])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  function renderRow(type: ProductType, isChild: boolean) {
    return (
      <tr key={type.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
        <td className={isChild ? "py-4 pl-20 pr-5" : "px-9 py-4 font-medium"}>{type.name}</td>
        <td className="px-5 py-4">{type.organization}</td>
        <td className="px-5 py-4">{type.createdDate}</td>
        <td className="px-5 py-4">{type.showInBot ? "Да" : "Нет"}</td>
        <td className="px-5 py-4">
          <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
            <button type="button" onClick={() => openEdit(type)} aria-label="Изменить">
              <Pencil className="h-5 w-5" />
            </button>
            <button type="button" onClick={() => remove(type.id)} aria-label="Удалить">
              <Trash2 className="h-5 w-5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white px-9 py-5"}>
      <div className="mb-4 flex flex-wrap items-center gap-5">
        <button type="button" onClick={openCreate} className="text-[16px] text-[#4f70e7] hover:underline">
          + добавить тип продукта
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 text-[16px] text-[#4f70e7] hover:underline">
          <FileText className="h-4 w-4" /> Импорт с Excel
        </button>
      </div>

      <table className="w-full text-left">
        <thead className="bg-[#626b7e] text-white">
          <tr>
            <th className="px-9 py-5">Категории</th>
            <th className="px-5 py-5">Организация</th>
            <th className="px-5 py-5">Дата создания</th>
            <th className="px-5 py-5">Показывать в боте</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={5} className="px-9 py-10 text-center text-slate-400">Загрузка типов продуктов...</td></tr>
          ) : loadError ? (
            <tr><td colSpan={5} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
          ) : (
            topLevel.map((type) => (
              <Fragment key={type.id}>
                {renderRow(type, false)}
                {childrenOf(type.id).map((child) => renderRow(child, true))}
              </Fragment>
            ))
          )}
          {!loading && !loadError && types.length === 0 && (
            <tr>
              <td colSpan={5} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить тип продукта" : "Изменить тип продукта"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X className="h-5 w-5" />
              </button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Родительская категория
                <select value={draft.parentId} onChange={(event) => setDraft((value) => ({ ...value, parentId: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option value="">Нет</option>
                  {topLevel.filter((type) => editing === "new" || type.id !== (editing as ProductType).id).map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование категории <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Организация <span className="text-red-500">*</span>
                <select value={draft.organization} onChange={(event) => setDraft((value) => ({ ...value, organization: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {organizations.map((org) => <option key={org}>{org}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Порядок
                <input type="number" value={draft.order} onChange={(event) => setDraft((value) => ({ ...value, order: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>

              <input ref={fileInputRef} type="file" accept="image/*" onChange={pickPhoto} className="hidden" />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded border-2 border-dashed border-slate-300 py-8 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]"
              >
                <ImagePlus className="h-8 w-8" />
                {draft.photoName || "Добавьте фото"}
              </button>

              <label className="flex items-center justify-between gap-3">
                <span>
                  <span className="block font-medium text-slate-800">Показывать в боте</span>
                  <span className="block text-xs text-slate-500">Показывать в телеграм боте</span>
                </span>
                <button
                  type="button"
                  onClick={() => setDraft((value) => ({ ...value, showInBot: !value.showInBot }))}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${draft.showInBot ? "bg-[#4f70e7]" : "bg-slate-300"}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${draft.showInBot ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
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
