"use client"

import { FileText, Pencil, Plus, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

type Attribute = { id: number; name: string; fieldType: string; required: boolean }

const fieldTypeOptions = ["Выбор вариантов", "Текстовое поле", "Цифровое поле"]

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "тип поля": "fieldType", "тип": "fieldType", "field type": "fieldType",
  "обязательный": "required", "обязательно": "required", "required": "required",
}

function parseRequired(value: string) {
  return /^(да|yes|true|1|обязательно|обязательный)$/i.test(value.trim())
}

export function AttributesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [items, setItems] = useState<Attribute[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [editing, setEditing] = useState<Attribute | null>(null)
  const [draft, setDraft] = useState({ name: "", fieldType: "Выбор вариантов", required: false })
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/client-attributes")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить атрибуты")
        return (await response.json()) as Attribute[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError(t("Не удалось загрузить атрибуты с сервера"))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function open(attribute?: Attribute) { setEditing(attribute ?? { id: 0, name: "", fieldType: "Выбор вариантов", required: false }); setDraft(attribute ? { name: attribute.name, fieldType: attribute.fieldType, required: attribute.required } : { name: "", fieldType: "Выбор вариантов", required: false }) }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    setSaving(true)
    try {
      const isEdit = !!editing?.id
      const response = await fetch(isEdit ? `/api/client-attributes/${editing!.id}` : "/api/client-attributes", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draft.name.trim(), fieldType: draft.fieldType, required: draft.required }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось сохранить атрибут"))
        return
      }
      const saved = (await response.json()) as Attribute
      setItems((list) => (isEdit ? list.map((item) => (item.id === saved.id ? saved : item)) : [...list, saved]))
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-attributes/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || t("Не удалось удалить атрибут"))
        return
      }
      setItems((list) => list.filter((row) => row.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("attributes-template", [[t("Название"), t("Тип поля"), t("Обязательный")]])
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
      const parsed: { name: string; fieldType: string; required: boolean }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.fieldType = row[1] ?? ""
          record.required = row[2] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          fieldType: fieldTypeOptions.includes(record.fieldType) ? record.fieldType : fieldTypeOptions[0],
          required: parseRequired(record.required || ""),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: Attribute[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-attributes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Attribute)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((list) => [...list, ...created])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }
  return <main className={embedded ? "min-w-0 flex-1 px-[38px] pb-8 pt-6" : "min-h-screen bg-white px-[38px] pb-8 pt-6 text-slate-800"}>
    <div className="flex items-center justify-between border-b border-slate-200 pb-5"><div className="flex items-center gap-4"><button onClick={() => open()} className="text-[17px] text-[#5474e6] hover:underline">+ {t("добавить атрибуты")}</button><button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95"><FileText className="h-4 w-4" /> {t("Импорт с Excel")}</button></div><div className="text-slate-500">{t("1 -")} {items.length} {t("из")} {items.length} <span className="ml-3 text-2xl text-slate-400">◀ ◉</span></div></div>
    {loadError && <p className="pt-3 text-sm text-red-500">{loadError}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-[16px]"><thead><tr className="border-b-2 border-dotted border-slate-200 text-left"><th className="w-[34%] py-5 font-semibold">{t("Название")}</th><th className="w-[26%] py-5 font-semibold">{t("Тип поля")}</th><th className="py-5 font-semibold">{t("Обязательный к заполнению")}</th><th className="w-28" /></tr></thead><tbody>{loading ? <tr><td colSpan={4} className="py-10 text-center text-slate-400">{t("Загрузка...")}</td></tr> : items.map((item) => <tr key={item.id} className="group border-b-2 border-dotted border-slate-200 hover:bg-slate-50"><td className="py-5">{item.name}</td><td className="py-5">{t(item.fieldType)}</td><td className="py-5">{t(item.required ? "Обязательный" : "Не обязательный")}</td><td><div className="hidden justify-end gap-3 pr-4 text-slate-500 group-hover:flex"><button onClick={() => open(item)} aria-label={t("Изменить")}><Pencil className="h-5 w-5" /></button><button onClick={() => remove(item.id)} aria-label={t("Удалить")}><Trash2 className="h-5 w-5" /></button></div></td></tr>)}</tbody></table></div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{t(editing.id ? "Изменить атрибут" : "Добавить атрибут")}</h2><button type="button" onClick={() => setEditing(null)}><X /></button></div><label className="mb-2 block font-medium">{t("Название")}</label><input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" /><label className="mb-2 block font-medium">{t("Тип поля")}</label><select value={draft.fieldType} onChange={(e) => setDraft({ ...draft, fieldType: e.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5"><option value="Выбор вариантов">{t("Выбор вариантов")}</option><option value="Текстовое поле">{t("Текстовое поле")}</option><option value="Цифровое поле">{t("Цифровое поле")}</option></select><label className="mt-4 flex gap-2"><input type="checkbox" checked={draft.required} onChange={(e) => setDraft({ ...draft, required: e.target.checked })} />{t("Обязательный к заполнению")}</label><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">{t("Отмена")}</button><button disabled={saving} className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white disabled:opacity-60"><Plus className="h-4 w-4" />{t(saving ? "Сохранение..." : "Сохранить")}</button></div></form></div>}
    {importOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-md rounded bg-white">
          <header className="flex items-center justify-between border-b p-6">
            <b className="uppercase">{t("Импорт с Excel")}</b>
            <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
          </header>
          <div className="p-8">
            <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">{t("1. Скачать шаблон")}</button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
            <button type="button" onClick={() => importInputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]">
              <FileText className="h-8 w-8" />
              {importFile ? importFile.name : t("Добавьте файл Excel или нажмите для выбора")}
            </button>
          </div>
          <footer className="flex justify-end border-t p-5">
            <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded bg-[#6ccd8b] px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
              {t(importSaving ? "Импорт..." : "Сохранить")}
            </button>
          </footer>
        </div>
      </div>
    )}
  </main>
}
