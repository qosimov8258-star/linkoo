"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  Search,
  X,
} from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import type { Product } from "@/components/analytics/products-data"

type Mode = "quantity" | "cost" | "price"

type StockRow = {
  product: string
  article: string
  type: string
  // NOTE (real-data gap): there is no live per-product / per-warehouse
  // on-hand quantity ledger anywhere in the schema. `inventory_items`
  // tracks physical assets attached to clients (fridges, freezers...) and
  // `inventory_records` only stores one free-text warehouse-level `amount`
  // string per reconciliation, not a per-product breakdown. So `total`,
  // `reserved` and `transit` are honestly 0 for every row below rather than
  // fabricated — see the report for details.
  total: number
  reserved: number
  transit: number
  unit: string
  // No real per-product warehouse assignment exists (products aren't linked
  // to a warehouse anywhere in the schema), so this is always "Не указано" —
  // the warehouse filter below stays in the UI but has nothing real to
  // filter on yet.
  warehouse: string
  organization: string
  cost: number
  price: number
  minStock: string
}

function productToRow(product: Product): StockRow {
  const priceListMax = product.priceLists.reduce((max, entry) => Math.max(max, entry.cash || 0, entry.nonCash || 0), 0)
  return {
    product: product.name,
    article: product.article || "-",
    type: product.type || "Не указано",
    total: 0,
    reserved: 0,
    transit: 0,
    unit: product.unit || "шт.",
    warehouse: "Не указано",
    organization: product.organization || "Не указано",
    cost: product.cost,
    price: product.priceMax || priceListMax,
    minStock: product.minStock,
  }
}

const formatNumber = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function downloadExcel(data: StockRow[]) {
  const headings = ["Продукт", "Артикул", "Тип товара", "Всего", "Забронировано", "В пути", "Доступно", "Ед. изм."]
  const body = data.map((row) => [
    row.product,
    row.article,
    row.type,
    row.total,
    row.reserved,
    row.transit,
    row.total - row.reserved,
    row.unit,
  ])
  downloadExcelTable("stock-level", [headings, ...body])
}

export function StockLevelView() {
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<Mode>("quantity")
  const [search, setSearch] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [warehouse, setWarehouse] = useState("Все склады")
  const [type, setType] = useState("Все типы товаров")
  const [display, setDisplay] = useState("Количество")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch("/api/products")
      .then(async (response) => (response.ok ? ((await response.json()) as Product[]) : []))
      .then((products) => {
        if (!cancelled) setRows(products.filter((product) => !product.deleted).map(productToRow))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("ru")
    return rows.filter((row) => {
      const matchesSearch = !needle || [row.product, row.article, row.type].some((value) => value.toLocaleLowerCase("ru").includes(needle))
      const matchesWarehouse = warehouse === "Все склады" || row.warehouse === warehouse
      const matchesType = type === "Все типы товаров" || row.type === type
      return matchesSearch && matchesWarehouse && matchesType
    })
  }, [search, type, warehouse])

  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const total = filtered.reduce((sum, row) => sum + row.total, 0)
  const reserved = filtered.reduce((sum, row) => sum + row.reserved, 0)
  const transit = filtered.reduce((sum, row) => sum + row.transit, 0)

  const value = (row: StockRow, key: "total" | "reserved" | "transit" | "available") => {
    const quantity = key === "available" ? row.total - row.reserved : row[key]
    if (mode === "quantity") return `${formatNumber(quantity)} ${row.unit}`
    const rate = mode === "cost" ? row.cost : row.price
    return `${formatNumber(quantity * rate)} SUM`
  }

  const applyFilter = () => {
    setPage(1)
    setShowFilter(false)
  }

  return (
    <main className="min-h-screen bg-[#f2f5f8] text-[#17233d]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d7dde7] bg-[#f4f6f9] px-5 md:px-10">
        <div className="flex items-center gap-3 text-left">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f71dc]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Остаток</span>
        </div>
      </header>

      <section className="bg-white px-5 py-6 md:px-10">
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={() => setShowFilter(true)} className="flex h-11 items-center gap-3 rounded-md bg-[#4f70df] px-5 font-semibold text-white shadow">
            <Filter className="h-5 w-5" /> Фильтр
          </button>
          <button onClick={() => { setWarehouse("Все склады"); setType("Все типы товаров"); setPage(1) }} className="font-semibold text-[#4f71dc]">
            Во всей организации
          </button>
          <button onClick={() => downloadExcel(filtered)} className="ml-auto flex h-11 items-center gap-3 rounded-md bg-[#69cd87] px-5 font-semibold text-white">
            <Download className="h-5 w-5" /> Скачать
          </button>
        </div>

        <div className="mt-4 grid gap-4 border-b border-[#e1e5eb] pb-4 text-lg md:grid-cols-4">
          <div><p className="text-base text-[#6d7480]">Общая сумма</p><b>{formatNumber(total)} шт</b></div>
          <div><p className="text-base text-[#6d7480]">Сумма забронированных</p><b>{formatNumber(reserved)} шт</b></div>
          <div><p className="text-base text-[#6d7480]">В пути</p><b>{formatNumber(transit)} шт</b></div>
          <div className="md:text-right"><p className="text-base text-[#6d7480]">Сумма доступных</p><b>{formatNumber(total - reserved)} шт</b></div>
        </div>

        <div className="mt-8 flex flex-wrap items-end gap-4">
          <div className="flex">
            {([["quantity", "КОЛ-ВО"], ["cost", "СЕБЕСТОИМОСТЬ"], ["price", "ПРАЙС ЛИСТ"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setMode(key)} className={`h-10 border px-5 ${mode === key ? "border-[#4f71dc] bg-[#4f71dc] text-white shadow" : "border-[#d8dde5] bg-white text-black"} first:rounded-l-md last:rounded-r-md`}>
                {label}
              </button>
            ))}
          </div>
          <label className="relative ml-auto w-full max-w-[425px]">
            <span className="font-semibold">Поиск</span>
            <input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className="mt-1 h-10 w-full border-b border-[#ccd3dc] bg-transparent pr-10 outline-none" />
            <Search className="absolute bottom-2 right-1 h-6 w-6 text-[#667085]" />
          </label>
          <label className="min-w-[250px] text-xs">
            Показать
            <span className="relative mt-1 flex h-10 items-center border-b border-[#ccd3dc] text-base font-semibold">
              <select value={display} onChange={(event) => setDisplay(event.target.value)} className="h-full w-full appearance-none bg-transparent pr-8 outline-none">
                <option>Количество</option><option>Доступно</option><option>Забронировано</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-[#9ca3af]" />
            </span>
          </label>
          <label className="relative flex h-10 items-center gap-2 border-b border-[#ccd3dc]">
            <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="appearance-none bg-transparent pr-7 outline-none">
              <option>10</option><option>25</option><option>50</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-0 h-4 w-4 text-[#c3c8cf]" />
          </label>
          <span className="pb-2 text-[#667085]">{filtered.length ? (safePage - 1) * pageSize + 1 : 0} - {Math.min(safePage * pageSize, filtered.length)} из {filtered.length}</span>
          <button aria-label="Предыдущая страница" disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="mb-1 rounded-full border-2 border-[#b8bdc4] p-1 disabled:opacity-40"><ChevronLeft /></button>
          <button aria-label="Следующая страница" disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="mb-1 rounded-full border-2 border-[#888f97] p-1 disabled:opacity-40"><ChevronRight /></button>
        </div>
      </section>

      <section className="overflow-x-auto bg-white px-5 pb-8 md:px-10">
        <table className="w-full min-w-[1050px] border-collapse text-base">
          <thead className="sticky top-0 z-10 bg-[#edf1f6] text-[#263653] shadow">
            <tr>{["Продукт", "Артикул", "Тип товара", "Всего", "Забронировано", "В пути", "Доступно"].map((title) => <th key={title} className="border border-[#dfe4ea] px-3 py-3 text-center font-semibold">{title}</th>)}</tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const open = expanded === row.product
              return (
                <Fragment key={row.product}>
                  <tr className={index % 2 ? "bg-[#f0f5fa]" : "bg-white"}>
                    <td className="border border-[#e1e5e9] px-4 py-3">
                      <button aria-label={`${row.product} tafsilotlari`} onClick={() => setExpanded(open ? null : row.product)} className="flex items-center gap-2 text-left">
                        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 fill-current" />} {row.product}
                      </button>
                    </td>
                    <td className="border border-[#e1e5e9] px-2 py-3">{row.article}</td>
                    <td className="border border-[#e1e5e9] px-2 py-3">{row.type}</td>
                    <td className="border border-[#e1e5e9] px-2 py-3 text-right font-bold">{value(row, "total")}</td>
                    <td className="border border-[#e1e5e9] px-2 py-3 text-right font-semibold text-[#049bea]">{value(row, "reserved")}</td>
                    <td className="border border-[#e1e5e9] px-2 py-3 text-right font-semibold text-[#ff9d18]">{value(row, "transit")}</td>
                    <td className="border border-[#e1e5e9] px-2 py-3 text-right">{value(row, "available")}</td>
                  </tr>
                  {open && (
                    <tr className="bg-[#f8fbff]">
                      <td colSpan={7} className="border border-[#d9e2ec] px-12 py-4">
                        <div className="grid gap-3 md:grid-cols-3">
                          <span><b>Организация:</b> {row.organization}</span>
                          <span><b>Себестоимость:</b> {formatNumber(row.cost)} SUM</span>
                          <span><b>Прайс-лист:</b> {formatNumber(row.price)} SUM</span>
                          <span><b>Мин. остаток:</b> {row.minStock}</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {!visible.length && (
          <div className="p-16 text-center text-[#8b95a5]">
            {loading ? "Загрузка..." : "По вашему запросу ничего не найдено..."}
          </div>
        )}
      </section>

      {showFilter && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-24" role="dialog" aria-modal="true">
          <div className="w-full max-w-4xl rounded-sm bg-white p-8 shadow-2xl">
            <div className="flex items-center justify-between"><h2 className="text-xl font-bold">ФИЛЬТР</h2><button aria-label="Закрыть" onClick={() => setShowFilter(false)}><X /></button></div>
            <div className="mt-8 grid gap-8 md:grid-cols-2">
              <label className="font-semibold">Склад
                <select value={warehouse} onChange={(event) => setWarehouse(event.target.value)} className="mt-2 h-12 w-full border-b border-[#ccd3dc] bg-white outline-none">
                  {["Все склады", ...Array.from(new Set(rows.map((row) => row.warehouse)))].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
              <label className="font-semibold">Тип товара
                <select value={type} onChange={(event) => setType(event.target.value)} className="mt-2 h-12 w-full border-b border-[#ccd3dc] bg-white outline-none">
                  {["Все типы товаров", ...Array.from(new Set(rows.map((row) => row.type)))].map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            </div>
            <button onClick={applyFilter} className="mt-10 h-11 w-full rounded bg-[#69cd87] font-bold text-white">Применить</button>
          </div>
        </div>
      )}
    </main>
  )
}
