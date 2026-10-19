"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronRight, ChevronUp } from "lucide-react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportFilterPanel, ReportGridTable, ReportMetricRow, ReportModeButtons, ReportPage, ReportPager, ReportSearchField, ReportSelectField, ReportTopRow } from "@/components/ref/report-kit"
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
  const [warehouse, setWarehouse] = useState("")
  const [type, setType] = useState("")
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
      const matchesWarehouse = warehouse === "" || row.warehouse === warehouse
      const matchesType = type === "" || row.type === type
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

  const modeLabels = ["КОЛ-ВО", "СЕБЕСТОИМОСТЬ", "ПРАЙС ЛИСТ"]
  const modeLabel = mode === "quantity" ? modeLabels[0] : mode === "cost" ? modeLabels[1] : modeLabels[2]
  const rangeLabel = `${filtered.length ? (safePage - 1) * pageSize + 1 : 0} - ${Math.min(safePage * pageSize, filtered.length)} из ${filtered.length}`
  const warehouses = Array.from(new Set(rows.map((row) => row.warehouse)))
  const types = Array.from(new Set(rows.map((row) => row.type)))

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title="Остаток" /></div>

      <section className="border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]">
        <div className="px-[30px]">
          <ReportTopRow
            filterLabel="Фильтр"
            scope={warehouse || type ? [warehouse, type].filter(Boolean).join(" · ") : "Во всей организации"}
            onFilter={() => setShowFilter(true)}
            onDownload={() => downloadExcel(filtered)}
          />
          <ReportMetricRow
            items={[
              { label: "Общая сумма", value: `${formatNumber(total)} шт` },
              { label: "Сумма забронированных", value: `${formatNumber(reserved)} шт` },
              { label: "В пути", value: `${formatNumber(transit)} шт` },
              { label: "Сумма доступных", value: `${formatNumber(total - reserved)} шт` },
            ]}
          />
          <div className="mt-[12px] flex items-end gap-[20px] pb-[14px]">
            <ReportModeButtons labels={modeLabels} value={modeLabel} onChange={(label) => setMode(label === modeLabels[0] ? "quantity" : label === modeLabels[1] ? "cost" : "price")} />
            <div className="ml-auto flex items-end gap-[27px]">
              <ReportSearchField value={search} onChange={(value) => { setSearch(value); setPage(1) }} width={280} />
              <div className="w-[200px]"><ReportSelectField label="Показать" value={display} onChange={setDisplay} options={["Количество", "Доступно", "Забронировано"]} /></div>
              <div className="pb-[4px]">
                <ReportPager pageSize={pageSize} onPageSize={(size) => { setPageSize(size); setPage(1) }} rangeLabel={rangeLabel} canPrev={safePage > 1} canNext={safePage < maxPage} onPrev={() => setPage((value) => Math.max(1, value - 1))} onNext={() => setPage((value) => Math.min(maxPage, value + 1))} />
              </div>
            </div>
          </div>
        </div>
        <div className="px-[30px]">
          <ReportGridTable
            loading={loading}
            minWidth={1050}
            heads={["Продукт", "Артикул", "Тип товара", "Всего", "Забронировано", "В пути", "Доступно"]}
            rows={visible.map((row) => {
              const open = expanded === row.product
              return [
                <span key="p"><button aria-label={`${row.product} tafsilotlari`} onClick={() => setExpanded(open ? null : row.product)} className="flex items-center gap-2 text-left">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronRight className="h-4 w-4 fill-current" />} {row.product}</button>
                  {open && <span className="mt-2 grid gap-1 text-[12px] text-[#555]"><span><b>Организация:</b> {row.organization}</span><span><b>Себестоимость:</b> {formatNumber(row.cost)} SUM</span><span><b>Прайс-лист:</b> {formatNumber(row.price)} SUM</span><span><b>Мин. остаток:</b> {row.minStock}</span></span>}</span>,
                row.article,
                row.type,
                <b key="t">{value(row, "total")}</b>,
                <span key="r" className="font-semibold text-[#049bea]">{value(row, "reserved")}</span>,
                <span key="tr" className="font-semibold text-[#ff9d18]">{value(row, "transit")}</span>,
                value(row, "available"),
              ]
            })}
          />
        </div>
      </section>

      {showFilter && (
        <ReportFilterPanel onClose={() => setShowFilter(false)} onApply={applyFilter}>
          <ReportSelectField label="Склад" value={warehouse} onChange={setWarehouse} options={warehouses} />
          <ReportSelectField label="Тип товара" value={type} onChange={setType} options={types} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}
