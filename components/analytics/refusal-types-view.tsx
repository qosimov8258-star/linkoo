"use client"

import { LineField, Modal, SaveLink } from "@/components/analytics/catalog-ui"
import { ChevronLeft, ChevronRight, FileText, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

type RefusalType = { id: number; name: string; resolution: string }

const seed: RefusalType[] = []

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "решение": "resolution",
}

export function RefusalTypesView({ embedded = false }: { embedded?: boolean }) {
  const [items, setItems] = useState(seed)
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<RefusalType | null>(null)
  const [draft, setDraft] = useState({ name: "", resolution: "" })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/refusal-types")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить типы отказов")
        return (await response.json()) as RefusalType[]
      })
      .then((data) => {
        if (!cancelled) setItems(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить типы отказов с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo(
    () => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()) || item.resolution.toLowerCase().includes(query.toLowerCase())),
    [items, query],
  )

  function open(item?: RefusalType) {
    setEditing(item ?? { id: 0, name: "", resolution: "" })
    setDraft(item ? { name: item.name, resolution: item.resolution } : { name: "", resolution: "" })
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    const body = JSON.stringify({ name: draft.name.trim(), resolution: draft.resolution })
    try {
      if (editing?.id) {
        const response = await fetch(`/api/refusal-types/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить тип отказа")
          return
        }
        const saved = (await response.json()) as RefusalType
        setItems((list) => list.map((item) => (item.id === editing.id ? saved : item)))
      } else {
        const response = await fetch("/api/refusal-types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать тип отказа")
          return
        }
        const saved = (await response.json()) as RefusalType
        setItems((list) => [saved, ...list])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/refusal-types/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить тип отказа")
        return
      }
      setItems((list) => list.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("refusal-types-template", [["Наименование", "Решение"]])
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

      const parsed: { name: string; resolution: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.resolution = row[1] ?? ""
        }
        if (!record.name) continue
        parsed.push({ name: record.name.trim(), resolution: record.resolution || "" })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: RefusalType[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/refusal-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as RefusalType)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setItems((current) => [...created, ...current])
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
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> Тип отказа
          </h1>
        </header>
      )}

      <section className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={() => open()} className="text-[13px] text-[#4f71dc] hover:underline">
            + добавить
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
          <span className="text-slate-500">
            1 - {rows.length} из {rows.length}
          </span>
          <ChevronLeft className="h-5 w-5 text-slate-300" />
          <ChevronRight className="h-5 w-5 text-slate-300" />
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-4 text-[13px]">№</th>
              <th className="px-5 py-4 text-[13px]">Наименование</th>
              <th className="px-5 py-4 text-[13px]">Решение</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => (
              <tr key={item.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{item.id}</td>
                <td className="px-5 py-4 text-[#e0972a]">{item.name}</td>
                <td className="px-5 py-4 text-slate-700">{item.resolution}</td>
                <td>
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => open(item)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(item.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {editing && (
        <Modal title={editing.id ? "Изменить тип отказа" : "Добавить тип отказа"} onClose={() => setEditing(null)} footer={<SaveLink onClick={() => void save({ preventDefault() {} } as FormEvent)}>Сохранить</SaveLink>}>
          <LineField label="Название тип отказа" required autoFocus value={draft.name} onChange={(value) => setDraft({ ...draft, name: value })} />
          <div className="mt-[20px]"><LineField label="Решение" required value={draft.resolution} onChange={(value) => setDraft({ ...draft, resolution: value })} /></div>
        </Modal>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">Импорт с Excel</h2>
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <button type="button" onClick={downloadTemplate} className="mb-4 font-semibold text-[#5474e6] hover:underline">
              1. Скачать шаблон
            </button>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={pickImportFile} className="hidden" />
            <button
              type="button"
              onClick={() => importInputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-[#5474e6] hover:text-[#5474e6]"
            >
              <FileText className="h-8 w-8" />
              {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
            </button>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => { setImportOpen(false); setImportFile(null) }} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
