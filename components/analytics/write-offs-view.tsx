"use client"

import { LineField, LineSelect } from "@/components/analytics/catalog-ui"
import { Ban, Download, FileText, Minus, Plus, Printer, Search, X, ChevronLeft, ChevronRight, ChevronDown } from "lucide-react"
import { ChangeEvent, Fragment, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { writeOffWarehouses as warehouses, writeOffReasons as reasons, writeOffProducts as products, type WriteOff } from "./write-offs-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "склад": "warehouse", "warehouse": "warehouse",
  "причина списания": "reason", "причина": "reason", "reason": "reason",
  "товар": "product", "product": "product",
  "кол во": "qty", "количество": "qty", "qty": "qty",
  "себестоимость": "cost", "cost": "cost",
  "комментарий": "comment", "comment": "comment",
}

function money(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}

type DraftItem = { id: number; product: string; qty: number; cost: number }

export function WriteOffsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<WriteOff[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [filterOpen, setFilterOpen] = useState(false)
  const [warehouseFilter, setWarehouseFilter] = useState("all")
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [draftWarehouse, setDraftWarehouse] = useState(warehouses[0])
  const [draftReason, setDraftReason] = useState(reasons[0])
  const [draftComment, setDraftComment] = useState("")
  const [draftDate, setDraftDate] = useState("")
  const [draftItems, setDraftItems] = useState<DraftItem[]>([])
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/write-offs")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as WriteOff[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить списания с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (query && !String(row.id).includes(query) && !row.warehouse.toLowerCase().includes(query.toLowerCase())) return false
      if (warehouseFilter !== "all" && row.warehouse !== warehouseFilter) return false
      return true
    })
  }, [rows, query, warehouseFilter])

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: WriteOff) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  async function cancelWriteOff(row: WriteOff) {
    if (!window.confirm(`Отменить списание № ${row.id}? Товар будет возвращён на склад.`)) return
    try {
      const response = await fetch(`/api/write-offs/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось отменить списание")
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function openCreate() {
    setDraftWarehouse(warehouses[0])
    setDraftReason(reasons[0])
    setDraftComment("")
    setDraftItems([])
    setModalOpen(true)
  }

  function addBlankItem() {
    setDraftItems((current) => [...current, { id: Math.max(0, ...current.map((item) => item.id)) + 1, product: products[0], qty: 1, cost: 0 }])
  }

  function updateDraftItem(id: number, patch: Partial<DraftItem>) {
    setDraftItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  function removeDraftItem(id: number) {
    setDraftItems((current) => current.filter((item) => item.id !== id))
  }

  const draftTotal = draftItems.reduce((sum, item) => sum + item.qty * item.cost, 0)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!draftItems.length) return
    setSaving(true)
    try {
      const response = await fetch("/api/write-offs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          warehouse: draftWarehouse,
          reason: draftReason,
          comment: draftComment || "",
          items: draftItems.map((item) => ({ id: item.id, product: item.product, code: "-", series: "-", block: 0, qty: item.qty, cost: item.cost })),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось создать списание")
        return
      }
      const saved = (await response.json()) as WriteOff
      setRows((current) => [saved, ...current])
      setModalOpen(false)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("write-offs-template", [["Склад", "Причина списания", "Товар", "Кол-во", "Себестоимость", "Комментарий"]])
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
      const hasHeader = Array.from(fieldByIndex.values()).includes("product")
      const dataRows = hasHeader ? rowsRaw.slice(1) : rowsRaw

      const parsed: { warehouse: string; reason: string; product: string; qty: number; cost: number; comment: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.warehouse = row[0] ?? ""
          record.reason = row[1] ?? ""
          record.product = row[2] ?? ""
          record.qty = row[3] ?? ""
          record.cost = row[4] ?? ""
          record.comment = row[5] ?? ""
        }
        if (!record.product) continue
        parsed.push({
          warehouse: record.warehouse || warehouses[0],
          reason: record.reason || reasons[0],
          product: record.product,
          qty: Number(record.qty) || 1,
          cost: Number(record.cost) || 0,
          comment: record.comment || "",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: WriteOff[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/write-offs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              warehouse: item.warehouse,
              reason: item.reason,
              comment: item.comment,
              items: [{ id: 1, product: item.product, code: "-", series: "-", block: 0, qty: item.qty, cost: item.cost }],
            }),
          })
          if (response.ok) created.push((await response.json()) as WriteOff)
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

  function downloadList() {
    downloadExcelTable("spisanie", [
      ["№", "Создал", "Склад", "Дата создания", "Статус"],
      ...filtered.map((row) => [row.id, row.creator, row.warehouse, row.date, row.status]),
    ])
  }

  return (
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="flex h-[60px] flex-wrap items-center justify-between gap-3">
          <h1 className="flex items-center text-[18px] font-bold text-[#5d6474]">
            <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
            <span className="mx-[11px] inline-block h-[21px] w-[2px] bg-[#5d6474]" /> Списание
          </h1>
          <div className="flex items-center gap-4">
            <button type="button" onClick={openCreate} className="text-[13px] font-medium text-[#ff7a59] hover:underline">
              Списание товара
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <button type="button" onClick={() => setFilterOpen((value) => !value)} className="inline-flex w-[318px] shrink-0 items-center gap-1 pl-[5px] text-[13px] text-[#4f71dc] hover:underline">
            Показать фильтр <ChevronDown className={`h-4 w-4 transition-transform ${filterOpen ? "rotate-180" : ""}`} />
          </button>
          <label className="relative ml-[18px] w-[248px]">
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
          <button type="button" onClick={downloadList} aria-label="Скачать" className="text-slate-500 hover:text-[#4f71dc]">
            <Download className="h-5 w-5" />
          </button>
          {embedded && (
            <>
              <button type="button" onClick={openCreate} className="text-sm font-medium text-[#ff7a59] hover:underline">
                Списание товара
              </button>
            </>
          )}
        </div>

        {filterOpen && (
          <div className="flex flex-wrap items-center gap-4 border-b border-slate-100 bg-slate-50 px-5 py-3">
            <label className="text-sm text-slate-600">
              Склад:{" "}
              <select value={warehouseFilter} onChange={(event) => { setWarehouseFilter(event.target.value); setPage(1) }} className="ml-1 rounded border border-slate-300 px-2 py-1">
                <option value="all">Все</option>
                {warehouses.map((warehouse) => <option key={warehouse} value={warehouse}>{warehouse}</option>)}
              </select>
            </label>
          </div>
        )}

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-4 text-[13px]">№</th>
              <th className="px-5 py-4 text-[13px]">Создал</th>
              <th className="px-5 py-4 text-[13px]">Склад</th>
              <th className="px-5 py-4 text-[13px]">Дата создания</th>
              <th className="px-5 py-4 text-[13px]">Статус</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="px-9 py-10 text-center text-slate-400">Загрузка списаний...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={5} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4">{row.creator}</td>
                  <td className="px-5 py-4">{row.warehouse}</td>
                  <td className="px-5 py-4">{row.date}</td>
                  <td className="px-5 py-4 text-emerald-500">{row.status}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={5} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">Списание № {row.id}</h2>
                          <div className="flex items-center gap-3 text-slate-500">
                            <button type="button" onClick={() => cancelWriteOff(row)} aria-label="Отменить списание" className="flex h-8 w-8 items-center justify-center rounded-full bg-rose-400 text-white hover:bg-rose-500">
                              <Minus className="h-4 w-4" />
                            </button>
                            <button type="button" onClick={() => window.print()} aria-label="Печать" className="hover:text-[#4f71dc]">
                              <Printer className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-8 lg:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Создал</dt><dd className="font-medium">{row.creator}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Склад</dt><dd className="font-medium">{row.warehouse}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата создания</dt><dd className="font-medium">{row.date}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Статус</dt><dd className="font-medium text-emerald-500">{row.status}</dd></div>
                            </dl>
                            <p className="mb-1 mt-5 font-medium text-slate-800">Комментарий:</p>
                            <p className="text-sm text-slate-500">{row.comment || "Комментарий отсутствует"}</p>
                          </div>

                          <div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">Товар</th>
                                  <th className="py-2 pr-4">Код товара</th>
                                  <th className="py-2 pr-4">Серия</th>
                                  <th className="py-2 pr-4">Блок</th>
                                  <th className="py-2 pr-4">Кол-во</th>
                                  <th className="py-2 pr-4">Себестоимость</th>
                                  <th className="py-2 pr-4">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.items.map((item) => (
                                  <tr key={item.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{item.product}</td>
                                    <td className="py-2 pr-4">{item.code}</td>
                                    <td className="py-2 pr-4">{item.series}</td>
                                    <td className="py-2 pr-4">{item.block}</td>
                                    <td className="py-2 pr-4">{item.qty}</td>
                                    <td className="py-2 pr-4">{money(item.cost)}</td>
                                    <td className="py-2 pr-4">{money(item.sum)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>

        {!loading && !loadError && visible.length === 0 && (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 py-10">
            <p className="text-lg text-slate-400">По вашему запросу ничего не найдено</p>
          </div>
        )}
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex bg-white text-[13px]">
          <form onSubmit={save} className="flex h-full w-full flex-col">
            <header className="flex h-[58px] shrink-0 items-center justify-between border-b border-[#efefef] px-[14px]">
              <b className="uppercase">Списание товара</b>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[405px_minmax(0,1fr)]">
              <aside className="space-y-[10px] overflow-y-auto border-r border-[#efefef] px-[14px] py-[16px] pr-[60px]">
                <LineSelect label="С какого склада" required value={draftWarehouse} onChange={setDraftWarehouse} options={warehouses} />
                <LineField label="Выберите дату" required value={draftDate} onChange={setDraftDate} />
                <LineSelect label="Причина списания" required value={draftReason} onChange={setDraftReason} options={reasons} />
                <LineField label="Оставить комментарий..." value={draftComment} onChange={setDraftComment} />
              </aside>
              <main className="min-w-0 overflow-y-auto px-[14px] py-[12px]">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-semibold">Список товаров</p>
                  <button type="button" onClick={addBlankItem} className="inline-flex items-center gap-1 text-sm text-[#4f71dc] hover:underline">
                    добавить товары
                  </button>
                </div>

                {draftItems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-3 rounded border border-dashed border-slate-200 py-10 text-slate-400">
                    <Ban className="h-10 w-10" />
                    <p>
                      Товары не добавлены.{" "}
                      <button type="button" onClick={addBlankItem} className="text-[#4f71dc] hover:underline">
                        Добавить товар?
                      </button>
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-2 pr-4">Товар</th>
                        <th className="py-2 pr-4">Кол-во</th>
                        <th className="py-2 pr-4">Себестоимость</th>
                        <th className="py-2 pr-4">Сумма</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {draftItems.map((item) => (
                        <tr key={item.id} className="border-t border-slate-100">
                          <td className="py-2 pr-4">
                            <select value={item.product} onChange={(event) => updateDraftItem(item.id, { product: event.target.value })} className="bg-white outline-none">
                              {products.map((product) => <option key={product}>{product}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.qty} onChange={(event) => updateDraftItem(item.id, { qty: Number(event.target.value) })} className="w-20 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">
                            <input type="number" min={0} value={item.cost} onChange={(event) => updateDraftItem(item.id, { cost: Number(event.target.value) })} className="w-28 border-b border-slate-200 outline-none" />
                          </td>
                          <td className="py-2 pr-4">{money(item.qty * item.cost)}</td>
                          <td className="py-2 pr-4 text-right">
                            <button type="button" onClick={() => removeDraftItem(item.id)} aria-label="Удалить" className="text-slate-400 hover:text-rose-500">
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
              </main>
            </div>

            <footer className="flex h-[56px] shrink-0 items-center justify-between border-t border-[#efefef] px-[14px]">
              <div className="text-sm text-slate-600">
                Общее кол-во: <span className="font-semibold text-[#0a9ddb]">{draftItems.reduce((sum, item) => sum + item.qty, 0)} ед</span>
              </div>
              <button type="submit" disabled={!draftItems.length || saving} className="text-[12px] font-bold uppercase text-[#0a9ddb] disabled:opacity-40">
                {saving ? "Списание..." : "Списать"}
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
