"use client"

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileText, Plus, Search, X } from "lucide-react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "дата партии": "batchDate", "дата": "batchDate", "date": "batchDate",
  "этап производства": "stage", "этап": "stage", "stage": "stage",
}

type BatchStatus = "В процессе" | "Завершен" | "Отменен"
type Batch = {
  id: number
  startedAt: string
  completedAt: string
  batchDate: string
  stage: string
  user: string
  status: BatchStatus
}

const stages = [
  "Konditer maxsulotlari",
  "NEW MANUFACTURING",
  "buxanka",
  "Klub Sendvich",
  "Sendvich Bolochka",
  "demotest_proizvotsva_1",
  "Производства1",
  "Мойка",
  "УПК",
  "Агент | Функции0000000",
]
const initialBatches: Batch[] = []

function downloadExcel(rows: Batch[]) {
  const headers = ["№", "Дата начала", "Дата завершения", "Дата партии", "Этап производства", "Пользователь", "Статус"]
  const body = rows.map((row) => [String(row.id), row.startedAt, row.completedAt, row.batchDate, row.stage, row.user, row.status])
  downloadExcelTable("production-batches", [headers, ...body])
}

export function ProductionBatchesView() {
  const [batches, setBatches] = useState(initialBatches)
  const [tab, setTab] = useState<"process" | "completed" | "all">("all")
  const [query, setQuery] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [stageFilter, setStageFilter] = useState("Все этапы")
  const [userFilter, setUserFilter] = useState("Все пользователи")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [addOpen, setAddOpen] = useState(false)
  const [newStage, setNewStage] = useState(stages[0])
  const [newDate, setNewDate] = useState("2026-07-28")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/production-batches")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить партии")
        return (await response.json()) as Batch[]
      })
      .then((data) => {
        if (!cancelled) setBatches(data)
      })
      .catch(() => {
        if (!cancelled) window.alert("Не удалось загрузить партии с сервера")
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru")
    return batches.filter((batch) => {
      if (tab === "process" && batch.status !== "В процессе") return false
      if (tab === "completed" && batch.status !== "Завершен") return false
      if (stageFilter !== "Все этапы" && batch.stage !== stageFilter) return false
      if (userFilter !== "Все пользователи" && batch.user !== userFilter) return false
      return !normalized || `${batch.id} ${batch.stage} ${batch.user} ${batch.status}`.toLocaleLowerCase("ru").includes(normalized)
    })
  }, [batches, query, stageFilter, tab, userFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const first = filtered.length ? (safePage - 1) * pageSize + 1 : 0
  const last = Math.min(safePage * pageSize, filtered.length)

  function switchTab(value: typeof tab) {
    setTab(value)
    setPage(1)
  }

  async function addBatch(event: FormEvent) {
    event.preventDefault()
    const formatted = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(`${newDate}T12:00:00`)).replace(" г.", "")
    const input = {
      startedAt: `${formatted}, 12:00`,
      completedAt: "",
      batchDate: formatted,
      stage: newStage,
      user: "Admin Ritm",
      status: "В процессе",
    }
    try {
      const response = await fetch("/api/production-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось создать партию")
        return
      }
      const saved = (await response.json()) as Batch
      setBatches((current) => [saved, ...current])
      setAddOpen(false)
      setTab("all")
      setPage(1)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadTemplate() {
    downloadExcelTable("production-batches-template", [["Дата партии", "Этап производства"]])
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
      const hasHeader = Array.from(fieldByIndex.values()).includes("batchDate")
      const dataRows = hasHeader ? rows.slice(1) : rows

      const parsed: { batchDate: string; stage: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.batchDate = row[0] ?? ""
          record.stage = row[1] ?? ""
        }
        if (!record.batchDate) continue
        parsed.push({ batchDate: record.batchDate, stage: record.stage || stages[0] })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const inputs = parsed.map((item) => {
        const parsedDate = new Date(`${item.batchDate}T12:00:00`)
        const formatted = Number.isNaN(parsedDate.getTime())
          ? item.batchDate
          : new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", year: "numeric" }).format(parsedDate).replace(" г.", "")
        return {
          startedAt: `${formatted}, 12:00`,
          completedAt: "",
          batchDate: formatted,
          stage: item.stage,
          user: "Admin Ritm",
          status: "В процессе" as BatchStatus,
        }
      })

      const created: Batch[] = []
      let failed = 0
      for (const input of inputs) {
        try {
          const response = await fetch("/api/production-batches", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(input),
          })
          if (response.ok) created.push((await response.json()) as Batch)
          else failed += 1
        } catch {
          failed += 1
        }
      }
      if (created.length) setBatches((current) => [...created, ...current])
      if (failed) window.alert(`Импортировано ${created.length} из ${inputs.length}. Не удалось сохранить: ${failed}`)
      setTab("all")
      setPage(1)
    } finally {
      setImportSaving(false)
      setImportOpen(false)
      setImportFile(null)
    }
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100 text-slate-800">
      <header className="flex items-center justify-between px-8 py-4">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-semibold text-blue-600" />
          <span className="text-2xl text-slate-500">|</span>
          <span className="text-2xl font-semibold text-slate-600">Партии</span>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setImportOpen(true)} aria-label="Импорт с Excel" className="rounded-md bg-blue-600 p-3 text-white shadow">
            <FileText className="h-7 w-7" />
          </button>
          <button onClick={() => setAddOpen(true)} aria-label="Добавить партию" className="rounded-md bg-blue-600 p-3 text-white shadow">
            <Plus className="h-7 w-7" />
          </button>
        </div>
      </header>

      <section className="mx-8 mb-6 overflow-hidden rounded-sm bg-white shadow">
        <div className="grid grid-cols-3">
          {([
            ["process", "В процессе"],
            ["completed", "Завершенные"],
            ["all", "Все"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              onClick={() => switchTab(value)}
              className={`border-b-4 px-4 py-5 text-lg ${tab === value ? "border-blue-600" : "border-transparent"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-8 overflow-hidden bg-white shadow">
        <div className="flex flex-wrap items-center justify-between gap-4 px-2 py-4">
          <button onClick={() => setFilterOpen((value) => !value)} className="flex items-center gap-1 text-blue-600">
            Показать фильтр <ChevronDown className="h-4 w-4" />
          </button>
          <label className="relative w-96 max-w-full">
            <input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full border-b border-slate-300 py-2 pr-10 outline-none focus:border-blue-600" />
            <Search className="absolute right-1 top-2 h-6 w-6 text-slate-400" />
          </label>
          <div className="flex items-center gap-5 text-slate-600">
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="bg-transparent">
              {[10, 25, 50].map((size) => <option key={size}>{size}</option>)}
            </select>
            <span>{first} - {last} из {filtered.length}</span>
            <button onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={safePage === 1} aria-label="Предыдущая страница"><ChevronLeft className="h-7 w-7" /></button>
            <button onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={safePage === pageCount} aria-label="Следующая страница"><ChevronRight className="h-7 w-7" /></button>
            <button onClick={() => downloadExcel(filtered)} aria-label="Скачать Excel"><Download className="h-7 w-7" /></button>
          </div>
        </div>

        {filterOpen && (
          <div className="grid gap-5 border-t bg-slate-50 p-5 md:grid-cols-3">
            <label><span className="mb-2 block text-sm font-semibold">Этап производства</span><select value={stageFilter} onChange={(event) => { setStageFilter(event.target.value); setPage(1) }} className="w-full border-b bg-white p-2"><option>Все этапы</option>{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label><span className="mb-2 block text-sm font-semibold">Пользователь</span><select value={userFilter} onChange={(event) => { setUserFilter(event.target.value); setPage(1) }} className="w-full border-b bg-white p-2"><option>Все пользователи</option><option>Admin Ritm</option></select></label>
            <button onClick={() => { setStageFilter("Все этапы"); setUserFilter("Все пользователи"); setQuery(""); setPage(1) }} className="self-end rounded-md bg-slate-600 px-5 py-2 text-white">Очистить</button>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse">
            <thead className="bg-[#626b7e] text-left text-white">
              <tr>
                {["№", "Дата начала", "Дата завершения", "Дата партии", "Этап производства", "Пользователь", "Статус"].map((header) => <th key={header} className="px-10 py-5 font-semibold">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {visible.map((batch) => (
                <tr key={batch.id} className="border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-12 py-5">{batch.id}</td>
                  <td className="px-10 py-5">{batch.startedAt}</td>
                  <td className="px-10 py-5">{batch.completedAt}</td>
                  <td className="px-10 py-5">{batch.batchDate}</td>
                  <td className="px-10 py-5">{batch.stage}</td>
                  <td className="px-10 py-5">{batch.user}</td>
                  <td className="px-10 py-5">
                    <span className={`mr-3 inline-block h-2.5 w-2.5 rounded-full ${batch.status === "В процессе" ? "bg-amber-400" : batch.status === "Завершен" ? "bg-sky-400" : "bg-red-400"}`} />
                    {batch.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {addOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true">
          <form onSubmit={addBatch} className="w-full max-w-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b px-7 py-5">
              <h2 className="text-xl font-bold">ДОБАВИТЬ ПАРТИЮ</h2>
              <button type="button" onClick={() => setAddOpen(false)} aria-label="Закрыть"><X className="h-6 w-6" /></button>
            </div>
            <div className="space-y-6 p-7">
              <label className="block"><span className="mb-2 block font-semibold">Дата партии</span><input required type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="w-full border-b p-2" /></label>
              <label className="block"><span className="mb-2 block font-semibold">Этап производства</span><select value={newStage} onChange={(event) => setNewStage(event.target.value)} className="w-full border-b p-2">{stages.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            </div>
            <div className="flex justify-end border-t p-5"><button type="submit" className="rounded-md bg-emerald-400 px-7 py-3 font-semibold text-white">СОХРАНИТЬ</button></div>
          </form>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4">
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
                className="flex w-full flex-col items-center justify-center gap-3 rounded border-2 border-dashed border-slate-300 py-10 text-slate-500 hover:border-blue-600 hover:text-blue-600"
              >
                <FileText className="h-8 w-8" />
                {importFile ? importFile.name : "Добавьте файл Excel или нажмите для выбора"}
              </button>
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="button" disabled={!importFile || importSaving} onClick={saveImport} className="rounded-md bg-emerald-400 px-5 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-40">
                {importSaving ? "Импорт..." : "Сохранить"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </main>
  )
}
