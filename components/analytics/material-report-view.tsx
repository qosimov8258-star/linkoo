"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportCheckboxField, ReportFilterPanel, ReportGridTable, ReportModeButtons, ReportPage, ReportPager, ReportRangeField, ReportSearchField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
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
  // "Организация": this company's organizations (Настройки → Организация).
  const [organizations, setOrganizations] = useState<string[]>([])
  useEffect(() => {
    let cancelled = false
    fetch("/api/organizations")
      .then((response) => (response.ok ? (response.json() as Promise<Array<{ name?: unknown }>>) : []))
      .then((list) => {
        if (!cancelled && Array.isArray(list)) setOrganizations([...new Set(list.map((item) => String(item.name ?? "").trim()).filter(Boolean))])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
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
  const [rangeFrom, setRangeFrom] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01` })
  const [rangeTo, setRangeTo] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` })

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

  const sortHead = (label: string, key: SortKey) => (
    <button type="button" onClick={() => toggleSort(key)} className="inline-flex items-center justify-center gap-1 font-semibold">
      {t(label)}
      <span className={`text-[10px] ${sortKey === key ? "text-[#4f71dc]" : "text-transparent"}`}>{sortDir === "asc" ? "▲" : "▼"}</span>
    </button>
  )
  const sel = (label: string, value: string, setter: (value: string) => void, allLabel: string, options: string[]) => (
    <ReportSelectField label={label} value={value === allLabel ? "" : value} onChange={(next) => { setter(next || allLabel); setPage(1) }} options={options} clearable={false} />
  )
  const unique = (pick: (row: MaterialRow) => string) => [...new Set(rows.map(pick).filter((value) => value && value !== "__remainder__"))]
  const closingKey = [...groups.map(([key]) => key), "closing"] as GroupKey[]
  const groupTitles = [...groups.map(([, title]) => title), "Остаток на конец"]
  const per = columnMode === "both" ? 2 : 1
  const heads = [
    sortHead(groupingColumnLabel[grouping], "label"),
    ...closingKey.flatMap((key) =>
      columnMode === "both"
        ? [sortHead("Кол-во", `${key}.qty`), sortHead("Стоимость", `${key}.value`)]
        : [sortHead(columnMode === "qty" ? "Кол-во" : "Стоимость", `${key}.${columnMode === "qty" ? "qty" : "value"}`)],
    ),
  ]

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Остаток на определенную дату")} /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="px-[30px]">
          <ReportTopRow filterLabel={t("Фильтр")} scope={t("Во всей организации")} onFilter={() => setFilterOpen(true)} onDownload={doExport} />

          <div className="mt-[10px] grid gap-x-[20px] gap-y-[8px] border-b border-[#e8e8e8] pb-[12px] text-[13px] md:grid-cols-5">
            {[
              [["Остаток на начало периода", summaryTotals.opening], ["Остаток на конец периода", summaryTotals.closing]],
              [["Поставки за период", summaryTotals.supplies], ["Возврат по поставкам за период", summaryTotals.supplyReturns]],
              [["Прочие приходы на склад", summaryTotals.otherIncome], ["Прочие расходы на склад", summaryTotals.otherExpense]],
              [["Выдано по заказу", summaryTotals.issued], ["Возврат", summaryTotals.returns]],
              [["Списано за период", summaryTotals.writtenOff]],
            ].map((column, index) => (
              <div key={index} className={`space-y-[8px] ${index === 4 ? "md:text-right" : ""}`}>
                {(column as [string, Metric][]).map(([label, metric]) => (
                  <div key={label}><p className="leading-4 text-[#555]">{t(label)}</p><p className="mt-[1px] text-[15px] font-bold leading-[18px]">{summaryValue(metric)}</p></div>
                ))}
              </div>
            ))}
          </div>

          <div className="mt-[14px] flex items-end gap-[20px] pb-[10px]">
            <ReportModeButtons labels={["КОЛ-ВО", "СЕБЕСТОИМОСТЬ", "ПРАЙС ЛИСТ"]} value={mode === "quantity" ? "КОЛ-ВО" : mode === "cost" ? "СЕБЕСТОИМОСТЬ" : "ПРАЙС ЛИСТ"} onChange={(label) => setMode(label === "КОЛ-ВО" ? "quantity" : label === "СЕБЕСТОИМОСТЬ" ? "cost" : "price")} />
            {mode === "price" && (
              <div className="relative self-center">
                <button type="button" onClick={() => setPriceListOpen((value) => !value)} className="flex items-center gap-1 text-[13px] font-bold">{t(priceList)} <ChevronDown className={`h-4 w-4 text-[#788294] transition-transform ${priceListOpen ? "rotate-180" : ""}`} /></button>
                {priceListOpen && (
                  <div className="absolute left-0 top-full z-20 w-64 border border-[#e8e8e8] bg-white py-1 shadow-xl">
                    {["Основной прайс-лист", "Прайс-лист для сети", "Прайс-лист опт"].map((item) => (
                      <button key={item} type="button" onClick={() => { setPriceList(item); setPriceListOpen(false) }} className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#f2f5f8]">{t(item)}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="ml-auto flex items-end gap-[20px]">
              <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={200} />
              <div className="w-[200px]"><ReportSelectField label="Группировка" value={grouping} onChange={(value) => { setGrouping(value || "По продукту"); setPage(1) }} options={["По продукту", "По типу товара", "По бренду"]} /></div>
              <div className="w-[200px]"><ReportSelectField label="Показать" value={display} onChange={(value) => setDisplay(value || "Количество")} options={["Количество", "Стоимость", "Количество и стоимость"]} /></div>
              <div className="flex items-center gap-[20px] pb-[4px]">
                <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={`${rangeStart} - ${rangeEnd} ${t("из")} ${totalLabel}`} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
                <button aria-label={t("Полный экран")} onClick={() => document.documentElement.requestFullscreen?.()}><svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#444]"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" /></svg></button>
              </div>
            </div>
          </div>
        </div>

        <ReportGridTable
          minWidth={2450}
          colWidths={["300px"]}
          emptyText={t("Нет данных")}
          groups={[{ title: "", span: 1 }, ...groupTitles.map((title) => ({ title: t(title), span: per }))]}
          heads={heads}
          rows={visible.map((row) => {
            const metrics = [...groups.map(([key]) => row.metrics[key]), row.metrics.closing]
            return [
              <div key="n"><div>{row.label}{grouping !== "По продукту" && <span className="ml-1 text-[11px] text-[#999]">({row.count})</span>}</div>{grouping === "По продукту" && row.article && <div className="font-semibold text-[#50ca78]">{row.article}</div>}</div>,
              ...metrics.flatMap((metric, metricIndex) =>
                columnMode === "both"
                  ? [<span key={`${metricIndex}-q`} className={metricIndex > 0 && metricIndex < 6 ? "text-[#009bea]" : ""}>{number(metric.qty)}</span>, number(metric.value)]
                  : [<span key={metricIndex} className={metricIndex > 0 && metricIndex < 6 ? "text-[#009bea]" : ""}>{number(columnMode === "qty" ? metric.qty : metric.value)}</span>],
              ),
            ]
          })}
        />
      </section>

      {filterOpen && (
        <ReportFilterPanel onClose={() => setFilterOpen(false)} onApply={() => { setPage(1); setFilterOpen(false) }}>
          <ReportRangeField label="Диапазон дат" from={rangeFrom} to={rangeTo} onFrom={setRangeFrom} onTo={setRangeTo} />
          {sel("Филиалы", branch, setBranch, "Все филиалы", unique((row) => row.branch))}
          {sel("Организация", organization, setOrganization, "Все организации", organizations)}
          {sel("Склад", warehouse, setWarehouse, "Все склады", unique((row) => row.warehouse))}
          {sel("Тип продукта", type, setType, "Все типы", unique((row) => row.type))}
          {sel("Бренд", brand, setBrand, "Все бренды", unique((row) => row.brand))}
          {sel("Движение за период", movement, setMovement, "Все движения", ["Приход", "Расход"])}
          {sel("Остаток за период", stockFilter, setStockFilter, "Все остатки", ["Положительный", "Нулевой"])}
          <ReportCheckboxField label="Показать прочие" checked={showOther} onChange={(value) => { setShowOther(value); setPage(1) }} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
