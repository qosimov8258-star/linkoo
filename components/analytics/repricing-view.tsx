"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Filter, PlusCircle, Search, Upload, X } from "lucide-react"

import { readExcelRows } from "@/lib/excel-import"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"

import { repricingCurrencies as currencies, type Repricing } from "./repricing-data"
import type { PriceList } from "./price-lists-data"
import type { Product } from "./products-data"

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

export function RepricingView() {
  const [rows, setRows] = useState<Repricing[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [priceLists, setPriceLists] = useState<PriceList[]>([])
  const [products, setProducts] = useState<Product[]>([])

  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [priceListFilter, setPriceListFilter] = useState("Все")
  const [userFilter, setUserFilter] = useState("Все")
  const [statusFilter, setStatusFilter] = useState("Все")
  const [productFilter, setProductFilter] = useState("Все")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [linkedModalOpen, setLinkedModalOpen] = useState(false)
  const [addModalOpen, setAddModalOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch("/api/repricings").then((response) => {
        if (!response.ok) throw new Error("Не удалось загрузить переоценки")
        return response.json() as Promise<Repricing[]>
      }),
      fetch("/api/price-lists").then((response) => (response.ok ? (response.json() as Promise<PriceList[]>) : [])),
      fetch("/api/products").then((response) => (response.ok ? (response.json() as Promise<Product[]>) : [])),
    ])
      .then(([repricings, lists, productRows]) => {
        if (cancelled) return
        setRows(repricings)
        setPriceLists(lists)
        setProducts(productRows.filter((product) => !product.deleted))
        setLoadError("")
      })
      .catch(() => {
        if (!cancelled) setLoadError("Не удалось загрузить переоценки с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const priceListOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.priceList))).filter(Boolean), [rows])
  const userOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.user))).filter(Boolean), [rows])
  const productOptions = useMemo(() => Array.from(new Set(rows.map((row) => row.product))).filter(Boolean), [rows])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !String(row.id).includes(search.trim()) && !row.priceList.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (priceListFilter !== "Все" && row.priceList !== priceListFilter) return false
      if (userFilter !== "Все" && row.user !== userFilter) return false
      if (statusFilter !== "Все" && row.status !== statusFilter) return false
      if (productFilter !== "Все" && row.product !== productFilter) return false
      return true
    })
  }, [priceListFilter, productFilter, rows, search, statusFilter, userFilter])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  function handleCreated(created: Repricing[]) {
    if (!created.length) return
    setRows((current) => [...created, ...current].sort((a, b) => b.id - a.id))
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e1e5eb] px-6 py-5 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Переоценка</span>
        </div>
        <div className="flex gap-4">
          <button onClick={() => setLinkedModalOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white">
            <PlusCircle className="h-5 w-5" /> Переоценку связанных
          </button>
          <button onClick={() => setAddModalOpen(true)} className="flex h-11 items-center gap-2 rounded-md bg-[#69cd87] px-5 font-semibold text-white">
            <PlusCircle className="h-5 w-5" /> Добавить
          </button>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-5 px-6 py-4 md:px-9">
        <button onClick={() => setFilterOpen((value) => !value)} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70df] px-5 font-semibold text-white">
          <Filter className="h-5 w-5" /> Показать фильтр
        </button>

        <label className="relative min-w-[220px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} placeholder="Поиск" className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]" />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-9 bg-transparent text-[#586174]">
          <option value={10}>10</option>
          <option value={25}>25</option>
          <option value={50}>50</option>
        </select>

        <span className="text-[#586174]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>

        <button disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-full border border-[#dbe0e8] p-1 text-[#9aa3b6] disabled:opacity-40">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <button disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="rounded-full border border-[#4f70e7] p-1 text-[#4f70e7] disabled:opacity-40">
          <ChevronRight className="h-5 w-5" />
        </button>
      </section>

      {filterOpen && (
        <section className="relative border-b border-[#e1e5eb] px-6 pb-6 pt-2 md:px-9">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg text-[#586174]">Фильтр</h2>
            <button aria-label="Закрыть" onClick={() => setFilterOpen(false)}><X className="h-6 w-6 rounded-full border-2 border-[#9aa3b6] p-0.5 text-[#9aa3b6]" /></button>
          </div>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ["Прайс лист", priceListFilter, setPriceListFilter, ["Все", ...priceListOptions]],
                ["Пользователь", userFilter, setUserFilter, ["Все", ...userOptions]],
                ["Статус", statusFilter, setStatusFilter, ["Все", "проведен", "черновик"]],
                ["Товар", productFilter, setProductFilter, ["Все", ...productOptions]],
              ] as const
            ).map(([label, value, setter, options]) => (
              <label key={label} className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
                {label}
                <select value={value} onChange={(event) => { setter(event.target.value); setPage(1) }} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
                  {options.map((option) => <option key={option}>{option}</option>)}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
              </label>
            ))}
          </div>
          <button onClick={() => setFilterOpen(false)} className="mt-6 rounded-sm bg-[#586174] px-6 py-3 font-bold uppercase tracking-wide text-white">Применить</button>
        </section>
      )}

      <section className="overflow-x-auto">
        <table className="min-w-[1200px] w-full border-collapse text-[15px]">
          <thead className="bg-[#626b7e] text-white">
            <tr>
              <th className="px-4 py-4 text-left font-semibold">№</th>
              <th className="px-4 py-4 text-left font-semibold">Создал</th>
              <th className="px-4 py-4 text-left font-semibold">Дата создания</th>
              <th className="px-4 py-4 text-left font-semibold">Прайс лист</th>
              <th className="px-4 py-4 text-left font-semibold">Сумма переоценки</th>
              <th className="px-4 py-4 text-left font-semibold">Статус</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-[#9aa3b6]">Загрузка переоценок...</td></tr>
            ) : loadError ? (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-red-600">{loadError}</td></tr>
            ) : (
              visible.map((row, index) => (
                <tr key={row.id} className={`border-b border-dashed border-slate-200 ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"}`}>
                  <td className="px-4 py-4">{row.id}</td>
                  <td className="px-4 py-4">{row.createdBy}</td>
                  <td className="px-4 py-4">{row.createdAt}</td>
                  <td className="px-4 py-4 font-medium text-[#4f70e7]">{row.priceList}</td>
                  <td className="px-4 py-4 font-medium text-[#a35933]">{number(row.amount)} {row.currency}</td>
                  <td className="px-4 py-4">
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full bg-[#69cd87]" /> {row.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
            {!loading && !loadError && visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {linkedModalOpen && <LinkedRevaluationModal priceLists={priceLists} onClose={() => setLinkedModalOpen(false)} />}
      {addModalOpen && (
        <AddRevaluationModal
          priceLists={priceLists}
          products={products}
          onClose={() => setAddModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </main>
  )
}

function LinkedRevaluationModal({ priceLists, onClose }: { priceLists: PriceList[]; onClose: () => void }) {
  const [priceListId, setPriceListId] = useState(priceLists[0]?.id ?? 0)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const priceListName = priceLists.find((item) => item.id === priceListId)?.name ?? ""
      await fetch("/api/linked-repricings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceListId, priceListName }),
      })
    } catch {
      // ignore network failures, still close like the rest of the app does
    }
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(event) => event.stopPropagation()} className="w-[600px] max-w-[92vw] rounded-md bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b px-8 py-6">
          <h2 className="text-xl font-bold uppercase tracking-wide">Добавить прайс-лист</h2>
          <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
        </header>
        <div className="px-8 py-8">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[13px] font-medium text-[#586174]">
            Прайс лист
            <select value={priceListId} onChange={(event) => setPriceListId(Number(event.target.value))} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              {priceLists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
        </div>
        <footer className="flex justify-start border-t px-8 py-5">
          <button disabled={saving} onClick={() => void save()} className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white disabled:opacity-60">
            {saving ? "Сохранение..." : "Сохранить"}
          </button>
        </footer>
      </div>
    </div>
  )
}

type NewItem = { id: number; productId: number | null; price: string }

function AddRevaluationModal({
  priceLists,
  products,
  onClose,
  onCreated,
}: {
  priceLists: PriceList[]
  products: Product[]
  onClose: () => void
  onCreated: (created: Repricing[]) => void
}) {
  const [priceListId, setPriceListId] = useState<number | "">("")
  const [currency, setCurrency] = useState<(typeof currencies)[number] | "">("")
  const [comment, setComment] = useState("")
  const [items, setItems] = useState<NewItem[]>([{ id: 1, productId: null, price: "" }])
  const [saving, setSaving] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const importFromExcel = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    void (async () => {
      const rows = await readExcelRows(file)
      const parsed = rows
        .filter(([productName]) => productName && !/^(товар|наименование|product)$/i.test(productName))
        .map(([productName, price], index) => {
          const match = products.find((product) => product.name === productName)
          return { id: Date.now() + index, productId: match ? match.id : null, price: price || "" }
        })
      if (parsed.length) setItems((current) => [...current.filter((item) => item.productId || item.price), ...parsed, { id: Date.now() + parsed.length, productId: null, price: "" }])
    })()
  }

  const updateItem = (id: number, patch: Partial<NewItem>) => {
    setItems((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item))
      const last = next[next.length - 1]
      if (last.productId || last.price) next.push({ id: last.id + 1, productId: null, price: "" })
      return next
    })
  }

  async function save() {
    if (!priceListId || !currency) return
    const validItems = items.filter((item) => item.productId !== null && item.price)
    if (!validItems.length) {
      onClose()
      return
    }
    setSaving(true)
    const created: Repricing[] = []
    for (const item of validItems) {
      try {
        const response = await fetch("/api/repricings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            priceListId,
            productId: item.productId,
            amount: Number(item.price) || 0,
            currency,
            status: "проведен",
          }),
        })
        if (response.ok) created.push((await response.json()) as Repricing)
      } catch {
        // ignore individual row failures
      }
    }
    setSaving(false)
    onCreated(created)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-white">
      <header className="flex items-center justify-between border-b px-9 py-6">
        <h2 className="text-lg font-bold uppercase tracking-wide">Добавление</h2>
        <button aria-label="Закрыть" onClick={onClose}><X className="h-6 w-6 text-slate-500" /></button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[380px_1fr]">
        <div className="space-y-8 border-b border-r-0 px-9 py-8 md:border-b-0 md:border-r">
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Прайс лист <span className="text-red-500">*</span>
            <select value={priceListId} onChange={(event) => setPriceListId(event.target.value ? Number(event.target.value) : "")} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {priceLists.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Валюта <span className="text-red-500">*</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value as (typeof currencies)[number])} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {currencies.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            <input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Оставить комментарий..." className="mt-1 block w-full bg-transparent text-[15px] outline-none placeholder:text-[#17233b]" />
          </label>
        </div>

        <div className="px-9 py-8">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-medium text-[#586174]">Список товаров</h3>
            <input ref={importInputRef} type="file" accept=".csv,.xls,.xlsx" onChange={importFromExcel} className="hidden" />
            <button type="button" onClick={() => importInputRef.current?.click()} className="text-sm font-medium text-[#4f70e7]"><Upload className="mr-1 inline h-4 w-4" />импортировать с excel</button>
          </div>
          <div className="rounded bg-[#f2f5f8]">
            <div className="grid grid-cols-[1fr_240px_60px] items-center gap-6 px-4 py-3 text-sm font-medium text-[#586174]">
              <span>Наименование</span>
              <span>Новая цена</span>
              <span />
            </div>
            {items.map((item) => (
              <div key={item.id} className="grid grid-cols-[1fr_240px_60px] items-center gap-6 border-t border-white px-4 py-3">
                <select
                  value={item.productId ?? ""}
                  onChange={(event) => updateItem(item.id, { productId: event.target.value ? Number(event.target.value) : null })}
                  className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none"
                >
                  <option value="" />
                  {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                </select>
                <input
                  value={item.price}
                  onChange={(event) => updateItem(item.id, { price: event.target.value })}
                  placeholder="0"
                  className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none"
                />
                <span className={`text-lg ${item.productId && item.price ? "text-[#4f70e7]" : "text-[#c7ccd6]"}`}>✓</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="flex justify-end border-t px-9 py-5">
        <button type="button" disabled={saving} onClick={() => void save()} className="font-bold uppercase tracking-wide text-[#4f70e7] disabled:opacity-60">
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </footer>
    </div>
  )
}
