"use client"

import { FileText, Pencil, Plus, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

type Row = { id: number; attribute: string; values: string[]; textOnly?: boolean }
const names: string[] = []
const initial: Row[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "атрибут": "attribute", "attribute": "attribute",
  "значение": "value", "значения": "value", "value": "value",
}

export function AttributeValuesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [rows, setRows] = useState(initial)
  const [editing, setEditing] = useState<Row | null>(null)
  const [draft, setDraft] = useState({ attribute: names[0], value: "" })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-attribute-values")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить значения атрибутов")
        return (await response.json()) as Row[]
      })
      .then((data) => {
        if (!cancelled) setRows(data)
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  function open(row?: Row) { setEditing(row ?? { id: 0, attribute: names[0], values: [] }); setDraft({ attribute: row?.attribute ?? names[0], value: row?.values.join(", ") ?? "" }) }
  async function save(e: FormEvent) {
    e.preventDefault()
    const values = draft.value.split(",").map((value) => value.trim()).filter(Boolean)
    try {
      if (editing?.id) {
        const response = await fetch(`/api/client-attribute-values/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attribute: draft.attribute, values }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as Row
        setRows((list) => list.map((row) => (row.id === editing.id ? saved : row)))
      } else {
        const response = await fetch("/api/client-attribute-values", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attribute: draft.attribute, values }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as Row
        setRows((list) => [...list, saved])
      }
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-attribute-values/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setRows((list) => list.filter((item) => item.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }
  function downloadTemplate() {
    downloadExcelTable("attribute-values-template", [[t("Атрибут"), t("Значение")]])
  }
  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }
  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const excelRows = await readExcelRows(importFile)
      if (!excelRows.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const fieldByIndex = mapHeaderColumns(excelRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("attribute")
      const dataRows = hasHeader ? excelRows.slice(1) : excelRows
      const parsed: { attribute: string; values: string[] }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.attribute = row[0] ?? ""
          record.value = row[1] ?? ""
        }
        if (!record.attribute) continue
        parsed.push({
          attribute: record.attribute.trim(),
          values: (record.value || "").split(",").map((value) => value.trim()).filter(Boolean),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: Row[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-attribute-values", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as Row)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((list) => [...list, ...created])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }
  return <main className={embedded ? "min-w-0 flex-1 px-[38px] pb-8 pt-6" : "min-h-screen bg-white px-[38px] pb-8 pt-6 text-slate-800"}><div className="flex items-center justify-between border-b border-slate-200 pb-5"><div className="flex items-center gap-4"><button onClick={() => open()} className="text-[17px] text-[#5474e6] hover:underline">+ {t("Добавление значения")}</button><button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95"><FileText className="h-4 w-4" /> {t("Импорт с Excel")}</button></div><div className="text-slate-500">1 - {rows.length} {t("из")} {rows.length} <span className="ml-3 text-2xl text-slate-400">◀ ◉</span></div></div><div className="overflow-x-auto"><table className="w-full min-w-[800px] border-collapse text-[16px]"><thead><tr className="border-b-2 border-dotted border-slate-200 text-left"><th className="w-1/4 py-5 font-semibold">{t("Атрибут")}</th><th className="py-5 font-semibold">{t("Значение")}</th><th className="w-28" /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="group border-b-2 border-dotted border-slate-200 hover:bg-slate-50"><td className="py-5">{row.attribute}</td><td className="py-3">{row.textOnly ? <span>{t("Только ввод текста")}</span> : <div className="flex flex-wrap gap-3">{row.values.map((value) => <span key={value} className="rounded bg-slate-200 px-3 py-2">{value}</span>)}</div>}</td><td><div className="hidden justify-end gap-3 pr-4 text-slate-500 group-hover:flex"><button onClick={() => open(row)} aria-label={t("Изменить")}><Pencil className="h-5 w-5" /></button><button onClick={() => void remove(row.id)} aria-label={t("Удалить")}><Trash2 className="h-5 w-5" /></button></div></td></tr>)}</tbody></table></div>{editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{editing.id ? t("Изменить значение") : t("Добавить значение")}</h2><button type="button" onClick={() => setEditing(null)}><X /></button></div><label className="mb-2 block font-medium">{t("Атрибут")}</label><select value={draft.attribute} onChange={(e) => setDraft({ ...draft, attribute: e.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">{names.map((name) => <option key={name}>{name}</option>)}</select><label className="mb-2 block font-medium">{t("Значения через запятую")}</label><input autoFocus value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5" /><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">{t("Отмена")}</button><button className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white"><Plus className="h-4 w-4" />{t("Сохранить")}</button></div></form></div>}
    {importOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
        <div className="w-full max-w-md rounded bg-white">
          <header className="flex items-center justify-between border-b p-6">
            <b className="uppercase">{t("Импорт с Excel")}</b>
            <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label={t("Закрыть")}><X className="h-5 w-5" /></button>
          </header>
          <div className="p-8">
            <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#4f70e7] hover:underline">1. {t("Скачать шаблон")}</button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
            <button type="button" onClick={() => importInputRef.current?.click()} className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#4f70e7] hover:text-[#4f70e7]">
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
}
