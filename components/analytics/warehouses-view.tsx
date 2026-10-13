"use client"

import { ChevronLeft, ChevronRight, FileText, Pencil, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { WarehouseFormModal } from "./warehouse-form-modal"
import { warehouseBranchPool as branchPool, warehouseManagerPool as managers, type Warehouse } from "./warehouses-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "адрес": "address", "address": "address",
  "филиал": "branch", "branch": "branch",
  "зав склад": "manager", "заведующий": "manager", "manager": "manager",
}

export function WarehousesView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [tab, setTab] = useState<"active" | "inactive">("active")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<Warehouse | "new" | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/warehouses")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Warehouse[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить склады с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const scoped = useMemo(() => rows.filter((row) => row.active === (tab === "active")), [rows, tab])
  const filtered = useMemo(
    () => scoped.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || row.branch.toLowerCase().includes(query.toLowerCase())),
    [scoped, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function changeTab(next: "active" | "inactive") {
    setTab(next)
    setQuery("")
    setPage(1)
  }

  function openCreate() {
    setEditing("new")
  }

  function openEdit(row: Warehouse) {
    setEditing(row)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить склад?")) return
    try {
      const response = await fetch(`/api/warehouses/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить склад")
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("warehouses-template", [["Наименование", "Адрес", "Филиал", "Зав. склад"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const rowsRaw = await readExcelRows(importFile)
      if (!rowsRaw.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(rowsRaw[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? rowsRaw.slice(1) : rowsRaw

      const parsed: { name: string; address: string; branch: string; manager: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.address = row[1] ?? ""
          record.branch = row[2] ?? ""
          record.manager = row[3] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name.trim(),
          address: record.address || "Не указан",
          branch: record.branch || branchPool[0],
          manager: record.manager || managers[0],
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Warehouse[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/warehouses", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, address: item.address, branch: item.branch, manager: item.manager, online: true, active: true }),
          })
          if (response.ok) created.push((await response.json()) as Warehouse)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setRows((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-white"}>
      <div className="flex border-b border-slate-200 text-center">
        <button
          type="button"
          onClick={() => changeTab("active")}
          className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "active" ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
        >
          Активные
        </button>
        <button
          type="button"
          onClick={() => changeTab("inactive")}
          className={`flex-1 border-b-2 py-4 text-[15px] font-medium ${tab === "inactive" ? "border-[#4f71dc] text-[#4f71dc]" : "border-transparent text-slate-600 hover:text-slate-800"}`}
        >
          Не активные
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-4 px-5 py-4">
        <button type="button" onClick={openCreate} className="text-[15px] text-[#4f71dc] hover:underline">
          + добавить склад
        </button>
        <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1 text-[15px] text-[#4f71dc] hover:underline">
          <FileText className="h-4 w-4" /> Импорт с Excel
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
            <th className="px-9 py-5">Id</th>
            <th className="px-5 py-5">Наименование</th>
            <th className="px-5 py-5">Адрес</th>
            <th className="px-5 py-5">Филиал</th>
            <th className="px-5 py-5">Зав. склад</th>
            <th className="px-5 py-5">Дата создания</th>
            <th className="px-5 py-5">Вэнсел</th>
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={8} className="px-9 py-10 text-center text-slate-400">Загрузка складов...</td></tr>
          ) : loadError ? (
            <tr><td colSpan={8} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
          ) : visible.map((row) => (
            <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
              <td className="px-9 py-4">{row.id}</td>
              <td className="px-5 py-4 text-[#4f71dc]">{row.name}</td>
              <td className="px-5 py-4">{row.address}</td>
              <td className="px-5 py-4">{row.branch}</td>
              <td className="px-5 py-4">{row.manager}</td>
              <td className="px-5 py-4">{row.createdDate}</td>
              <td className="px-5 py-4">
                <span className={`inline-block h-3 w-3 rounded-full ${row.online ? "bg-emerald-500" : "bg-rose-500"}`} />
              </td>
              <td className="px-5 py-4">
                <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                  <button type="button" onClick={() => openEdit(row)} aria-label="Изменить">
                    <Pencil className="h-5 w-5" />
                  </button>
                  <button type="button" onClick={() => remove(row.id)} aria-label="Удалить">
                    <Trash2 className="h-5 w-5" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!loading && !loadError && visible.length === 0 && (
            <tr>
              <td colSpan={8} className="px-9 py-10 text-center text-slate-400">
                Ничего не найдено
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {editing !== null && (
        <WarehouseFormModal
          warehouse={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setRows((current) => (editing !== "new" ? current.map((row) => (row.id === saved.id ? saved : row)) : [saved, ...current]))
            setEditing(null)
          }}
        />
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
