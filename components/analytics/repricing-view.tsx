"use client"

import { ChangeEvent, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Filter, PlusCircle, Search, Star, Upload, X } from "lucide-react"

type Revaluation = {
  id: number
  createdBy: string
  createdAt: string
  priceList: string
  amount: number
  currency: "SUM" | "USD" | "Euro"
  status: "проведен" | "черновик"
  user: string
  product: string
}

const priceLists = ["11111", "123123123", "878", "asus vivobook", "attack", "Attack250", "Шт14", "donalik", "savdo", "Bozor narx", "tovar"]
const users = ["Admin Ritm", "Samandar Abdurahmonov", "Temur Raupov"]
const products = ["sndwch", "robot moshina", "g'ilof", "energetik 1 l"]

function seededRandom(seed: number) {
  const value = Math.sin(seed) * 10000
  return value - Math.floor(value)
}

const rows: Revaluation[] = Array.from({ length: 89 }, (_, index) => {
  const id = 89 - index
  const priceList = priceLists[id % priceLists.length]
  const currency: Revaluation["currency"] = id % 11 === 0 ? "USD" : id % 7 === 0 ? "Euro" : "SUM"
  const magnitude = Math.round(seededRandom(id) * 120000000)
  const sign = id % 5 === 0 ? 0 : id % 3 === 0 ? -1 : 1
  const day = 1 + (id % 28)
  const month = ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."][id % 12]
  const monthFull = ["Января", "Февраля", "Марта", "Апреля", "Мая", "Июня", "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря"][id % 12]
  const year = id > 60 ? 2026 : id > 20 ? 2025 : 2024
  const dateLabel = month === "мая" || month === "июня" || month === "июля"
    ? `${String(day).padStart(2, "0")} ${monthFull.toLocaleLowerCase("ru")} ${year}`
    : `${String(day).padStart(2, "0")} ${month} ${year}`
  return {
    id,
    createdBy: "Admin Ritm",
    createdAt: dateLabel,
    priceList,
    amount: sign * magnitude,
    currency,
    status: "проведен",
    user: users[id % users.length],
    product: products[id % products.length],
  }
})

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
const favoriteItems = ["Клиенты", "Заказы", "Виджеты", "Заказы", "Ограничение продуктов", "Продукты"]

export function RepricingView() {
  const [favorite, setFavorite] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
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

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (search.trim() && !String(row.id).includes(search.trim()) && !row.priceList.toLocaleLowerCase("ru").includes(search.trim().toLocaleLowerCase("ru"))) return false
      if (priceListFilter !== "Все" && row.priceList !== priceListFilter) return false
      if (userFilter !== "Все" && row.user !== userFilter) return false
      if (statusFilter !== "Все" && row.status !== statusFilter) return false
      if (productFilter !== "Все" && row.product !== productFilter) return false
      return true
    })
  }, [priceListFilter, productFilter, search, statusFilter, userFilter])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e1e5eb] px-6 py-5 md:px-9">
        <button onClick={() => setFavoritesOpen(true)} className="flex items-center gap-3">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Переоценка</span>
        </button>
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
                ["Прайс лист", priceListFilter, setPriceListFilter, ["Все", ...priceLists]],
                ["Пользователь", userFilter, setUserFilter, ["Все", ...users]],
                ["Статус", statusFilter, setStatusFilter, ["Все", "проведен", "черновик"]],
                ["Товар", productFilter, setProductFilter, ["Все", ...products]],
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
            {visible.map((row, index) => (
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
            ))}
            {visible.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-16 text-center text-[#9aa3b6]">Ничего не найдено</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {favoritesOpen && (
        <div className="fixed inset-0 z-[100] flex">
          <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)} className="flex-1 bg-black/40" />
          <aside className="w-[420px] max-w-[90vw] bg-white shadow-2xl">
            <header className="flex items-center justify-between border-b px-8 py-6">
              <h2 className="text-2xl font-semibold">Избранные</h2>
              <button aria-label="Закрыть" onClick={() => setFavoritesOpen(false)}><X className="h-6 w-6 text-slate-600" /></button>
            </header>
            {favoriteItems.map((item, index) => (
              <button
                key={`${item}-${index}`}
                type="button"
                onClick={() => { setFavorite(true); setFavoritesOpen(false) }}
                className="flex w-full items-center justify-between border-b px-8 py-5 text-left text-lg"
              >
                {item} <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </aside>
        </div>
      )}

      {linkedModalOpen && <LinkedRevaluationModal onClose={() => setLinkedModalOpen(false)} />}
      {addModalOpen && <AddRevaluationModal onClose={() => setAddModalOpen(false)} />}
    </main>
  )
}

function LinkedRevaluationModal({ onClose }: { onClose: () => void }) {
  const [priceList, setPriceList] = useState(priceLists[0])
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
            <select value={priceList} onChange={(event) => setPriceList(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[16px] font-semibold text-[#17233b] outline-none">
              {priceLists.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
        </div>
        <footer className="flex justify-start border-t px-8 py-5">
          <button onClick={onClose} className="rounded-sm bg-[#69cd87] px-6 py-2.5 font-bold uppercase tracking-wide text-white">Сохранить</button>
        </footer>
      </div>
    </div>
  )
}

function AddRevaluationModal({ onClose }: { onClose: () => void }) {
  const [priceList, setPriceList] = useState("")
  const [currency, setCurrency] = useState("")
  const [comment, setComment] = useState("")
  const [items, setItems] = useState<{ id: number; product: string; price: string }[]>([{ id: 1, product: "", price: "" }])
  const importInputRef = useRef<HTMLInputElement>(null)

  const importFromExcel = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const lines = String(reader.result ?? "").split(/\r?\n/).filter(Boolean)
      const parsed = lines
        .map((line) => line.split(/[;,\t]/).map((cell) => cell.trim()))
        .filter(([product]) => product && !/^(товар|наименование|product)$/i.test(product))
        .map(([product, price], index) => ({ id: Date.now() + index, product, price: price || "" }))
      if (parsed.length) setItems((current) => [...current.filter((item) => item.product || item.price), ...parsed, { id: Date.now() + parsed.length, product: "", price: "" }])
    }
    reader.readAsText(file)
  }

  const updateItem = (id: number, patch: Partial<{ product: string; price: string }>) => {
    setItems((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, ...patch } : item))
      const last = next[next.length - 1]
      if (last.product || last.price) next.push({ id: last.id + 1, product: "", price: "" })
      return next
    })
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
            <select value={priceList} onChange={(event) => setPriceList(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              {priceLists.map((item) => <option key={item}>{item}</option>)}
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 top-7 h-4 w-4 text-[#9aa3b6]" />
          </label>
          <label className="relative block border-b border-[#dbe0e8] pb-2 text-[15px] font-medium">
            Валюта <span className="text-red-500">*</span>
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 block w-full appearance-none bg-transparent pr-6 text-[15px] font-normal outline-none">
              <option value="" />
              <option>SUM</option>
              <option>USD</option>
              <option>Euro</option>
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
                  value={item.product}
                  onChange={(event) => updateItem(item.id, { product: event.target.value })}
                  className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none"
                >
                  <option value="" />
                  {products.map((product) => <option key={product}>{product}</option>)}
                </select>
                <input
                  value={item.price}
                  onChange={(event) => updateItem(item.id, { price: event.target.value })}
                  placeholder="0"
                  className="border-b border-[#dbe0e8] bg-transparent py-1 text-[15px] outline-none"
                />
                <span className={`text-lg ${item.product && item.price ? "text-[#4f70e7]" : "text-[#c7ccd6]"}`}>✓</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <footer className="flex justify-end border-t px-9 py-5">
        <button onClick={onClose} className="font-bold uppercase tracking-wide text-[#4f70e7]">Сохранить</button>
      </footer>
    </div>
  )
}
