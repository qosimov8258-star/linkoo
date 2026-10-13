"use client"

import { ChevronLeft, ChevronRight, Download, FileText, Pencil, Plus, PlusCircle, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, Fragment, useEffect, useMemo, useRef, useState } from "react"

import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { SupplierFormModal } from "./supplier-form-modal"
import { supplierCategoryPool as categories, type Supplier } from "./suppliers-data"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "название": "name", "наименование": "name", "name": "name",
  "категория": "category", "category": "category",
  "адрес": "address", "местоположение": "address", "address": "address",
  "филиал": "branch", "branch": "branch",
  "организация": "organization", "organization": "organization",
}

export function SuppliersView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/suppliers")
      .then(async (response) => {
        if (!response.ok) throw new Error("failed")
        return (await response.json()) as Supplier[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить поставщиков с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(
    () => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) || String(row.id).includes(query)),
    [rows, query],
  )
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function toggleExpand(row: Supplier) {
    setExpandedId((current) => (current === row.id ? null : row.id))
  }

  function openCreate() {
    setEditingId(null)
    setModalOpen(true)
  }

  function openEdit(row: Supplier) {
    setEditingId(row.id)
    setModalOpen(true)
  }

  async function removeRow(row: Supplier) {
    if (!window.confirm(`Удалить поставщика «${row.name}»?`)) return
    try {
      const response = await fetch(`/api/suppliers/${row.id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить поставщика")
        return
      }
      setRows((current) => current.filter((item) => item.id !== row.id))
      if (expandedId === row.id) setExpandedId(null)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  function downloadList() {
    downloadExcelTable("postavshiki", [
      ["Id", "Наименование", "Категория", "Дата создания"],
      ...filtered.map((row) => [row.id, row.name, row.category, row.createdDate]),
    ])
  }

  function downloadTemplate() {
    downloadExcelTable("suppliers-template", [["Название", "Категория", "Местоположение", "Филиал", "Организация"]])
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

      type ParsedSupplier = { name: string; category: string; address: string; branch: string; organization: string }
      const parsed: ParsedSupplier[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.category = row[1] ?? ""
          record.address = row[2] ?? ""
          record.branch = row[3] ?? ""
          record.organization = row[4] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name,
          category: record.category || categories[0] || "",
          address: record.address || "Не указано",
          branch: record.branch || "Не указано",
          organization: record.organization || "Не указано",
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: Supplier[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...item, contacts: [] }),
          })
          if (response.ok) created.push((await response.json()) as Supplier)
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
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f2f5f8] px-7 pb-7"}>
      {!embedded && (
        <header className="mb-5 flex items-center justify-between">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f71dc]" />
            <span className="mx-2 text-slate-400">|</span> Поставщики
          </h1>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <FileText className="h-4 w-4" /> Импорт с Excel
            </button>
            <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-5 py-2.5 font-semibold text-white hover:brightness-95">
              <Plus className="h-4 w-4" /> Добавить
            </button>
          </div>
        </header>
      )}

      <section className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-3">
          <label className="relative w-64">
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
              <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f71dc] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                <FileText className="h-4 w-4" /> Импорт с Excel
              </button>
              <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#71ce87] px-4 py-2 text-sm font-semibold text-white hover:brightness-95">
                <Plus className="h-4 w-4" /> Добавить
              </button>
            </>
          )}
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#5d6474] text-white">
            <tr>
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Категория</th>
              <th className="px-5 py-5">Дата создания</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-9 py-10 text-center text-slate-400">Загрузка поставщиков...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={4} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <Fragment key={row.id}>
                <tr onClick={() => toggleExpand(row)} className="cursor-pointer border-b border-dashed border-slate-300 hover:bg-slate-50">
                  <td className="px-9 py-4">{row.id}</td>
                  <td className="px-5 py-4 text-[#4f71dc]">{row.name}</td>
                  <td className="px-5 py-4">{row.category}</td>
                  <td className="px-5 py-4">{row.createdDate}</td>
                </tr>

                {expandedId === row.id && (
                  <tr>
                    <td colSpan={4} className="bg-slate-50 p-0">
                      <div className="m-4 rounded border border-slate-200 bg-white p-6 shadow-sm">
                        <div className="mb-5 flex items-center justify-between">
                          <h2 className="text-xl font-bold text-slate-700">{row.name}</h2>
                          <div className="flex items-center gap-3 text-slate-500">
                            <button type="button" aria-label="Добавить продукт" className="text-emerald-500 hover:text-emerald-600">
                              <PlusCircle className="h-6 w-6" />
                            </button>
                            <button type="button" onClick={() => openEdit(row)} aria-label="Изменить" className="hover:text-[#4f71dc]">
                              <Pencil className="h-5 w-5" />
                            </button>
                            <button type="button" onClick={() => removeRow(row)} aria-label="Удалить" className="hover:text-rose-500">
                              <Trash2 className="h-5 w-5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid gap-6 sm:grid-cols-[1fr_2fr]">
                          <div>
                            <dl className="space-y-2 text-sm">
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Адрес</dt><dd className="font-medium text-[#4f71dc]">{row.address}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Категория</dt><dd className="font-medium text-[#4f71dc]">{row.category}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Филиал</dt><dd className="font-medium text-[#4f71dc]">{row.branch}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Организация</dt><dd className="font-medium text-[#4f71dc]">{row.organization}</dd></div>
                              <div className="flex justify-between gap-4"><dt className="text-slate-500">Дата добавления</dt><dd className="font-medium text-[#4f71dc]">{row.createdDate}</dd></div>
                            </dl>
                            <p className="mb-2 mt-5 font-medium text-slate-800">Контакты</p>
                            {row.contacts.length === 0 && <p className="text-sm text-slate-400">Не указано</p>}
                            {row.contacts.map((contact) => (
                              <div key={contact.id} className="flex justify-between gap-4 border-b border-dashed border-slate-200 py-1.5 text-sm">
                                <span className="text-[#4f71dc]">{contact.name}</span>
                                <span>{contact.phone}</span>
                              </div>
                            ))}
                          </div>

                          <div>
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="py-2 pr-4">Продукт</th>
                                  <th className="py-2 pr-4">Кол-во</th>
                                  <th className="py-2 pr-4">Цена</th>
                                  <th className="py-2 pr-4">Сумма</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.products.map((product) => (
                                  <tr key={product.id} className="border-t border-slate-100">
                                    <td className="py-2 pr-4">{product.product}</td>
                                    <td className="py-2 pr-4">{product.qty}</td>
                                    <td className="py-2 pr-4">{product.price.toLocaleString("ru-RU")}</td>
                                    <td className="py-2 pr-4">{(product.qty * product.price).toLocaleString("ru-RU")}</td>
                                  </tr>
                                ))}
                                {row.products.length === 0 && (
                                  <tr>
                                    <td colSpan={4} className="py-6 text-center text-slate-400">Товары не добавлены</td>
                                  </tr>
                                )}
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
        <SupplierFormModal
          supplier={editingId !== null ? (rows.find((row) => row.id === editingId) ?? null) : null}
          onClose={() => setModalOpen(false)}
          onSaved={(saved) => {
            setRows((current) => (editingId !== null ? current.map((row) => (row.id === editingId ? saved : row)) : [saved, ...current]))
            setModalOpen(false)
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
