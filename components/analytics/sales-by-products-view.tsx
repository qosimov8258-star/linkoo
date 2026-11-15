"use client"

import { useEffect, useMemo, useState } from "react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportCheckboxField, ReportFilterPanel, ReportPage, ReportRangeField, ReportSearchBar, ReportSegmentTabs, ReportSelectField, ReportSummaryCard, ReportTopRow } from "@/components/ref/report-kit"
import { csvText } from "@/lib/csv"
import { inAppCurrency, useAppCurrencyInfo } from "@/lib/app-currency-context"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { addLine, EMPTY_SALES_FILTERS, emptyTotals, profitOf, reportNumber, selectSalesLines, type SalesLine, type SalesLineFilters, type SalesLines, type SalesTotals } from "@/lib/sales-lines-types"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { ORDER_STATUSES } from "@/components/orders/orders-data"

// Прибыль от товаров (Linko's #/statistics/product, stats/products), from GET /api/sales-lines. The filter's tabs
// choose the period: «Передачи со склада» (the menu's default, Linko's periodType=secondPeriod: the lines
// transferred from the warehouse in it) or «Период создания». «ПРОДАЖА ПО ТОВАРАМ С ПРИБЫЛЬЮ» adds the
// «Прибыль от продаж» card. Rows are grouped by product, brand or product type («Группировка»); every filter of
// the panel applies on «Применить».

type ProductRow = SalesTotals & { name: string; unit: string }
type PeriodMode = "created" | "warehouse"

const GROUPS = ["По продукту", "По бренду", "По типу продукта"] as const

/** The key and the unit of a line's row in the chosen grouping. */
function groupOf(line: SalesLine, group: string): { name: string; unit: string } {
  if (group === "По бренду") return { name: line.brand || "Не указано", unit: "" }
  if (group === "По типу продукта") return { name: line.productType || "Не указано", unit: "" }
  return { name: line.productName || "—", unit: line.unit || "шт." }
}

// Filter choices come from the factory's own directories (never another tenant's names).
const DIRECTORY_OF = {
  branch: "branches",
  brand: "brands",
  organization: "organizations",
  productType: "productTypes",
  client: "clients",
  agent: "employees",
  clientType: "clientTypes",
  warehouse: "warehouses",
} as const

type FilterKey = Exclude<keyof SalesLineFilters, "belowCost">
const FILTER_KEYS: FilterKey[] = ["branch", "brand", "organization", "productType", "status", "client", "agent", "clientType", "warehouse"]
const labels: Record<FilterKey, string> = { branch: "Филиалы", brand: "Бренд", organization: "Организация", productType: "Тип товара", status: "Статус", client: "Клиент", agent: "Агент", clientType: "Тип клиента", warehouse: "Склад" }

type Draft = SalesLineFilters & { mode: PeriodMode; from: string; to: string; bonus: boolean }

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function SalesByProductsView() {
  const { t } = useLanguage()
  const directories: Record<keyof typeof DIRECTORY_OF, string[]> = {
    branch: useDirectoryNames(DIRECTORY_OF.branch),
    brand: useDirectoryNames(DIRECTORY_OF.brand),
    organization: useDirectoryNames(DIRECTORY_OF.organization),
    productType: useDirectoryNames(DIRECTORY_OF.productType),
    client: useDirectoryNames(DIRECTORY_OF.client),
    agent: useDirectoryNames(DIRECTORY_OF.agent),
    clientType: useDirectoryNames(DIRECTORY_OF.clientType),
    warehouse: useDirectoryNames(DIRECTORY_OF.warehouse),
  }
  const initial = useMemo<Draft>(() => {
    const now = new Date()
    return { ...EMPTY_SALES_FILTERS, mode: "warehouse", from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now), bonus: false }
  }, [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [query, setQuery] = useState("")
  const [reportMode, setReportMode] = useState<"created" | "profit">("created")
  const [group, setGroup] = useState<string>("По продукту")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<Draft>(initial)
  const [applied, setApplied] = useState<Draft>(initial)

  const [data, setData] = useState<SalesLines | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  // With an app currency (Настройки → Валюта приложения) the base amounts are converted into it.
  const app = useAppCurrencyInfo()
  const base = data?.base ?? "SUM"
  const money = useMemo(() => (amount: number) => (app.code ? inAppCurrency(app, amount, base) ?? 0 : amount), [app, base])
  const moneyLabel = currencyLabel(app.code || base)

  useEffect(() => {
    let cancelled = false
    fetch("/api/sales-lines", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error()
        return (await response.json()) as SalesLines
      })
      .then((body) => {
        if (cancelled) return
        setData(body)
        setError("")
      })
      .catch(() => {
        if (!cancelled) setError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rows = useMemo<ProductRow[]>(() => {
    const period = { from: applied.from, to: applied.to }
    const lines = selectSalesLines(data?.lines ?? [], applied, applied.mode === "created" ? { created: period } : { transfer: period })
    const map = new Map<string, ProductRow>()
    for (const line of lines) {
      const key = groupOf(line, group)
      const row = map.get(key.name) ?? { ...key, ...emptyTotals() }
      addLine(row, line, money)
      map.set(key.name, row)
    }
    const term = query.trim().toLowerCase()
    return [...map.values()].filter((row) => !term || row.name.toLowerCase().includes(term)).sort((a, b) => b.saleSum - a.saleSum || a.name.localeCompare(b.name, "ru"))
  }, [data, applied, group, money, query])

  const totals = useMemo(() => {
    const sum = emptyTotals()
    for (const row of rows) for (const key of Object.keys(sum) as Array<keyof SalesTotals>) sum[key] += row[key]
    return sum
  }, [rows])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const shown = rows.slice((current - 1) * pageSize, current * pageSize)
  const withProfit = reportMode === "profit" && Boolean(data?.canSeeCost)

  // "Фильтр / N": the period plus every chosen field and ticked box (Linko's count).
  const filterCount = 1 + FILTER_KEYS.filter((key) => applied[key]).length + (applied.bonus ? 1 : 0)
  const scope = `${formatDate(applied.from)} - ${formatDate(applied.to)} ${[applied.branch, applied.organization].filter(Boolean).join(" ") || t("Во всей организации")}`

  function download() {
    const header = ["Товар", "Ед. измер", "Продажа кол-во", "Продажа сумма", "Возврат кол-во", "Возврат сумма", "Фактическая продажа кол-во", "Фактическая продажа сумма", "Скидки кол-во", "Скидки сумма"]
    const round = (value: number) => Math.round(value * 1000) / 1000
    const body = rows.map((row) => [row.name, row.unit, round(row.saleQty), round(row.saleSum), round(row.returnQty), round(row.returnSum), round(row.saleQty - row.returnQty), round(row.saleSum - row.returnSum), round(row.discountQty), round(row.discountSum)])
    const url = URL.createObjectURL(new Blob([`﻿${csvText([header.map((title) => t(title)), ...body])}`], { type: "text/csv;charset=utf-8" }))
    const link = document.createElement("a")
    link.href = url
    link.download = "sales-by-products.csv"
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Прибыль от товаров")} /></div>

      <section className={fullscreen ? "fixed inset-0 z-[80] overflow-auto bg-white p-5" : "border-b border-[#d9d9d9] bg-white pb-[1px] pt-[21px]"}>
        <div className="px-[30px]">
          <ReportTopRow
            filterLabel={<>{t("Фильтр")} / {filterCount}</>}
            scope={scope}
            onFilter={() => {
              setDraft(applied)
              setFilterOpen(true)
            }}
            onDownload={download}
          />
          {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="absolute right-5 top-5 rounded border px-3 py-2">{t("Закрыть")}</button>}

          <div className={`mt-[15px] grid gap-[14px] ${withProfit ? "md:grid-cols-4" : "md:grid-cols-3"}`}>
            <ReportSummaryCard label="Сумма от продаж">{reportNumber(totals.saleSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.saleQty)} {t("шт")})</small></ReportSummaryCard>
            <ReportSummaryCard label="Сумма возвратов">{reportNumber(totals.returnSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.returnQty)} {t("шт")})</small></ReportSummaryCard>
            <ReportSummaryCard label="Фактические продажи" right={!withProfit}>{reportNumber(totals.saleSum - totals.returnSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.saleQty - totals.returnQty)} {t("шт")})</small></ReportSummaryCard>
            {withProfit && <ReportSummaryCard label="Прибыль от продаж" right>{reportNumber(profitOf(totals))} {moneyLabel}</ReportSummaryCard>}
          </div>

          <div className="mt-[5px]">
            <ReportSearchBar
              value={query}
              onChange={(value) => { setQuery(value); setPage(1) }}
              pageSize={pageSize}
              onPageSize={(value) => { setPageSize(value); setPage(1) }}
              rangeLabel={rows.length ? `${(current - 1) * pageSize + 1} - ${Math.min(current * pageSize, rows.length)} ${t("из")} ${rows.length}` : `1 - 0 ${t("из")} 0`}
              canPrev={current > 1}
              canNext={current < pages}
              onPrev={() => setPage(current - 1)}
              onNext={() => setPage(current + 1)}
              onFullscreen={() => setFullscreen(!fullscreen)}
            />
          </div>

          <div className="-mx-[20px] flex items-end justify-between gap-4 py-[10px] pr-[20px]">
            <p className="flex w-[660px] items-center gap-2 text-[16px] font-semibold leading-[21px] text-[#1E4A9A]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#1E4A9A] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>
              {t("Это оперативний отчеть для просмотра факта перейдите в другой раздел")}
            </p>
            <div className="flex items-end gap-[20px]">
              <div className="w-[200px]"><ReportSelectField label="Группировка" value={group} options={[...GROUPS]} onChange={(value) => { setGroup(value || "По продукту"); setPage(1) }} /></div>
              <div className="flex pb-[2px]">
                <ModeButton active={reportMode === "created"} onClick={() => setReportMode("created")}>{t("ПОКАЗАТЬ ПО ДАТЕ СОЗДАНИЯ")}</ModeButton>
                <ModeButton active={reportMode === "profit"} onClick={() => setReportMode("profit")}>{t("ПРОДАЖА ПО ТОВАРАМ С ПРИБЫЛЬЮ")}</ModeButton>
              </div>
            </div>
          </div>
        </div>

        {loading ? (
          <p className="px-3 py-16 text-center text-slate-400">{t("Загрузка...")}</p>
        ) : error ? (
          <p className="px-3 py-16 text-center text-red-600">{t(error)}</p>
        ) : (
          <ProductTable rows={shown} />
        )}
      </section>

      {filterOpen && (
        <ReportFilterPanel
          onClose={() => setFilterOpen(false)}
          onApply={() => {
            if (draft.from > draft.to) return
            setApplied(draft)
            setFilterOpen(false)
            setPage(1)
          }}
          tabs={<ReportSegmentTabs labels={["Период создания", "Передачи со склада"]} value={draft.mode === "created" ? 0 : 1} onChange={(index) => setDraft((value) => ({ ...value, mode: index === 0 ? "created" : "warehouse" }))} />}
        >
          <ReportRangeField label={draft.mode === "created" ? "Период создания" : "Передачи со склада"} from={draft.from} to={draft.to} onFrom={(from) => setDraft((value) => ({ ...value, from }))} onTo={(to) => setDraft((value) => ({ ...value, to }))} />
          {FILTER_KEYS.map((key) => (
            <ReportSelectField key={key} label={labels[key]} value={draft[key]} onChange={(value) => setDraft((current) => ({ ...current, [key]: value }))} options={key === "status" ? [...ORDER_STATUSES] : directories[key as keyof typeof DIRECTORY_OF]} />
          ))}
          <ReportCheckboxField label="Показать бонусные продукты" checked={draft.bonus} onChange={(bonus) => setDraft((value) => ({ ...value, bonus }))} />
        </ReportFilterPanel>
      )}
    </ReportPage>
  )
}

function ProductTable({ rows }: { rows: ProductRow[] }) {
  const { t } = useLanguage()
  const heads = ["Товар", "Ед. измер", "Кол-во", "Сумма", "Кол-во", "Сумма", "Кол-во", "Сумма", "Кол-во", "Сумма", "Кол-во", "Сумма"]
  return (
    <div className="relative overflow-x-auto border-b border-[#e8e8e8]">
      <table className="w-full min-w-[1500px] table-fixed border-collapse text-[13px]">
        <colgroup><col className="w-[300px]" /><col className="w-[100px]" />{Array.from({ length: 10 }, (_, c) => <col key={c} />)}</colgroup>
        <thead className="shadow-[0_3px_6px_rgba(0,0,0,0.12)]">
          <tr className="h-[29px] bg-[#f0f4f9]">
            <th colSpan={2} className="bg-[#f0f4f9]" />
            <Group title="Продажа" /><Group title="Возврат в этом периоде" /><Group title="Фактическая продажа" /><Group title="Скидки" /><Group title="Бонус" />
          </tr>
          <tr className="h-[30px] bg-[#f0f4f9]">
            {heads.map((item, i) => <th key={`${item}-${i}`} className="border-l border-[#ececec] px-2 text-center font-semibold">{t(item)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0
            ? [0, 1, 2].map((r) => <tr key={r} className={`h-[31px] ${r === 1 ? "bg-[#f2f5f8]" : "bg-white"}`}>{heads.map((_, c) => <td key={c} className="border-l border-[#ececec]" />)}</tr>)
            : rows.map((row, r) => {
                // Bonus products are not kept on the order lines here: 0, never a made-up figure.
                const cells = [row.name === "Не указано" ? t(row.name) : row.name, row.unit, row.saleQty, row.saleSum, row.returnQty, row.returnSum, row.saleQty - row.returnQty, row.saleSum - row.returnSum, row.discountQty, row.discountSum, 0, 0]
                return (
                  <tr key={row.name} className={`h-[31px] ${r % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                    {cells.map((cell, i) => <td key={i} className="truncate border-l border-[#ececec] px-2">{typeof cell === "number" ? reportNumber(cell) : cell}</td>)}
                  </tr>
                )
              })}
        </tbody>
      </table>
      {rows.length === 0 && <span className="absolute left-1/2 top-[84px] -translate-x-1/2 bg-white px-[20px] pb-[16px] pt-[2px] text-[13px] text-[#777]">{t("Нет данных")}</span>}
    </div>
  )
}
function Group({ title }: { title: string }) {
  const { t } = useLanguage()
  return <th colSpan={2} className="border-l border-[#ececec] bg-[#f0f4f9] px-3 text-center font-semibold">{t(title)}</th>
}
function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`h-8 px-4 text-[13px] font-normal uppercase ${active ? "bg-[#1E4A9A] text-white" : "border border-[#e0e0e0] bg-white text-black"}`}>{children}</button> }
function formatDate(value: string) { const [year, month, day] = value.split("-"); return `${day}.${month}.${year}` }
