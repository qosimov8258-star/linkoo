"use client"

import { useEffect, useMemo, useState } from "react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportCheckboxField, ReportChipField, ReportFilterPanel, ReportPage, ReportRangeField, ReportSearchBar, ReportSegmentTabs, ReportSelectField, ReportSummaryCard, ReportTopRow } from "@/components/ref/report-kit"
import { csvText } from "@/lib/csv"
import { useLanguage } from "@/lib/i18n/language-context"
import type { OrderItemWithOrder } from "@/lib/order-items-repo"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { ORDER_STATUSES } from "@/components/orders/orders-data"

type ProductRow = { name: string; unit: string; saleQty: number; saleSum: number; returnQty: number; returnSum: number }

// "orderCreated" comes back as either an ISO date ("2026-08-02") from seeded/legacy orders
// or a Russian day+month string with no year ("06 сент. 14:23") from orders created via the UI.
// Parse defensively; unparseable values are treated as "in range" so real rows never get
// silently dropped because of a date-format surprise.
function parseOrderCreatedDate(value: string): Date | null {
  if (!value) return null
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    return Number.isNaN(date.getTime()) ? null : date
  }
  const ru = value.match(/(\d{1,2})\s+([а-яё]+)\.?/i)
  if (ru) {
    const monthNames = ["янв", "февр", "мар", "апр", "мая", "июня", "июля", "авг", "сент", "окт", "нояб", "дек"]
    const monthIndex = monthNames.indexOf(ru[2].toLowerCase())
    if (monthIndex >= 0) {
      const yearMatch = value.match(/(\d{4})/)
      const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear()
      const date = new Date(year, monthIndex, Number(ru[1]))
      return Number.isNaN(date.getTime()) ? null : date
    }
  }
  return null
}

function isWithinRange(value: string, fromIso: string, toIso: string): boolean {
  const date = parseOrderCreatedDate(value)
  if (!date) return true
  const from = new Date(`${fromIso}T00:00:00`)
  const to = new Date(`${toIso}T23:59:59`)
  return date.getTime() >= from.getTime() && date.getTime() <= to.getTime()
}

const isReturnItem = (item: OrderItemWithOrder) => item.orderType === "Возврат"

function buildProductRows(items: OrderItemWithOrder[]): ProductRow[] {
  const map = new Map<string, ProductRow>()
  for (const item of items) {
    const key = item.productName || "—"
    const row = map.get(key) ?? { name: key, unit: item.unit || "шт.", saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0 }
    if (isReturnItem(item)) {
      row.returnQty += item.quantity
      row.returnSum += item.lineTotal
    } else {
      row.saleQty += item.quantity
      row.saleSum += item.lineTotal
    }
    map.set(key, row)
  }
  return Array.from(map.values()).sort((a, b) => b.saleSum - a.saleSum)
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
const options = {
  branch: [] as string[],
  brand: [] as string[],
  organization: [] as string[],
  productType: [] as string[],
  status: [...ORDER_STATUSES] as string[],
  client: [] as string[],
  agent: [] as string[],
  clientType: [] as string[],
  warehouse: [] as string[],
}

type FilterKey = keyof typeof options

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
  const today = useMemo(() => iso(new Date()), [])
  const start = useMemo(() => {
    const date = new Date()
    return iso(new Date(date.getFullYear(), date.getMonth(), 1))
  }, [])
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
    Object.fromEntries(Object.entries(options).map(([key, values]) => [key, ""])) as Record<FilterKey, string>,
  )

  const [items, setItems] = useState<OrderItemWithOrder[]>([])
  const [itemsLoading, setItemsLoading] = useState(true)
  const [itemsError, setItemsError] = useState("")

  useEffect(() => {
    let cancelled = false
    setItemsLoading(true)
    fetch("/api/order-items")
      .then(async (response) => {
        if (!response.ok) throw new Error("Не удалось загрузить данные")
        return (await response.json()) as OrderItemWithOrder[]
      })
      .then((data) => {
        if (cancelled) return
        setItems(data)
        setItemsError("")
      })
      .catch(() => {
        if (!cancelled) setItemsError("Не удалось загрузить данные с сервера")
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Only the "created date" report mode has a real date dimension to filter on
  // (orderCreated). "profit" mode toggles a formerly-fake ×0.95 multiplier that has
  // been removed — this table has no separate profit column, so both modes now show
  // the same real figures; the button stays in place but is cosmetic.
  const products = useMemo(() => {
    const dateFiltered = mode === "created" ? items.filter((item) => isWithinRange(item.orderCreated, from, to)) : items
    // Filters the order lines carry (client, agent, status) apply to the loaded rows.
    const same = (value: string, wanted: string) => !wanted || value.trim().toLowerCase() === wanted.trim().toLowerCase()
    return buildProductRows(
      dateFiltered.filter((item) => same(item.orderClient, filters.client) && same(item.orderAgent, filters.agent) && same(item.orderStatus, filters.status)),
    )
  }, [items, mode, from, to, filters.client, filters.agent, filters.status])

  const rows = useMemo(() => {
    const term = query.trim().toLowerCase()
    return products.filter((row) => !term || row.name.toLowerCase().includes(term))
  }, [query, products])
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

  function download() {
    const header = ["Товар", "Ед. измер", "Продажа кол-во", "Продажа сумма", "Возврат кол-во", "Возврат сумма", "Фактическая продажа кол-во", "Фактическая продажа сумма"]
    const body = rows.map((row) => [row.name, row.unit, row.saleQty, row.saleSum, row.returnQty, row.returnSum, row.saleQty - row.returnQty, row.saleSum - row.returnSum])
    const url = URL.createObjectURL(new Blob([`\uFEFF${csvText([header.map((title) => t(title)), ...body])}`], { type: "text/csv;charset=utf-8" }))
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
            filterLabel="Фильтр / 1"
            scope={`${formatDate(from)} - ${formatDate(to)} ${filters.organization || t("Во всей организации")}`}
            onFilter={() => setFilterOpen(true)}
            onDownload={download}
          />
          {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="absolute right-5 top-5 rounded border px-3 py-2">{t("Закрыть")}</button>}

          <div className="mt-[15px] grid gap-[14px] md:grid-cols-3">
            <ReportSummaryCard label="Сумма от продаж">{totals.saleSum.toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.saleQty} {t("шт")})</small></ReportSummaryCard>
            <ReportSummaryCard label="Сумма возвратов">{totals.returnSum.toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.returnQty} {t("шт")})</small></ReportSummaryCard>
            <ReportSummaryCard label="Фактические продажи" right>{(totals.saleSum - totals.returnSum).toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.saleQty - totals.returnQty} {t("шт")})</small></ReportSummaryCard>
          </div>

          <div className="mt-[5px]">
            <ReportSearchBar
              value={query}
              onChange={setQuery}
              pageSize={pageSize}
              onPageSize={setPageSize}
              rangeLabel={rows.length ? `1 - ${Math.min(pageSize, rows.length)} ${t("из")} ${rows.length}` : `1 - 0 ${t("из")} 0`}
              canPrev={false}
              canNext={false}
              onPrev={() => undefined}
              onNext={() => undefined}
              onFullscreen={() => setFullscreen(!fullscreen)}
            />
          </div>

          <div className="-mx-[20px] flex items-end justify-between gap-4 py-[10px] pr-[20px]">
            <p className="flex w-[660px] items-center gap-2 text-[16px] font-semibold leading-[21px] text-[#4f71dc]">
              <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#4f71dc] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>
              {t("Это оперативний отчеть для просмотра факта перейдите в другой раздел")}
            </p>
            <div className="flex items-end gap-[20px]">
              <div className="w-[200px]"><ReportSelectField label="Группировка" value={group} options={["По продукту", "По бренду", "По типу продукта"]} onChange={(value) => setGroup(value || "По продукту")} /></div>
              <div className="flex pb-[2px]">
                <ModeButton active={reportMode === "created"} onClick={() => setReportMode("created")}>{t("ПОКАЗАТЬ ПО ДАТЕ СОЗДАНИЯ")}</ModeButton>
                <ModeButton active={reportMode === "profit"} onClick={() => setReportMode("profit")}>{t("ПРОДАЖА ПО ТОВАРАМ С ПРИБЫЛЬЮ")}</ModeButton>
              </div>
            </div>
          </div>
        </div>

        {itemsLoading ? (
          <p className="px-3 py-16 text-center text-slate-400">{t("Загрузка...")}</p>
        ) : itemsError ? (
          <p className="px-3 py-16 text-center text-red-600">{itemsError}</p>
        ) : (
          <ProductTable rows={rows.slice(0, pageSize)} />
        )}
      </section>

      {filterOpen && (
        <ReportFilterPanel
          onClose={() => setFilterOpen(false)}
          onApply={() => {
            if (from <= to) setFilterOpen(false)
          }}
          tabs={<ReportSegmentTabs labels={["Период создания", "Передачи со склада"]} value={mode === "created" ? 0 : 1} onChange={(index) => setMode(index === 0 ? "created" : "warehouse")} />}
        >
          <ReportRangeField label={mode === "created" ? "Период создания" : "Период передачи со склада"} from={from} to={to} onFrom={setFrom} onTo={setTo} />
          {(["branch", "brand", "organization", "productType", "status", "client", "agent", "clientType", "warehouse"] as FilterKey[]).map((key) => (
            <ReportSelectField key={key} label={labels[key]} value={filters[key]} onChange={(value) => setFilter(key, value)} options={key === "status" ? options.status : directories[key as keyof typeof DIRECTORY_OF]} clearable={false} />
          ))}
          <ReportCheckboxField label="Показать бонусные продукты" checked={bonus} onChange={setBonus} />
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
                // Discounts and bonus products are not in these order lines: 0, never a made-up figure.
                const cells = [row.name, row.unit, row.saleQty, row.saleSum, row.returnQty, row.returnSum, row.saleQty - row.returnQty, row.saleSum - row.returnSum, 0, 0, 0, 0]
                return (
                  <tr key={row.name} className={`h-[31px] ${r % 2 ? "bg-[#f2f5f8]" : "bg-white"}`}>
                    {cells.map((cell, i) => <td key={i} className="truncate border-l border-[#ececec] px-2">{typeof cell === "number" ? cell.toLocaleString("ru-RU") : cell}</td>)}
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
function ModeButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`h-8 px-4 text-[13px] font-normal uppercase ${active ? "bg-[#4f71dc] text-white" : "border border-[#e0e0e0] bg-white text-black"}`}>{children}</button> }
function formatDate(value: string) { const [year, month, day] = value.split("-"); return `${day}.${month}.${year}` }

const labels: Record<FilterKey, string> = { branch: "Филиалы", brand: "Бренд", organization: "Организация", productType: "Тип товара", status: "Статус", client: "Клиент", agent: "Агент", clientType: "Тип клиента", warehouse: "Склад" }
