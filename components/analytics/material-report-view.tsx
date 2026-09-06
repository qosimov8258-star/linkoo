"use client"

import { useMemo, useState } from "react"
import { BarChart, ChevronDown, ChevronLeft, ChevronRight, Expand, Filter, Search, X } from "lucide-react"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

type Mode = "quantity" | "cost" | "price"
type Metric = { qty: number; value: number }
type MaterialRow = {
  product: string
  article: string
  type: string
  brand: string
  branch: string
  warehouse: string
  opening: Metric
  supplies: Metric
  supplyReturns: Metric
  returns: Metric
  issued: Metric
  writtenOff: Metric
  otherIncome: Metric
  otherExpense: Metric
}

const rows: MaterialRow[] = []

const otherRows: MaterialRow[] = []

const groupingColumnLabel: Record<string, string> = {
  "По продукту": "Товар",
  "По типу товара": "Тип товара",
  "По бренду": "Бренд",
}

const groups = [
  ["opening", "Остаток на начало периода"],
  ["supplies", "Поставки за период"],
  ["supplyReturns", "Возврат по поставкам за период"],
  ["returns", "Возврат"],
  ["issued", "Выдано по заказу"],
  ["writtenOff", "Списано за период"],
  ["otherIncome", "Прочий приход"],
  ["otherExpense", "Прочий расход"],
] as const

type GroupKey = (typeof groups)[number][0] | "closing"
type SortKey = "label" | `${GroupKey}.qty` | `${GroupKey}.value`
type SortDir = "asc" | "desc"

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)
const emptyMetric: Metric = { qty: 0, value: 0 }
const closing = (row: MaterialRow): Metric => ({
  qty: row.opening.qty + row.supplies.qty - row.supplyReturns.qty + row.returns.qty - row.issued.qty - row.writtenOff.qty + row.otherIncome.qty - row.otherExpense.qty,
  value: row.opening.value + row.supplies.value - row.supplyReturns.value + row.returns.value - row.issued.value - row.writtenOff.value + row.otherIncome.value - row.otherExpense.value,
})
const addMetric = (a: Metric, b: Metric): Metric => ({ qty: a.qty + b.qty, value: a.value + b.value })

const FIXED_DEFAULT_TOTALS: Record<GroupKey, Metric> = {
  opening: { qty: 0, value: 0 },
  supplies: { qty: 0, value: 0 },
  supplyReturns: { qty: 0, value: 0 },
  returns: { qty: 0, value: 0 },
  issued: { qty: 0, value: 0 },
  writtenOff: { qty: 0, value: 0 },
  otherIncome: { qty: 0, value: 0 },
  otherExpense: { qty: 0, value: 0 },
  closing: { qty: 0, value: 0 },
}

const TOTAL_PRODUCTS = 0

type GroupedRow = { key: string; label: string; article: string; metrics: Record<GroupKey, Metric>; count: number }

function exportExcel(fileName: string, columns: string[], data: (string | number)[][]) {
  downloadExcelTable(fileName, [columns, ...data])
}

function SortableHeader({ label, sortKey, active, dir, onSort, className = "" }: { label: string; sortKey: SortKey; active: boolean; dir: SortDir; onSort: (key: SortKey) => void; className?: string }) {
  const { t } = useLanguage()
  return (
    <th
      role="button"
      tabIndex={0}
      onClick={() => onSort(sortKey)}
      onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSort(sortKey) } }}
      className={`cursor-pointer select-none border px-2 py-2 hover:bg-[#e4eaf3] ${className}`}
    >
      <span className="inline-flex items-center gap-1">
        {t(label)}
        <span className={`text-[10px] ${active ? "text-[#4f70e7]" : "text-transparent"}`}>{dir === "asc" ? "▲" : "▼"}</span>
      </span>
    </th>
  )
}

const STATIC_FILTER_OPTIONS = new Set([
  "Все филиалы", "Все склады", "Все типы", "Все бренды", "Все организации", "Все движения", "Все остатки",
  "Приход", "Расход", "Положительный", "Нулевой",
])

export function MaterialReportView() {
  const { t } = useLanguage()
  const [mode, setMode] = useState<Mode>("cost")
  const [search, setSearch] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [branch, setBranch] = useState("Все филиалы")
  const [warehouse, setWarehouse] = useState("Все склады")
  const [type, setType] = useState("Все типы")
  const [brand, setBrand] = useState("Все бренды")
  const [organization, setOrganization] = useState("Все организации")
  const [movement, setMovement] = useState("Все движения")
  const [stockFilter, setStockFilter] = useState("Все остатки")
  const [priceList, setPriceList] = useState("Основной прайс-лист")
  const [priceListOpen, setPriceListOpen] = useState(false)
  const [showOther, setShowOther] = useState(false)
  const [grouping, setGrouping] = useState("По продукту")
  const [display, setDisplay] = useState("Количество")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const hasIncoming = (row: MaterialRow) => row.supplies.qty > 0 || row.otherIncome.qty > 0 || row.returns.qty > 0
  const hasOutgoing = (row: MaterialRow) => row.issued.qty > 0 || row.writtenOff.qty > 0 || row.otherExpense.qty > 0 || row.supplyReturns.qty > 0

  // 1) Филтрлаш — жамланма summary-карталар ҳам, жадвал ҳам шу натижадан фойдаланади.
  const filtered = useMemo(() => {
    const source = showOther ? [...rows, ...otherRows] : rows
    const needle = search.trim().toLocaleLowerCase("ru")
    return source.filter((row) => {
      if (needle && !`${row.product} ${row.article}`.toLocaleLowerCase("ru").includes(needle)) return false
      if (branch !== "Все филиалы" && row.branch !== branch) return false
      if (warehouse !== "Все склады" && row.warehouse !== warehouse) return false
      if (type !== "Все типы" && row.type !== type) return false
      if (brand !== "Все бренды" && row.brand !== brand) return false
      if (movement === "Приход" && !hasIncoming(row)) return false
      if (movement === "Расход" && !hasOutgoing(row)) return false
      if (stockFilter === "Положительный" && closing(row).qty <= 0) return false
      if (stockFilter === "Нулевой" && closing(row).qty !== 0) return false
      return true
    })
  }, [branch, brand, movement, search, showOther, stockFilter, type, warehouse])

  // 2) Жамланма summary — филтрланган маълумотдан ҳисобланади; ҳеч қандай филтр қўлланмаса,
  //    тизимдаги аниқ рақамлар билан бир хил бўлади (юқоридаги remainderRow шунга хизмат қилади).
  const isDefaultView = !search && branch === "Все филиалы" && warehouse === "Все склады" && type === "Все типы" && brand === "Все бренды" && movement === "Все движения" && stockFilter === "Все остатки" && !showOther

  const summaryTotals = useMemo(() => {
    if (isDefaultView) return FIXED_DEFAULT_TOTALS
    const sums = {} as Record<GroupKey, Metric>
    for (const [key] of groups) sums[key] = filtered.reduce((acc, row) => addMetric(acc, row[key]), emptyMetric)
    sums.closing = filtered.reduce((acc, row) => addMetric(acc, closing(row)), emptyMetric)
    return sums
  }, [filtered, isDefaultView])

  // 3) Кўринадиган қаторлар — йиғма (remainder) ва "яширин прочие" псевдо-қатор жадвалда чиқмайди.
  const visibleFiltered = useMemo(() => filtered.filter((row) => row.product !== ""), [filtered])

  // 4) Группировка — маҳсулот бўйича бўлмаса, қаторлар турга/брендга кўра жамланади.
  const groupedRows: GroupedRow[] = useMemo(() => {
    if (grouping === "По продукту") {
      return visibleFiltered.map((row) => {
        const metrics = {} as Record<GroupKey, Metric>
        for (const [key] of groups) metrics[key] = row[key]
        metrics.closing = closing(row)
        return { key: `${row.product}-${row.article}`, label: row.product, article: row.article, metrics, count: 1 }
      })
    }
    const keyOf = (row: MaterialRow) => (grouping === "По типу товара" ? row.type : row.brand)
    const map = new Map<string, GroupedRow>()
    for (const row of visibleFiltered) {
      const label = keyOf(row)
      const existing = map.get(label)
      const rowMetrics = {} as Record<GroupKey, Metric>
      for (const [key] of groups) rowMetrics[key] = row[key]
      rowMetrics.closing = closing(row)
      if (!existing) {
        map.set(label, { key: label, label, article: "", metrics: rowMetrics, count: 1 })
      } else {
        const merged = {} as Record<GroupKey, Metric>
        for (const [key] of groups) merged[key] = addMetric(existing.metrics[key], rowMetrics[key])
        merged.closing = addMetric(existing.metrics.closing, rowMetrics.closing)
        map.set(label, { ...existing, metrics: merged, count: existing.count + 1 })
      }
    }
    return [...map.values()]
  }, [grouping, visibleFiltered])

  // 5) Саралаш — сортKey бўш бўлса, қаторлар табиий тартибда қолади (расмдагидек).
  const sortedRows = useMemo(() => {
    if (!sortKey) return groupedRows
    const activeSortKey = sortKey
    const copy = [...groupedRows]
    copy.sort((a, b) => {
      let result = 0
      if (activeSortKey === "label") {
        result = a.label.localeCompare(b.label, "ru")
      } else {
        const [metricKey, field] = activeSortKey.split(".") as [GroupKey, "qty" | "value"]
        result = a.metrics[metricKey][field] - b.metrics[metricKey][field]
      }
      return sortDir === "asc" ? result : -result
    })
    return copy
  }, [groupedRows, sortDir, sortKey])

  const toggleSort = (key: SortKey) => {
    setPage(1)
    if (sortKey === key) {
      setSortDir((direction) => (direction === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("asc")
    }
  }

  const maxPage = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const safePage = Math.min(page, maxPage)
  const visible = sortedRows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const rangeStart = sortedRows.length ? (safePage - 1) * pageSize + 1 : 0
  const rangeEnd = isDefaultView ? Math.min(safePage * pageSize, TOTAL_PRODUCTS) : Math.min(safePage * pageSize, sortedRows.length)
  const totalLabel = isDefaultView ? TOTAL_PRODUCTS : sortedRows.length

  // Показать: сичқонча табларидан мустақил, фойдаланувчи ўзи ўзгартирса устунларни мажбурлайди.
  const columnMode: "qty" | "value" | "both" =
    display === "Количество и стоимость" ? "both" : display === "Стоимость" ? "value" : mode === "quantity" ? "qty" : "both"

  const summaryValue = (metric: Metric) =>
    mode === "quantity" ? `${number(metric.qty)} ${t("шт")}` : `${number(mode === "cost" ? metric.value : 0)} SUM (${number(metric.qty)} ${t("шт")})`

  const resetFilters = () => {
    setBranch("Все филиалы"); setWarehouse("Все склады"); setType("Все типы"); setBrand("Все бренды")
    setOrganization("Все организации"); setMovement("Все движения"); setStockFilter("Все остатки")
    setPage(1)
  }

  const doExport = () => {
    const columnTitles = groups.flatMap(([, title]) => columnMode === "both" ? [`${t(title)} ${t("Кол-во")}`, `${t(title)} ${t("Стоимость")}`] : [`${t(title)} ${columnMode === "qty" ? t("Кол-во") : t("Стоимость")}`])
    const closingTitles = columnMode === "both" ? [`${t("Остаток на конец")} ${t("Кол-во")}`, `${t("Остаток на конец")} ${t("Стоимость")}`] : [`${t("Остаток на конец")} ${columnMode === "qty" ? t("Кол-во") : t("Стоимость")}`]
    const header = [t(groupingColumnLabel[grouping]), ...(grouping === "По продукту" ? [t("Артикул")] : []), ...columnTitles, ...closingTitles]
    const body = sortedRows.map((row) => [
      row.label,
      ...(grouping === "По продукту" ? [row.article] : []),
      ...groups.flatMap(([key]) => columnMode === "both" ? [row.metrics[key].qty, row.metrics[key].value] : [columnMode === "qty" ? row.metrics[key].qty : row.metrics[key].value]),
      ...(columnMode === "both" ? [row.metrics.closing.qty, row.metrics.closing.value] : [columnMode === "qty" ? row.metrics.closing.qty : row.metrics.closing.value]),
    ])
    exportExcel("material-report.xls", header, body)
  }

  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#15223a]">
      <header className="flex min-h-[78px] items-center border-b border-[#d8dee7] bg-[#f4f6f9] px-5 md:px-10">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" /><span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Остаток на определенную дату")}</span>
        </div>
      </header>

      <section className="bg-white px-5 py-6 md:px-10">
        <div className="flex gap-4">
          <button onClick={() => setFilterOpen(true)} className="flex h-11 items-center gap-3 rounded-md bg-[#4f70df] px-5 font-semibold text-white"><Filter className="h-5 w-5" /> {t("Фильтр")}</button>
          <button onClick={resetFilters} className="font-semibold text-[#4f70e7]">{t("Во всей организации")}</button>
          <button onClick={doExport} className="ml-auto flex h-11 items-center gap-3 rounded-md bg-[#69cd87] px-5 font-semibold text-white"><BarChart className="h-5 w-5" /> {t("Скачать")}</button>
        </div>

        <div className="mt-7 grid gap-x-8 gap-y-3 border-b border-[#e1e5eb] pb-8 md:grid-cols-5">
          <div><p className="text-[#6c7481]">{t("Остаток на начало периода")}</p><b className="text-lg">{summaryValue(summaryTotals.opening)}</b><p className="mt-2 text-[#6c7481]">{t("Остаток на конец периода")}</p><b className="text-lg">{summaryValue(summaryTotals.closing)}</b></div>
          <div><p className="text-[#6c7481]">{t("Поставки за период")}</p><b className="text-lg">{summaryValue(summaryTotals.supplies)}</b><p className="mt-2 text-[#6c7481]">{t("Возврат по поставкам за период")}</p><b className="text-lg">{summaryValue(summaryTotals.supplyReturns)}</b></div>
          <div><p className="text-[#6c7481]">{t("Прочие приходы на склад")}</p><b className="text-lg">{summaryValue(summaryTotals.otherIncome)}</b><p className="mt-2 text-[#6c7481]">{t("Прочие расходы на склад")}</p><b className="text-lg">{summaryValue(summaryTotals.otherExpense)}</b></div>
          <div><p className="text-[#6c7481]">{t("Выдано по заказу")}</p><b className="text-lg">{summaryValue(summaryTotals.issued)}</b><p className="mt-2 text-[#6c7481]">{t("Возврат")}</p><b className="text-lg">{summaryValue(summaryTotals.returns)}</b></div>
          <div className="md:text-right"><p className="text-[#6c7481]">{t("Списано за период")}</p><b className="text-lg">{summaryValue(summaryTotals.writtenOff)}</b></div>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-4">
          <div className="flex">
            {([["quantity", "КОЛ-ВО"], ["cost", "СЕБЕСТОИМОСТЬ"], ["price", "ПРАЙС ЛИСТ"]] as const).map(([key, label]) => <button key={key} onClick={() => setMode(key)} className={`h-10 border px-5 ${mode === key ? "border-[#4f70e7] bg-[#4f70e7] text-white shadow" : "border-[#d8dde5] bg-white text-black"} first:rounded-l-md last:rounded-r-md`}>{t(label)}</button>)}
          </div>
          {mode === "price" && (
            <div className="relative self-center">
              <button type="button" onClick={() => setPriceListOpen((value) => !value)} className="flex items-center gap-1 font-bold text-[#15223a]">
                {t(priceList)} <ChevronDown className={`h-4 w-4 text-[#788294] transition-transform ${priceListOpen ? "rotate-180" : ""}`} />
              </button>
              {priceListOpen && (
                <div className="absolute left-0 top-full z-20 w-64 border border-[#e1e5eb] bg-white py-1 shadow-xl">
                  {["Основной прайс-лист", "Прайс-лист для сети", "Прайс-лист опт"].map((item) => (
                    <button key={item} type="button" onClick={() => { setPriceList(item); setPriceListOpen(false) }} className="block w-full px-3 py-2 text-left text-sm hover:bg-slate-50">
                      {t(item)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <label className="relative min-w-[250px] flex-1"><span className="font-semibold">{t("Поиск")}</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1) }} className="mt-1 h-10 w-full border-b border-[#ccd3dc] bg-transparent pr-9 outline-none" /><Search className="absolute bottom-2 right-1 h-5 w-5 text-[#788294]" /></label>
          <label className="text-xs">{t("Группировка")}<select value={grouping} onChange={(event) => { setGrouping(event.target.value); setPage(1) }} className="mt-1 block h-10 min-w-[250px] border-b border-[#ccd3dc] bg-white text-base font-semibold"><option value="По продукту">{t("По продукту")}</option><option value="По типу товара">{t("По типу товара")}</option><option value="По бренду">{t("По бренду")}</option></select></label>
          <label className="text-xs">{t("Показать")}<select value={display} onChange={(event) => setDisplay(event.target.value)} className="mt-1 block h-10 min-w-[250px] border-b border-[#ccd3dc] bg-white text-base font-semibold"><option value="Количество">{t("Количество")}</option><option value="Стоимость">{t("Стоимость")}</option><option value="Количество и стоимость">{t("Количество и стоимость")}</option></select></label>
          <select aria-label={t("Количество строк")} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1) }} className="h-10 bg-white"><option>10</option><option>25</option><option>50</option></select>
          <span className="pb-2 text-[#667085]">{rangeStart} - {rangeEnd} {t("из")} {totalLabel}</span>
          <button aria-label={t("Предыдущая страница")} disabled={safePage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="mb-1 rounded-full border-2 p-1 disabled:opacity-30"><ChevronLeft /></button>
          <button aria-label={t("Следующая страница")} disabled={safePage === maxPage} onClick={() => setPage((value) => Math.min(maxPage, value + 1))} className="mb-1 rounded-full border-2 p-1 disabled:opacity-30"><ChevronRight /></button>
          <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()} className="mb-1 p-1"><Expand /></button>
        </div>
      </section>

      <section className="overflow-auto bg-white px-5 pb-8 md:px-10">
        <table className="min-w-[2450px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-[#edf2f7] text-[#253653] shadow">
            <tr><th className="w-[320px] border px-2 py-2"></th>{groups.map(([, title]) => <th key={title} colSpan={columnMode === "both" ? 2 : 1} className="border px-2 py-2 text-center text-base">{t(title)}</th>)}<th colSpan={columnMode === "both" ? 2 : 1} className="border px-2 py-2 text-center text-base">{t("Остаток на конец")}</th></tr>
            <tr>
              <SortableHeader label={groupingColumnLabel[grouping]} sortKey="label" active={sortKey === "label"} dir={sortDir} onSort={toggleSort} className="text-center text-base" />
              {[...groups, ["closing", ""] as const].flatMap(([key]) =>
                columnMode === "both"
                  ? [
                      <SortableHeader key={`${key}-q`} label="Кол-во" sortKey={`${key}.qty`} active={sortKey === `${key}.qty`} dir={sortDir} onSort={toggleSort} />,
                      <SortableHeader key={`${key}-v`} label="Стоимость" sortKey={`${key}.value`} active={sortKey === `${key}.value`} dir={sortDir} onSort={toggleSort} />,
                    ]
                  : [<SortableHeader key={key} label={columnMode === "qty" ? "Кол-во" : "Стоимость"} sortKey={`${key}.${columnMode === "qty" ? "qty" : "value"}`} active={sortKey === `${key}.${columnMode === "qty" ? "qty" : "value"}`} dir={sortDir} onSort={toggleSort} />],
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => {
              const metrics = [...groups.map(([key]) => row.metrics[key]), row.metrics.closing]
              return <tr key={row.key} className={index % 2 ? "bg-[#f0f5fa]" : "bg-white"}>
                <td className="border border-[#e1e5e9] px-2 py-2 text-base">
                  <div>{row.label}{grouping !== "По продукту" && <span className="ml-1 text-xs text-[#9aa3b6]">({row.count})</span>}</div>
                  {grouping === "По продукту" && row.article && <div className="font-semibold text-[#50ca78]">{row.article}</div>}
                </td>
                {metrics.flatMap((metric, metricIndex) => columnMode === "both"
                  ? [<td key={`${metricIndex}-q`} className={`border px-2 py-2 ${metricIndex > 0 && metricIndex < 6 ? "text-[#009bea]" : ""}`}>{number(metric.qty)}</td>, <td key={`${metricIndex}-v`} className="border px-2 py-2">{number(metric.value)}</td>]
                  : [<td key={metricIndex} className={`border px-2 py-2 ${metricIndex > 0 && metricIndex < 6 ? "text-[#009bea]" : ""}`}>{number(columnMode === "qty" ? metric.qty : metric.value)}</td>])}
              </tr>
            })}
            {visible.length === 0 && (
              <tr><td colSpan={99} className="border px-2 py-10 text-center text-[#8a93a6]">{t("Ничего не найдено по заданным фильтрам")}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {filterOpen && <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 p-4 pt-20" role="dialog" aria-modal="true">
        <div className="w-full max-w-[1820px] bg-white p-8 shadow-2xl">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">{t("ФИЛЬТР")}</h2><button aria-label={t("Закрыть")} onClick={() => setFilterOpen(false)}><X /></button></div>
          <div className="mt-8 grid gap-x-5 gap-y-8 md:grid-cols-4">
            <label className="font-semibold">{t("Диапазон дат")}<input type="text" defaultValue={t("01 июля 2026 - 31 июля 2026")} className="mt-2 h-11 w-full border-b outline-none" /></label>
            {(
              [
                ["Филиалы", branch, setBranch, ["Все филиалы", ...new Set(rows.map((row) => row.branch).filter((value) => value && value !== "__remainder__"))]],
                ["Организация", organization, setOrganization, ["Все организации", "Linko"]],
                ["Склад", warehouse, setWarehouse, ["Все склады", ...new Set(rows.map((row) => row.warehouse).filter((value) => value && value !== "__remainder__"))]],
                ["Тип продукта", type, setType, ["Все типы", ...new Set(rows.map((row) => row.type).filter((value) => value && value !== "__remainder__"))]],
                ["Бренд", brand, setBrand, ["Все бренды", ...new Set(rows.map((row) => row.brand).filter((value) => value && value !== "__remainder__"))]],
                ["Движение за период", movement, setMovement, ["Все движения", "Приход", "Расход"]],
                ["Остаток за период", stockFilter, setStockFilter, ["Все остатки", "Положительный", "Нулевой"]],
              ] as const
            ).map(([label, value, setter, options]) => <label key={label} className="font-semibold">{t(label)}<span className="relative mt-2 block"><select value={value} onChange={(event) => { setter(event.target.value); setPage(1) }} className="h-11 w-full appearance-none border-b bg-white pr-7 outline-none">{options.map((option) => <option key={option} value={option}>{STATIC_FILTER_OPTIONS.has(option) ? t(option) : option}</option>)}</select><ChevronDown className="pointer-events-none absolute right-1 top-3 h-4 w-4 text-[#9ca3af]" /></span></label>)}
          </div>
          <label className="mt-6 flex items-center gap-3 font-semibold"><input type="checkbox" checked={showOther} onChange={(event) => { setShowOther(event.target.checked); setPage(1) }} className="h-5 w-5" /> {t("Показать прочие")}</label>
          <button onClick={() => { setPage(1); setFilterOpen(false) }} className="mt-5 h-12 w-full rounded bg-[#69cd87] font-bold text-white">{t("Применить")}</button>
        </div>
      </div>}
    </main>
  )
}
