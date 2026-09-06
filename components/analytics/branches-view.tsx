"use client"

import { ChevronLeft, ChevronRight, FileText, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "прайс лист": "priceList", "price list": "priceList",
  "валюта": "currency", "currency": "currency",
}

type Branch = {
  id: number
  name: string
  date: string
  debtTracking: boolean
  isMain: boolean
  priceList: string
  currency: "SUM" | "USD" | "Euro"
}

const priceLists = ["donalik", "11111", "123123123", "asus vivobook", "attack", "Attack250", "Шт14", "savdo", "Bozor narx", "tovar"]

const seedBranches: Branch[] = []

export const branchNames = seedBranches.map((branch) => branch.name)

export function BranchesView({ embedded = false }: { embedded?: boolean }) {
  const [branches, setBranches] = useState(seedBranches)
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Branch | null>(null)
  const [draft, setDraft] = useState({ name: "", priceList: priceLists[0], currency: "SUM" as Branch["currency"], debtTracking: true, isMain: false })
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const [loadError, setLoadError] = useState("")
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    fetch("/api/branches")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить филиалы")
        return (await response.json()) as Branch[]
      })
      .then((data) => {
        if (!cancelled) {
          setBranches(data)
          setLoadError("")
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить филиалы с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => branches.filter((branch) => branch.name.toLowerCase().includes(query.toLowerCase())), [branches, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const selected = selectedId !== null ? branches.find((branch) => branch.id === selectedId) ?? null : null

  function openCreate() {
    setDraft({ name: "", priceList: priceLists[0], currency: "SUM", debtTracking: true, isMain: false })
    setEditing({ id: 0, name: "", date: "", debtTracking: true, isMain: false, priceList: priceLists[0], currency: "SUM" })
  }

  function openEdit(branch: Branch) {
    setDraft({ name: branch.name, priceList: branch.priceList, currency: branch.currency, debtTracking: branch.debtTracking, isMain: branch.isMain })
    setEditing(branch)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draft.name.trim()) return
    const payload = { ...draft, name: draft.name.trim() }
    try {
      if (editing?.id) {
        const response = await fetch(`/api/branches/${editing.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось сохранить филиал")
          return
        }
        const saved = (await response.json()) as Branch
        setBranches((list) => list.map((branch) => (branch.id === editing.id ? saved : branch)))
      } else {
        const response = await fetch("/api/branches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          window.alert(data.error || "Не удалось создать филиал")
          return
        }
        const saved = (await response.json()) as Branch
        setBranches((list) => [saved, ...list])
      }
      setEditing(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function remove(id: number) {
    try {
      const response = await fetch(`/api/branches/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить филиал")
        return
      }
      setBranches((list) => list.filter((branch) => branch.id !== id))
      setSelectedId((current) => (current === id ? null : current))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("branches-template", [["Наименование", "Прайс лист", "Валюта"]])
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

      const parsed: { name: string; priceList: string; currency: Branch["currency"] }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.priceList = row[1] ?? ""
          record.currency = row[2] ?? ""
        }
        if (!record.name || /^(наименование|название|name)$/i.test(record.name)) continue
        const currency = (["SUM", "USD", "Euro"] as const).find((item) => item.toLowerCase() === record.currency?.toLowerCase()) ?? "SUM"
        parsed.push({
          name: record.name,
          priceList: priceLists.includes(record.priceList) ? record.priceList : priceLists[0],
          currency,
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Branch[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/branches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: item.name, priceList: item.priceList, currency: item.currency, debtTracking: true, isMain: false }),
          })
          if (response.ok) created.push((await response.json()) as Branch)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setBranches((list) => [...created, ...list])
      if (failed) window.alert(`Импортировано ${created.length} из ${parsed.length}. Не удалось сохранить: ${failed}`)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      <div className={embedded ? "" : "overflow-hidden rounded bg-white shadow"}>
        {loadError && <p className="px-5 pt-4 text-sm text-red-500">{loadError}</p>}
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="text-[17px] text-[#4f70e7] hover:underline">
            + Добавить филиал
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <FileText className="h-4 w-4" /> Импорт с Excel
          </button>
          <label className="relative ml-4 w-72">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-[#4f70e7]" />
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
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">№</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Дата</th>
              <th className="px-5 py-5">Учет долга</th>
              <th className="px-5 py-5">Основной филиал</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((branch) => (
              <Fragment key={branch.id}>
                <tr className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50" onClick={() => setSelectedId((current) => (current === branch.id ? null : branch.id))}>
                  <td className="px-9 py-4">{branch.id}</td>
                  <td className="px-5 py-4 text-[#4f70e7]">{branch.name}</td>
                  <td className="px-5 py-4">{branch.date}</td>
                  <td className={`px-5 py-4 ${branch.debtTracking ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.debtTracking ? "Включен" : "Отключен"}</td>
                  <td className={`px-5 py-4 ${branch.isMain ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.isMain ? "Да" : "Нет"}</td>
                </tr>
                {selected?.id === branch.id && (
                  <tr>
                    <td colSpan={5} className="border-b border-slate-200 bg-white p-0">
                      <div className="p-8">
                        <div className="mb-6 flex items-center justify-between">
                          <h2 className="text-2xl font-semibold text-slate-800">{branch.name}</h2>
                          <div className="flex items-center gap-4">
                            <button type="button" className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-5 py-2.5 font-semibold text-white hover:brightness-95">
                              <Plus className="h-4 w-4" /> Добавить план
                            </button>
                            <button type="button" onClick={() => openEdit(branch)} aria-label="Изменить" className="text-slate-500 hover:text-[#4f70e7]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => remove(branch.id)} aria-label="Удалить" className="text-slate-500 hover:text-red-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>
                        <div className="space-y-2 text-[15px]">
                          <p>
                            Дата создания: <b className="ml-2">{branch.date}</b>
                          </p>
                          <p>
                            Прайс лист: <b className="ml-2">{branch.priceList}</b>
                          </p>
                          <p>
                            Валюта: <b className="ml-2">{branch.currency === "SUM" ? "SUM" : branch.currency}</b>
                          </p>
                          <p>
                            Основной филиал: <b className={`ml-2 ${branch.isMain ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.isMain ? "Включено" : "Выключено"}</b>
                          </p>
                          <p>
                            Учет долга: <b className={`ml-2 ${branch.debtTracking ? "text-[#6ccd8b]" : "text-red-400"}`}>{branch.debtTracking ? "Включено" : "Выключено"}</b>
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <form onSubmit={save} className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-5 flex justify-between">
              <h2 className="text-xl font-bold">{editing.id ? "Изменить филиал" : "Добавить филиал"}</h2>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть">
                <X />
              </button>
            </div>
            <label className="mb-2 block font-medium">Наименование</label>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5" />
            <label className="mb-2 block font-medium">Прайс лист</label>
            <select value={draft.priceList} onChange={(event) => setDraft({ ...draft, priceList: event.target.value })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              {priceLists.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
            <label className="mb-2 block font-medium">Валюта</label>
            <select value={draft.currency} onChange={(event) => setDraft({ ...draft, currency: event.target.value as Branch["currency"] })} className="mb-4 w-full rounded border border-slate-300 px-3 py-2.5">
              <option value="SUM">SUM</option>
              <option value="USD">USD</option>
              <option value="Euro">Euro</option>
            </select>
            <label className="mb-2 flex items-center gap-2">
              <input type="checkbox" checked={draft.debtTracking} onChange={(event) => setDraft({ ...draft, debtTracking: event.target.checked })} />
              Учет долга
            </label>
            <label className="mb-4 flex items-center gap-2">
              <input type="checkbox" checked={draft.isMain} onChange={(event) => setDraft({ ...draft, isMain: event.target.checked })} />
              Основной филиал
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setEditing(null)} className="rounded border px-4 py-2">
                Отмена
              </button>
              <button type="submit" className="inline-flex items-center gap-2 rounded bg-[#5474e6] px-4 py-2 font-semibold text-white">
                <Plus className="h-4 w-4" />
                Сохранить
              </button>
            </div>
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
