"use client"

import { Fragment, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Filter,
  Search,
  Star,
  X,
} from "lucide-react"

type Mode = "quantity" | "cost" | "price"

type StockRow = {
  product: string
  article: string
  type: string
  total: number
  reserved: number
  transit: number
  unit: string
  warehouse: string
  cost: number
  price: number
}

const rows: StockRow[] = [
  { product: "robot moshina", article: "1009", type: "Texnika", total: 160589, reserved: 33, transit: 1, unit: "dona", warehouse: "Asosiy ombor", cost: 145000, price: 185000 },
  { product: "sndwch", article: "", type: "oziq ovqat", total: 5539434, reserved: 18, transit: 54, unit: "sht", warehouse: "Tayyor mahsulotlar", cost: 10000, price: 12000 },
  { product: "energetik 1 l", article: "123321", type: "flash", total: 102331, reserved: 237, transit: 0, unit: "кг", warehouse: "Asosiy ombor", cost: 7500, price: 10000 },
  { product: "g'ilof", article: "62", type: "idish", total: 200022670, reserved: 4, transit: 852, unit: "шт", warehouse: "777", cost: 2400, price: 3500 },
  { product: "old", article: "", type: "Coca Cola", total: 128, reserved: 1, transit: 0, unit: "blok", warehouse: "878", cost: 80000, price: 96000 },
  { product: "shokolod", article: "", type: "muuzdek ichimlik", total: 48961.667, reserved: 0, transit: 0, unit: "dona", warehouse: "Andijon", cost: 6400, price: 8000 },
  { product: "Маркер", article: "", type: "сырье", total: 3, reserved: 0, transit: 0, unit: "dona", warehouse: "Asosiy ombor", cost: 2500, price: 4000 },
  { product: "Fuse tea 0.9", article: "0001", type: "54455", total: 60, reserved: 0, transit: 0, unit: "Dona", warehouse: "AURUM samarqand", cost: 8000, price: 10000 },
  { product: "ун", article: "", type: "56756", total: 20, reserved: 0, transit: 0, unit: "Dona", warehouse: "Xomashyo", cost: 6500, price: 8000 },
  { product: "cola 2.25 L", article: "", type: "Coca Cola", total: 0, reserved: 0, transit: 0, unit: "Dona", warehouse: "777", cost: 11000, price: 14000 },
  { product: "Aqua de lux 0.33 bez gaz", article: "", type: "gf,knopgf", total: 37, reserved: 0, transit: 0, unit: "Dona", warehouse: "878", cost: 3000, price: 4500 },
  { product: "Cola", article: "100-4563", type: "KIYIM KECHAK", total: 101200, reserved: 224, transit: 0, unit: "Dona", warehouse: "agent", cost: 9000, price: 12000 },
  { product: "Kefir 0.8", article: "", type: "kkkd", total: 0, reserved: 0, transit: 0, unit: "Dona", warehouse: "Andijon", cost: 7000, price: 9500 },
  { product: "name of product", article: "", type: "oziq ovqat", total: 2999950, reserved: 0, transit: 0, unit: "Dona", warehouse: "Asosiy ombor", cost: 15000, price: 19000 },
  { product: "sdfefsa", article: "", type: "cola 0.5l", total: 0, reserved: 0, transit: 0, unit: "gramm", warehouse: "Xomashyo", cost: 30, price: 45 },
  { product: "my_product_1", article: "", type: "oziq ovqat", total: 0, reserved: 0, transit: 0, unit: "kg", warehouse: "Asosiy ombor", cost: 18000, price: 23000 },
  { product: "Muzlatkich 2", article: "", type: "avto", total: 510019, reserved: 0, transit: 0, unit: "лт", warehouse: "Inventar", cost: 2100000, price: 2500000 },
  { product: "coca-cola", article: "", type: "напитки", total: 31113, reserved: 1, transit: 0, unit: "лт", warehouse: "777", cost: 8500, price: 11000 },
  { product: "ays tea 0.5", article: "", type: "gazlanmagan", total: 118, reserved: 0, transit: 0, unit: "новый шт", warehouse: "878", cost: 6500, price: 8500 },
  { product: "pankiy", article: "", type: "54455", total: 49990, reserved: 0, transit: 1, unit: "новый шт", warehouse: "agent", cost: 12000, price: 16000 },
  { product: "tovar11", article: "", type: "Coca Cola", total: 1200000, reserved: 0, transit: 1, unit: "новый шт", warehouse: "Asosiy ombor", cost: 5000, price: 7500 },
  { product: "Alpendgdfg", article: "", type: "fghgf", total: 0, reserved: 0, transit: 0, unit: "шт", warehouse: "Andijon", cost: 0, price: 0 },
  { product: "Tekshirish uchun", article: "100-1232", type: "56756", total: 2000, reserved: 0, transit: 0, unit: "шт", warehouse: "AURUM samarqand", cost: 500, price: 750 },
  { product: "try5r", article: "100-1232", type: "567568678", total: 0, reserved: 0, transit: 0, unit: "шт", warehouse: "777", cost: 0, price: 0 },
  { product: "fghfh", article: "100-1232", type: "568678", total: 0, reserved: 0, transit: 0, unit: "шт", warehouse: "878", cost: 0, price: 0 },
  ...Array.from({ length: 30 }, (_, index) => ({
    product: `Mahsulot ${index + 1}`,
    article: `ART-${String(index + 1).padStart(4, "0")}`,
    type: index % 2 ? "oziq ovqat" : "Coca Cola",
    total: (index + 1) * 137,
    reserved: index % 5,
    transit: index % 4,
    unit: "шт",
    warehouse: index % 2 ? "Asosiy ombor" : "777",
    cost: 3000 + index * 100,
    price: 4500 + index * 150,
  })),
]

const formatNumber = (value: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 3 }).format(value)

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
  const table = [headings, ...body]
    .map((line) => `<tr>${line.map((cell) => `<td>${String(cell).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</td>`).join("")}</tr>`)
    .join("")
  const blob = new Blob([`\ufeff<html><meta charset="UTF-8"><table>${table}</table></html>`], {
    type: "application/vnd.ms-excel;charset=utf-8",
  })
  const link = document.createElement("a")
  link.href = URL.createObjectURL(blob)
  link.download = "stock-level.xls"
  link.click()
  URL.revokeObjectURL(link.href)
}

export function StockLevelView() {
  const [favorite, setFavorite] = useState(false)
  const [mode, setMode] = useState<Mode>("quantity")
  const [search, setSearch] = useState("")
  const [showFilter, setShowFilter] = useState(false)
  const [warehouse, setWarehouse] = useState("Все склады")
  const [type, setType] = useState("Все типы товаров")
  const [display, setDisplay] = useState("Количество")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<string | null>(null)

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
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233d]">
      <header className="flex min-h-[76px] items-center justify-between border-b border-[#d7dde7] bg-[#f4f6f9] px-5 md:px-10">
        <button onClick={() => setFavorite((value) => !value)} className="flex items-center gap-3 text-left">
          <Star className={`h-7 w-7 ${favorite ? "fill-[#4f70e7] text-[#4f70e7]" : "fill-[#596376] text-[#596376]"}`} />
          <span className="text-2xl font-bold text-[#4f70e7]">Избранные</span>
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">Остаток</span>
        </button>
      </header>

      <section className="bg-white px-5 py-6 md:px-10">
        <div className="flex flex-wrap items-center gap-4">
          <button onClick={() => setShowFilter(true)} className="flex h-11 items-center gap-3 rounded-md bg-[#4f70df] px-5 font-semibold text-white shadow">
            <Filter className="h-5 w-5" /> Фильтр
          </button>
          <button onClick={() => { setWarehouse("Все склады"); setType("Все типы товаров"); setPage(1) }} className="font-semibold text-[#4f70e7]">
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
              <button key={key} onClick={() => setMode(key)} className={`h-10 border px-5 ${mode === key ? "border-[#4f70e7] bg-[#4f70e7] text-white shadow" : "border-[#d8dde5] bg-white text-black"} first:rounded-l-md last:rounded-r-md`}>
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
                          <span><b>Склад:</b> {row.warehouse}</span>
                          <span><b>Себестоимость:</b> {formatNumber(row.cost)} SUM</span>
                          <span><b>Прайс-лист:</b> {formatNumber(row.price)} SUM</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {!visible.length && <div className="p-16 text-center text-[#8b95a5]">По вашему запросу ничего не найдено...</div>}
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
