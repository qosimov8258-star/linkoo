"use client"

import { ChevronLeft, ChevronRight, DollarSign, FileText, Pencil, Plus, Search, Trash2, X } from "lucide-react"
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react"

import { downloadExcelTable } from "@/lib/excel-export"
import { mapHeaderColumns, readExcelRows } from "@/lib/excel-import"
import { priceListCalcMethods as calcMethods, priceListCurrencies as currencies, type PriceList } from "./price-lists-data"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

const IMPORT_HEADER_ALIASES: Record<string, string> = {
  "наименование": "name", "название": "name", "name": "name",
  "валюта": "currency", "currency": "currency",
  "связанный прайс лист": "linkedList", "связанный список": "linkedList",
  "метод расчета": "calcMethod", "метод расчёта": "calcMethod",
}

const products = [
  "Arslan 111111", "seriya test",
  "Масло трансмиссионное EAGLE PEGASUS MULTI ATF 1л (EO00710)",
  "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 200л (EO00690)",
  "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 4л (EO00620)",
  "Масло моторное EAGLE Gasoline Semi-SYNTHETIC SAE 10W-40 API SL 1л (EO00610)",
]

function emptyDraft() {
  return { name: "", currency: currencies[0], linkedList: "Не указано", calcMethod: calcMethods[0] }
}

function emptyPriceDraft() {
  return { priceList: "", product: products[0], cash: "", nonCash: "" }
}

export function PriceListsView({ embedded = false }: { embedded?: boolean }) {
  const [rows, setRows] = useState<PriceList[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [query, setQuery] = useState("")
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<PriceList | "new" | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState("")
  const [saving, setSaving] = useState(false)
  const [priceModal, setPriceModal] = useState(false)
  const [priceDraft, setPriceDraft] = useState(emptyPriceDraft)
  const [priceSaving, setPriceSaving] = useState(false)
  const [toast, setToast] = useState("")
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importSaving, setImportSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)
  const pageSize = 25

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/price-lists")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить прайс-листы")
        return (await response.json()) as PriceList[]
      })
      .then((data) => {
        if (cancelled) return
        setRows(data)
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить прайс-листы с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase())), [rows, query])
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, pageCount)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function openCreate() {
    setDraft(emptyDraft())
    setFormError("")
    setEditing("new")
  }

  function openEdit(row: PriceList) {
    setDraft({ name: row.name, currency: row.currency, linkedList: row.linkedList, calcMethod: row.calcMethod })
    setFormError("")
    setEditing(row)
  }

  async function remove(id: number) {
    if (!window.confirm("Удалить прайс-лист?")) return
    try {
      const response = await fetch(`/api/price-lists/${id}`, { method: "DELETE" })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось удалить прайс-лист")
        return
      }
      setRows((current) => current.filter((row) => row.id !== id))
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    const trimmed = draft.name.trim()
    if (!trimmed) return

    setSaving(true)
    setFormError("")
    try {
      const isEdit = editing !== "new" && editing !== null
      const targetId = isEdit ? (editing as PriceList).id : null
      const response = await fetch(isEdit ? `/api/price-lists/${targetId}` : "/api/price-lists", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed, currency: draft.currency, linkedList: draft.linkedList, calcMethod: draft.calcMethod }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        setFormError(data.error || "Не удалось сохранить прайс-лист")
        return
      }
      const saved = (await response.json()) as PriceList
      setRows((current) => (isEdit ? current.map((row) => (row.id === targetId ? saved : row)) : [saved, ...current]))
      setEditing(null)
    } catch {
      setFormError("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setSaving(false)
    }
  }

  function openAddPrice(priceListName?: string) {
    setPriceDraft({ ...emptyPriceDraft(), priceList: priceListName ?? rows[0]?.name ?? "" })
    setPriceModal(true)
  }

  async function savePrice(event: FormEvent) {
    event.preventDefault()
    if (!priceDraft.priceList || !priceDraft.product) return
    setPriceSaving(true)
    try {
      const response = await fetch("/api/price-list-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceList: priceDraft.priceList,
          product: priceDraft.product,
          cash: priceDraft.cash === "" ? 0 : Number(priceDraft.cash),
          nonCash: priceDraft.nonCash === "" ? 0 : Number(priceDraft.nonCash),
        }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        window.alert(data.error || "Не удалось сохранить цену")
        return
      }
      setPriceModal(false)
      setToast(`Цена для «${priceDraft.product}» в прайс-листе «${priceDraft.priceList}» обновлена`)
      window.setTimeout(() => setToast(""), 4000)
    } catch {
      window.alert("Сервер недоступен, попробуйте ещё раз")
    } finally {
      setPriceSaving(false)
    }
  }

  function downloadTemplate() {
    downloadExcelTable("price-lists-template", [["Наименование", "Валюта", "Связанный прайс лист", "Метод расчета"]])
  }

  function pickImportFile(event: ChangeEvent<HTMLInputElement>) {
    setImportFile(event.target.files?.[0] ?? null)
  }

  async function saveImport() {
    if (!importFile) return
    setImportSaving(true)
    try {
      const importRows = await readExcelRows(importFile)
      if (!importRows.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }
      const fieldByIndex = mapHeaderColumns(importRows[0], IMPORT_HEADER_ALIASES)
      const hasHeader = Array.from(fieldByIndex.values()).includes("name")
      const dataRows = hasHeader ? importRows.slice(1) : importRows

      const parsed: { name: string; currency: string; linkedList: string; calcMethod: string }[] = []
      for (const row of dataRows) {
        const record: Record<string, string> = {}
        if (hasHeader) {
          row.forEach((cell, index) => {
            const field = fieldByIndex.get(index)
            if (field) record[field] = cell
          })
        } else {
          record.name = row[0] ?? ""
          record.currency = row[1] ?? ""
          record.linkedList = row[2] ?? ""
          record.calcMethod = row[3] ?? ""
        }
        if (!record.name) continue
        parsed.push({
          name: record.name,
          currency: record.currency || currencies[0],
          linkedList: record.linkedList || "Не указано",
          calcMethod: record.calcMethod || calcMethods[0],
        })
      }

      if (!parsed.length) {
        window.alert("Не удалось найти данные для импорта в выбранном файле")
        return
      }

      const created: PriceList[] = []
      let failed = 0
      for (const item of parsed) {
        try {
          const response = await fetch("/api/price-lists", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(item),
          })
          if (response.ok) created.push((await response.json()) as PriceList)
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
    <main className={embedded ? "min-w-0 flex-1" : "min-h-[calc(100vh-4rem)] bg-[#f1f4f8] px-9 py-5"}>
      {!embedded && (
        <header className="mb-5">
          <h1 className="flex items-center text-2xl font-bold text-slate-600">
            <FavoritesButton className="inline-flex items-center gap-2 text-[#4f70e7]" />
            <span className="mx-2 text-slate-400">|</span> Прайс-листы
          </h1>
        </header>
      )}

      {toast && (
        <div className="mb-4 flex items-center justify-between rounded bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
          {toast}
          <button type="button" onClick={() => setToast("")} aria-label="Закрыть"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="overflow-hidden rounded bg-white shadow">
        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
          <button type="button" onClick={openCreate} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
            <Plus className="h-4 w-4" /> Добавить прайс-лист
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className="inline-flex items-center gap-2 rounded bg-[#4f70e7] px-4 py-2.5 font-semibold text-white hover:brightness-95">
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
          <button type="button" onClick={() => openAddPrice()} className="inline-flex items-center gap-2 rounded bg-[#6ccd8b] px-5 py-2.5 font-semibold text-white hover:brightness-95">
            <DollarSign className="h-4 w-4" /> Добавить цену
          </button>
        </div>

        <table className="w-full text-left">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-9 py-5">Id</th>
              <th className="px-5 py-5">Наименование</th>
              <th className="px-5 py-5">Валюта</th>
              <th className="px-5 py-5">Дата создания</th>
              <th className="px-5 py-5">Связанный прайс лист</th>
              <th className="px-5 py-5">Метод расчета</th>
              <th className="w-32" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-9 py-10 text-center text-slate-400">Загрузка прайс-листов...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={7} className="px-9 py-10 text-center text-red-600">{loadError}</td></tr>
            ) : visible.map((row) => (
              <tr key={row.id} className="group border-b border-dashed border-slate-300 hover:bg-slate-50">
                <td className="px-9 py-4">{row.id}</td>
                <td className="px-5 py-4 text-[#4f70e7]">{row.name}</td>
                <td className="px-5 py-4">{row.currency}</td>
                <td className="px-5 py-4">{row.createdDate}</td>
                <td className="px-5 py-4">{row.linkedList}</td>
                <td className="px-5 py-4">{row.calcMethod}</td>
                <td className="px-5 py-4">
                  <div className="hidden items-center justify-end gap-3 text-slate-500 group-hover:flex">
                    <button type="button" onClick={() => openAddPrice(row.name)} aria-label="Добавить цену" className="hover:text-emerald-500">
                      <DollarSign className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => openEdit(row)} aria-label="Изменить" className="hover:text-[#4f70e7]">
                      <Pencil className="h-5 w-5" />
                    </button>
                    <button type="button" onClick={() => remove(row.id)} aria-label="Удалить" className="hover:text-rose-500">
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!loading && !loadError && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="px-9 py-10 text-center text-slate-400">
                  Ничего не найдено
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={save} className="w-full max-w-lg rounded bg-white">
            <header className="flex items-center justify-between border-b p-6">
              <b className="uppercase">{editing === "new" ? "Добавить прайс-лист" : "Изменить прайс-лист"}</b>
              <button type="button" onClick={() => setEditing(null)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </header>
            <div className="space-y-5 p-8">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наименование <span className="text-red-500">*</span>
                <input autoFocus value={draft.name} onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Валюта <span className="text-red-500">*</span>
                <select value={draft.currency} onChange={(event) => setDraft((value) => ({ ...value, currency: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {currencies.map((currency) => <option key={currency}>{currency}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Связанный прайс лист
                <select value={draft.linkedList} onChange={(event) => setDraft((value) => ({ ...value, linkedList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  <option>Не указано</option>
                  {rows.map((row) => <option key={row.id}>{row.name}</option>)}
                </select>
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Метод расчета
                <select value={draft.calcMethod} onChange={(event) => setDraft((value) => ({ ...value, calcMethod: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                  {calcMethods.map((method) => <option key={method}>{method}</option>)}
                </select>
              </label>
              {formError && <p className="text-sm font-medium text-rose-600">{formError}</p>}
            </div>
            <footer className="flex justify-end border-t p-5">
              <button type="submit" disabled={saving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">
                {saving ? "Сохранение..." : "Сохранить"}
              </button>
            </footer>
          </form>
        </div>
      )}

      {priceModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <form onSubmit={savePrice} className="w-full max-w-md rounded bg-white p-6">
            <div className="mb-5 flex items-center justify-between border-b pb-4">
              <b className="uppercase">Добавить цену</b>
              <button type="button" onClick={() => setPriceModal(false)} aria-label="Закрыть"><X className="h-5 w-5" /></button>
            </div>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              Прайс-лист <span className="text-red-500">*</span>
              <select value={priceDraft.priceList} onChange={(event) => setPriceDraft((value) => ({ ...value, priceList: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                {rows.map((row) => <option key={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label className="mb-4 block border-b border-slate-200 pb-2 font-medium">
              Товар <span className="text-red-500">*</span>
              <select value={priceDraft.product} onChange={(event) => setPriceDraft((value) => ({ ...value, product: event.target.value }))} className="mt-2 block w-full bg-white outline-none">
                {products.map((product) => <option key={product}>{product}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Наличными
                <input type="number" value={priceDraft.cash} onChange={(event) => setPriceDraft((value) => ({ ...value, cash: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
              <label className="block border-b border-slate-200 pb-2 font-medium">
                Безналично
                <input type="number" value={priceDraft.nonCash} onChange={(event) => setPriceDraft((value) => ({ ...value, nonCash: event.target.value }))} className="mt-2 block w-full outline-none" />
              </label>
            </div>
            <div className="mt-6 flex justify-end">
              <button type="submit" disabled={priceSaving} className="rounded bg-[#6ccd8b] px-6 py-3 font-semibold text-white hover:brightness-95 disabled:opacity-60">{priceSaving ? "Сохранение..." : "Сохранить"}</button>
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
