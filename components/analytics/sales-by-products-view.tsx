"use client"

import { FormEvent, useMemo, useState } from "react"
import { Download, Expand, ListFilter, Search, Star, X } from "lucide-react"

const products = [
  { name: "sndwch", unit: "sht", saleQty: 22, saleSum: 220000, returnQty: 2, returnSum: 20000 },
  { name: "Apple Juice", unit: "sht", saleQty: 8, saleSum: 96000, returnQty: 0, returnSum: 0 },
  { name: "Aqua de lux", unit: "sht", saleQty: 14, saleSum: 154000, returnQty: 1, returnSum: 11000 },
]

const options = {
  branch: ["Все филиалы", "777", "878", "Andijon", "AURUM samarqand"],
  brand: ["Все бренды", "Alpen Gold", "Aple", "Apple", "Aqua de lux", "arbuz privet"],
  organization: ["Все организации", "Linko", "Time3 Distribution"],
  productType: ["Все типы товара", "Мыло", "Напитки", "Снеки"],
  status: ["Все статусы", "Завершено", "В процессе", "Отменено"],
  client: ["Все клиенты", "Doston market", "Markus Vitinha", "Usman Dembele"],
  agent: ["Все агенты", "Samandar Abdurahmonov", "Хайрулло Доставщик"],
  clientType: ["Все типы клиентов", "horeca", "market", "market100"],
  warehouse: ["Все склады", "Основной склад", "Склад Andijon"],
}

type FilterKey = keyof typeof options

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function SalesByProductsView() {
  const today = useMemo(() => iso(new Date()), [])
  const start = useMemo(() => {
    const date = new Date()
    return iso(new Date(date.getFullYear(), date.getMonth(), 1))
  }, [])
  const [favorite, setFavorite] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<"created" | "warehouse">("created")
  const [reportMode, setReportMode] = useState<"created" | "profit">("created")
  const [group, setGroup] = useState("По продукту")
  const [pageSize, setPageSize] = useState(25)
  const [from, setFrom] = useState(start)
  const [to, setTo] = useState(today)
  const [bonus, setBonus] = useState(false)
  const [filters, setFilters] = useState<Record<FilterKey, string>>(
    Object.fromEntries(Object.entries(options).map(([key, values]) => [key, values[0]])) as Record<FilterKey, string>,
  )

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products
      .filter((row) => !term || row.name.toLowerCase().includes(term))
      .map((row) => {
        const factor = reportMode === "created" ? 1 : 0.95
        return { ...row, saleSum: Math.round(row.saleSum * factor) }
      })
  }, [query, reportMode])
  const totals = rows.reduce(
    (sum, row) => ({
      saleQty: sum.saleQty + row.saleQty,
      saleSum: sum.saleSum + row.saleSum,
      returnQty: sum.returnQty + row.returnQty,
      returnSum: sum.returnSum + row.returnSum,
    }),
    { saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0 },
  )

  function setFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function apply(event: FormEvent) {
    event.preventDefault()
    if (from <= to) setFilterOpen(false)
  }

  function download() {
    const header = "Товар;Ед. измер;Продажа кол-во;Продажа сумма;Возврат кол-во;Возврат сумма;Фактическая продажа кол-во;Фактическая продажа сумма"
    const body = rows.map((row) =>
      [row.name, row.unit, row.saleQty, row.saleSum, row.returnQty, row.returnSum, row.saleQty - row.returnQty, row.saleSum - row.returnSum].join(";"),
    )
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "sales-by-products.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="min-h-[calc(100vh-4rem)] bg-slate-100">
      <header className="flex items-center gap-3 border-b px-5 py-4 text-xl font-bold sm:px-10 sm:text-2xl">
        <button type="button" onClick={() => setFavorite(!favorite)} className="flex items-center gap-2 text-[#5470e8]">
          <Star className={`h-6 w-6 ${favorite ? "fill-amber-400 text-amber-400" : "fill-slate-600 text-slate-600"}`} />
          Избранные
        </button>
        <span className="text-slate-500">|</span>
        <h1 className="text-slate-600">Прибыль от товаров</h1>
      </header>

      <section className={fullscreen ? "fixed inset-0 z-[80] overflow-auto bg-white p-5" : "bg-white px-4 py-6 sm:px-10"}>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => setFilterOpen(true)} className="rounded-md bg-[#5470e8] px-5 py-2.5 font-bold text-white">
            <ListFilter className="mr-2 inline h-5 w-5" />Фильтр / 1
          </button>
          <strong className="text-[#5470e8]">{formatDate(from)} - {formatDate(to)} {filters.organization}</strong>
          <button type="button" onClick={download} className="ml-auto rounded-md bg-[#6ccd8b] px-5 py-2.5 font-bold text-white">
            <Download className="mr-2 inline h-5 w-5" />Скачать
          </button>
          {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="rounded border px-3 py-2">Закрыть</button>}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <Summary label="Сумма от продаж" sum={totals.saleSum} qty={totals.saleQty} />
          <Summary label="Сумма возвратов" sum={totals.returnSum} qty={totals.returnQty} />
          <Summary label="Фактические продажи" sum={totals.saleSum - totals.returnSum} qty={totals.saleQty - totals.returnQty} right />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-5 border-b pb-3">
          <label className="relative w-full max-w-lg">
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск" className="w-full border-b py-2 pr-9 outline-none" />
            <Search className="absolute right-1 top-2 h-5 w-5 text-slate-600" />
          </label>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="ml-auto bg-white"><option>10</option><option>25</option><option>50</option></select>
          <span>{rows.length ? `1 - ${Math.min(pageSize, rows.length)} из ${rows.length}` : "0 из 0"}</span>
          <button type="button" disabled>◀</button><button type="button" disabled>▶</button>
          <button type="button" onClick={() => setFullscreen(!fullscreen)} aria-label="Полный экран"><Expand className="h-5 w-5" /></button>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-4 py-3">
          <p className="text-lg font-semibold text-[#5470e8]">ⓘ Это оперативный отчет. Для просмотра факта перейдите в другой раздел</p>
          <label className="min-w-64 text-xs">Группировка
            <select value={group} onChange={(event) => setGroup(event.target.value)} className="block w-full border-b bg-white py-2 text-base">
              <option>По продукту</option><option>По бренду</option><option>По типу продукта</option>
            </select>
          </label>
          <div className="flex">
            <ModeButton active={reportMode === "created"} onClick={() => setReportMode("created")}>ПОКАЗАТЬ ПО ДАТЕ СОЗДАНИЯ</ModeButton>
            <ModeButton active={reportMode === "profit"} onClick={() => setReportMode("profit")}>ПРОДАЖА ПО ТОВАРАМ С ПРИБЫЛЬЮ</ModeButton>
          </div>
        </div>

        <ProductTable rows={rows.slice(0, pageSize)} bonus={bonus} />
      </section>

      {filterOpen && (
        <div className="fixed inset-0 z-[100] flex items-start justify-center bg-black/30 p-4 pt-12">
          <form onSubmit={apply} className="w-full max-w-[1840px] bg-white p-8 shadow-2xl">
            <header className="flex items-center justify-between"><h2 className="font-bold">Фильтр</h2><button type="button" onClick={() => setFilterOpen(false)}><X /></button></header>
            <div className="mt-6 grid grid-cols-2">
              <button type="button" onClick={() => setMode("created")} className={`rounded py-3 ${mode === "created" ? "bg-[#5470e8] text-white" : "border"}`}>Период создания</button>
              <button type="button" onClick={() => setMode("warehouse")} className={`rounded py-3 ${mode === "warehouse" ? "bg-[#5470e8] text-white" : "border"}`}>Передачи со склада</button>
            </div>
            <div className="mt-8 grid gap-x-8 gap-y-10 md:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs">{mode === "created" ? "Период создания" : "Период передачи со склада"}<span className="mt-1 grid grid-cols-2 gap-2"><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border-b py-2 text-base" /><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="border-b py-2 text-base" /></span></label>
              {(["branch", "brand", "organization", "productType", "status", "client", "agent", "clientType", "warehouse"] as FilterKey[]).map((key) => <FilterSelect key={key} name={key} value={filters[key]} onChange={(value) => setFilter(key, value)} />)}
              <label className="flex items-center gap-3"><input type="checkbox" checked={bonus} onChange={(event) => setBonus(event.target.checked)} className="h-5 w-5" />Показать бонусные продукты</label>
            </div>
            <button type="submit" className="mt-5 w-full rounded bg-[#6ccd8b] py-3 font-bold text-white">Применить</button>
          </form>
        </div>
      )}
    </main>
  )
}

function ProductTable({ rows, bonus }: { rows: typeof products; bonus: boolean }) {
  return <div className="overflow-x-auto"><table className="min-w-[1400px] w-full border-collapse text-sm"><thead><tr className="bg-slate-100 text-slate-700"><th colSpan={2} /><Group title="Продажа" /><Group title="Возврат в этом периоде" /><Group title="Фактическая продажа" /><Group title="Скидки" /><Group title="Бонус" /></tr><tr className="bg-slate-100">{["Товар","Ед. измер","Кол-во","Сумма","Кол-во","Сумма","Кол-во","Сумма","Кол-во","Сумма","Кол-во","Сумма"].map((item, i) => <th key={`${item}-${i}`} className="border px-3 py-3">{item}</th>)}</tr></thead><tbody>{rows.map((row) => { const cells = [row.name,row.unit,row.saleQty,row.saleSum,row.returnQty,row.returnSum,row.saleQty-row.returnQty,row.saleSum-row.returnSum,0,0,bonus ? 1 : 0,bonus ? 5000 : 0]; return <tr key={row.name}>{cells.map((cell, i) => <td key={i} className={`border px-2 py-3 ${i > 1 && Number(cell) > 0 ? "text-green-600" : ""}`}>{typeof cell === "number" ? cell.toLocaleString("ru-RU") : cell}</td>)}</tr>})}</tbody></table></div>
}
function Group({ title }: { title: string }) { return <th colSpan={2} className="border px-3 py-3">{title}</th> }
function Summary({ label, sum, qty, right = false }: { label: string; sum: number; qty: number; right?: boolean }) { return <div className={`border px-5 py-3 ${right ? "text-right" : ""}`}><p className="text-slate-500">{label}</p><strong className="text-xl text-[#6ccd8b]">{sum.toLocaleString("ru-RU")} SUM <small className="text-base text-slate-700">({qty} шт)</small></strong></div> }
function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded px-5 py-2.5 ${active ? "bg-[#5470e8] text-white shadow" : "border bg-white"}`}>{children}</button> }
function formatDate(value: string) { const [year, month, day] = value.split("-"); return `${day}.${month}.${year}` }

const labels: Record<FilterKey, string> = { branch: "Филиалы", brand: "Бренд", organization: "Организация", productType: "Тип товара", status: "Статус", client: "Клиент", agent: "Агент", clientType: "Тип клиента", warehouse: "Склад" }
function FilterSelect({ name, value, onChange }: { name: FilterKey; value: string; onChange: (value: string) => void }) {
  return <label>{labels[name]}<select value={value} onChange={(event) => onChange(event.target.value)} className="block w-full border-b bg-white py-2">{options[name].map((option) => <option key={option}>{option}</option>)}</select></label>
}
