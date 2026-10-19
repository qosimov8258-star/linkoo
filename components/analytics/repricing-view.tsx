"use client"

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, Upload, X } from "lucide-react"

import { readExcelRows } from "@/lib/excel-import"
import { RI, RefButton, RefCard, RefHeader, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { ReportSelectField } from "@/components/ref/report-kit"

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
  const [priceListFilter, setPriceListFilter] = useState("")
  const [userFilter, setUserFilter] = useState("")
  const [statusFilter, setStatusFilter] = useState("")
  const [productFilter, setProductFilter] = useState("")
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
      if (priceListFilter !== "" && row.priceList !== priceListFilter) return false
      if (userFilter !== "" && row.user !== userFilter) return false
      if (statusFilter !== "" && row.status !== statusFilter) return false
      if (productFilter !== "" && row.product !== productFilter) return false
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

  const filterPanel = (
    <div className="grid w-[640px] grid-cols-2 gap-x-[12px] gap-y-[13px] bg-white p-6 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <ReportSelectField label="Прайс лист" value={priceListFilter} onChange={(value) => { setPriceListFilter(value); setPage(1) }} options={priceListOptions} />
      <ReportSelectField label="Пользователь" value={userFilter} onChange={(value) => { setUserFilter(value); setPage(1) }} options={userOptions} />
      <ReportSelectField label="Статус" value={statusFilter} onChange={(value) => { setStatusFilter(value); setPage(1) }} options={["проведен", "черновик"]} />
      <ReportSelectField label="Товар" value={productFilter} onChange={(value) => { setProductFilter(value); setPage(1) }} options={productOptions} />
      <button onClick={() => setFilterOpen(false)} className="col-span-2 mt-2 h-9 w-fit rounded-[3px] bg-[#5d6474] px-5 text-[13px] font-semibold uppercase text-white shadow">Применить</button>
    </div>
  )

  return (
    <RefPage>
      <RefHeader title="Переоценка">
        <RefButton icon={RI.add} green label="Переоценку связанных" onClick={() => setLinkedModalOpen(true)} />
        <RefButton icon={RI.add} green label="Добавить" onClick={() => setAddModalOpen(true)} />
      </RefHeader>
      <RefCard>
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={filterPanel}
          query={search}
          onQuery={(value) => { setSearch(value); setPage(1) }}
          pageSize={pageSize}
          onPageSize={(size) => { setPageSize(size); setPage(1) }}
          from={filtered.length ? (safePage - 1) * pageSize + 1 : 0}
          to={Math.min(safePage * pageSize, filtered.length)}
          total={filtered.length}
          page={safePage}
          pageCount={maxPage}
          onPage={setPage}
        />
        <RefTable
          cols="0.54fr repeat(5,minmax(0,1fr))"
          heads={["№", "Создал", "Дата создания", "Прайс лист", "Сумма переоценки", "Статус"]}
          rows={loading || loadError ? [] : visible}
          rowKey={(row) => row.id}
          empty={loading ? "Загрузка переоценок..." : loadError || "Ничего не найдено"}
          render={(row) => [row.id, row.createdBy, row.createdAt, row.priceList, `${number(row.amount)} ${row.currency}`, <span key="s" className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-[#71ce87]" />{row.status}</span>]}
        />
      </RefCard>

      {linkedModalOpen && <LinkedRevaluationModal priceLists={priceLists} onClose={() => setLinkedModalOpen(false)} />}
      {addModalOpen && (
        <AddRevaluationModal
          priceLists={priceLists}
          products={products}
          onClose={() => setAddModalOpen(false)}
          onCreated={handleCreated}
        />
      )}
    </RefPage>
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
            <button type="button" onClick={() => importInputRef.current?.click()} className="text-sm font-medium text-[#4f71dc]"><Upload className="mr-1 inline h-4 w-4" />импортировать с excel</button>
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
                <span className={`text-lg ${item.productId && item.price ? "text-[#4f71dc]" : "text-[#c7ccd6]"}`}>✓</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="flex justify-end border-t px-9 py-5">
        <button type="button" disabled={saving} onClick={() => void save()} className="font-bold uppercase tracking-wide text-[#4f71dc] disabled:opacity-60">
          {saving ? "Сохранение..." : "Сохранить"}
        </button>
      </footer>
    </div>
  )
}
