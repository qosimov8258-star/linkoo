"use client"

import { LineField, Modal, SaveButton } from "@/components/analytics/catalog-ui"
import { ChevronLeft, ChevronRight, FileText, Pencil, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "должность": "name", "position": "name", "name": "name",
}

type Position = { id: number; name: string; date: string }

const seedPositions: Position[] = []

export function PositionsView({ embedded = false }: { embedded?: boolean }) {
  const [positions, setPositions] = useState(seedPositions)
  const [query, setQuery] = useState("")
  useEffect(() => {
    let cancelled = false
    fetch("/api/job-positions")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Position[]
      })
      .then((data) => {
        if (!cancelled) setPositions(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить должности с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Position | null>(null)
  const [name, setName] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  const filtered = useMemo(() => positions.filter((position) => position.name.toLowerCase().includes(query.toLowerCase())), [positions, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setName("")
    setEditing({ id: 0, name: "", date: "" })
  }

  function openEdit(position: Position) {
    setName(position.name)
    setEditing(position)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    try {
      if (editing?.id) {
        const response = await fetch(`/api/job-positions/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить должность")
          return
        }
        const saved = (await response.json()) as Position
        setPositions((list) => list.map((position) => (position.id === saved.id ? saved : position)))
      } else {
        const response = await fetch("/api/job-positions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name.trim() }),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать должность")
          return
        }
        const saved = (await response.json()) as Position
        setPositions((list) => [saved, ...list])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/job-positions/${id}`, { method: "DELETE" })
      if (!response.ok) {
        window.alert("Не удалось удалить должность")
        return
      }
      setPositions((list) => list.filter((position) => position.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("positions-template", [["Наименование"]])
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

      const names: string[] = []
      for (const row of dataRows) {
        let value = ""
        if (hasHeader) {
          row.forEach((cell, index) => {
            if (fieldByIndex.get(index) === "name") value = cell
          })
        } else {
          value = row[0] ?? ""
        }
        if (value.trim()) names.push(value.trim())
      }

      if (!names.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Position[] = []
      let failed = 0
      for (const item of names) {
        try {
          const response = await fetch("/api/job-positions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item }),
          })
          if (response.ok) created.push((await response.json()) as Position)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setPositions((list) => [...created, ...list])
      if (failed) window.alert(`Импортировано ${created.length} из ${names.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="text-[13px] text-[#4f71dc] hover:underline">
            + добавить должность
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f71dc]" />
            <Search className="absolute right-2 top-2 h-5 w-5 text-slate-300" />
          </label>
          <span className="ml-auto text-slate-500">25</span>
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
              <th className="px-9 py-4 text-[13px]">Id</th>
              <th className="px-5 py-4 text-[13px]">Наименование</th>
              <th className="px-5 py-4 text-[13px]">Дата создания</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {visible.map((position) => (
              <tr key={position.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{position.id}</td>
                <td className="px-5 py-4">{position.name}</td>
                <td className="px-5 py-4">{position.date}</td>
                <td>
                  <div className="hidden items-center justify-end gap-3 pr-4 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openEdit(position)} aria-label="Изменить">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(position.id)} aria-label="Удалить">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing.id ? "Изменить должность" : "Добавить должность"} onClose={() => setEditing(null)} footer={<SaveButton onClick={() => void save({ preventDefault() {} } as FormEvent)}>Сохранить</SaveButton>}>
          <LineField label="Наименование" required autoFocus value={name} onChange={setName} />
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
