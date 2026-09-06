"use client"

import { FileText, Pencil, Plus, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { useLanguage } from "@/lib/i18n/language-context"

type ClientType = { id: number; name: string; supplier: string; date: string }

const initialTypes: ClientType[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "доставщик": "supplier", "supplier": "supplier",
}

function todayLabel() {
  return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date())
}

export function ClientTypesView({ embedded = false }: { embedded?: boolean }) {
  const { t } = useLanguage()
  const [items, setItems] = useState(initialTypes)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<ClientType | null>(null)
  const [draft, setDraft] = useState({ name: "", supplier: "" })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/client-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы клиентов")
        return (await response.json()) as ClientType[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = items.filter((item) => `${item.name} ${item.supplier}`.toLowerCase().includes(query.toLowerCase()))
  function openAdd() { setEditing({ id: 0, name: "", supplier: "", date: "" }); setDraft({ name: "", supplier: "" }) }
  function openEdit(item: ClientType) { setEditing(item); setDraft({ name: item.name, supplier: item.supplier }) }
  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    try {
      if (editing?.id) {
        const response = await fetch(`/api/client-types/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier.trim() }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as ClientType
        setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      } else {
        const response = await fetch("/api/client-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: draft.name.trim(), supplier: draft.supplier.trim() }),
        })
        if (!response.ok) return
        const saved = (await response.json()) as ClientType
        setItems((current) => [saved, ...current])
      }
      setEditing(null)
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/client-types/${id}`, { method: "DELETE" })
      if (!response.ok) return
      setItems((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert(t("Сервер недоступен, попробуйте ещё раз"))
    }
  }

  function downloadTemplate() {
    downloadExcelTable("client-types-template", [[t("Наименование"), t("Доставщик")]])
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
      const parsed: { name: string; supplier: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.supplier = row[1] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          supplier: record.supplier.trim() || t("Не указано"),
        })
      }
      if (!parsed.length) {
        window.alert(t("Не удалось найти данные для импорта в выбранном файле"))
        return
      }
      const created: ClientType[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/client-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as ClientType)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((current) => [...created, ...current])
      if (failed) window.alert(`${t("Импортировано")} ${created.length} ${t("из")} ${parsed.length}. ${t("Не удалось сохранить")}: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return <main className={embedded ? "min-w-0 flex-1" : "min-h-screen bg-white text-slate-800"}>
    <div className="px-7 py-5"><div className="flex items-center justify-between"><div className="flex items-center gap-4"><button onClick={openAdd} className="text-[17px] text-[#5474e6] hover:underline">+ {t("добавить тип клиента")}</button><button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2 text-sm font-semibold text-white hover:brightness-95"><FileText className="h-4 w-4" /> {t("Импорт с Excel")}</button></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("Поиск")} className="w-56 border-b border-slate-300 px-2 py-2 outline-none focus:border-[#5474e6]" /></div></div>
    <div className="overflow-x-auto"><table className="w-full min-w-[800px] border-collapse text-[16px]"><thead className="bg-[#626b7e] text-left text-white"><tr><th className="px-9 py-5">{t("Наименование")}</th><th className="px-8 py-5">{t("Доставщик")}</th><th className="px-8 py-5">{t("Дата создания")}</th><th className="w-28 px-5 py-5" /></tr></thead><tbody>{visible.map((item) => <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50"><td className="px-9 py-[18px] font-medium">{item.name}</td><td className="px-8 py-[18px]">{item.supplier}</td><td className="px-8 py-[18px]">{item.date}</td><td className="px-4 py-[18px]"><div className="hidden justify-end gap-3 text-slate-500 group-hover:flex"><button onClick={() => openEdit(item)} aria-label={t("Изменить")}><Pencil className="h-5 w-5" /></button><button onClick={() => void remove(item.id)} aria-label={t("Удалить")}><Trash2 className="h-5 w-5" /></button></div></td></tr>)}</tbody></table></div>
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"><form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"><div className="mb-6 flex items-center justify-between"><h2 className="text-xl font-bold">{editing.id ? t("Изменить тип клиента") : t("Добавить тип клиента")}</h2><button type="button" onClick={() => setEditing(null)}><X /></button></div><label className="mb-2 block font-medium">{t("Наименование")}</label><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" /><label className="mb-2 block font-medium">{t("Доставщик")}</label><input value={draft.supplier} onChange={(event) => setDraft({ ...draft, supplier: event.target.value })} className="w-full rounded border border-slate-300 px-3 py-2.5" /><div className="mt-6 flex justify-end gap-3"><button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">{t("Отмена")}</button><button className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white"><Plus className="h-4 w-4" />{t("Сохранить")}</button></div></form></div>}
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
