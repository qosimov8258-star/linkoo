"use client"

import { FormEvent, useEffect, useMemo, useState } from "react"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportCheckboxField, ReportEmpty, ReportFilterPanel, ReportPage, ReportRangeField, ReportSearchBar, ReportSelectField, ReportSummaryCard, ReportTopRow } from "@/components/ref/report-kit"
import { useLanguage } from "@/lib/i18n/language-context"
import type { OrderItemWithOrder } from "@/lib/order-items-repo"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { ORDER_STATUSES } from "@/components/orders/orders-data"

type AgentSale = {
  agent: string
  saleQty: number
  saleSum: number
  returnQty: number
  returnSum: number
  discountQty: number
  discountSum: number
  bonusQty: number
  bonusSum: number
}

// Same defensive parser used across the analytics views: orderCreated is either an ISO
// date ("2026-08-02") or a Russian day+month string with no year ("06 сент. 14:23").
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

// Grouped by orderAgent. Returns come from items whose parent order type is "Возврат"
// (the only real signal for a return in this schema). Discount figures are the actual
// discount amount taken off each line (quantity × unitPrice × discountPercent / 100).
// There is no bonus concept anywhere in order_items, so bonus columns stay at 0 — no
// more fabricating a "показать бонусные продукты" number.
function buildAgentRows(items: OrderItemWithOrder[]): AgentSale[] {
  const map = new Map<string, AgentSale>()
  for (const item of items) {
    const key = item.orderAgent || "Не указано"
    const row = map.get(key) ?? { agent: key, saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0, discountQty: 0, discountSum: 0, bonusQty: 0, bonusSum: 0 }
    const discountAmount = item.quantity * item.unitPrice * (item.discountPercent / 100)
    if (item.discountPercent > 0) {
      row.discountQty += item.quantity
      row.discountSum += discountAmount
    }
    if (item.orderType === "Возврат") {
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
const statuses: string[] = [...ORDER_STATUSES]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function monthStart() {
  const today = new Date()
  return inputDate(new Date(today.getFullYear(), today.getMonth(), 1))
}

export function SalesByAgentsView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const [mode, setMode] = useState<"created" | "realized">("created")
  const [fullscreen, setFullscreen] = useState(false)
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [warehouseFrom, setWarehouseFrom] = useState(monthStart)
  const [warehouseTo, setWarehouseTo] = useState(today)
  const [branch, setBranch] = useState("")
  const [organization, setOrganization] = useState("")
  const [productType, setProductType] = useState("")
  const [status, setStatus] = useState("")
  const [client, setClient] = useState("")
  const [agent, setAgent] = useState("")
  const [clientType, setClientType] = useState("")
  const [showBonus, setShowBonus] = useState(false)
  const [, setFilterVersion] = useState(0)

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

  const rows = useMemo(() => {
    const dateFiltered = mode === "created" ? items.filter((item) => isWithinRange(item.orderCreated, from, to)) : items
    // Filters the order lines carry (client, status) apply to the loaded rows.
    const same = (value: string, wanted: string) => !wanted || value.trim().toLowerCase() === wanted.trim().toLowerCase()
    return buildAgentRows(dateFiltered.filter((item) => same(item.orderClient, client) && same(item.orderStatus, status)))
      .filter((row) => agent === "" || row.agent === agent)
      .filter((row) => row.agent.toLowerCase().includes(query.toLowerCase()))
  }, [items, agent, client, status, query, mode, from, to])

  const totals = useMemo(
    () =>
      rows.reduce(
        (sum, row) => ({
          saleQty: sum.saleQty + row.saleQty,
          saleSum: sum.saleSum + row.saleSum,
          returnQty: sum.returnQty + row.returnQty,
          returnSum: sum.returnSum + row.returnSum,
        }),
        { saleQty: 0, saleSum: 0, returnQty: 0, returnSum: 0 },
      ),
    [rows],
  )
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const shown = rows.slice((page - 1) * pageSize, page * pageSize)

  function applyFilters(event: FormEvent) {
    event.preventDefault()
    if (from <= to && warehouseFrom <= warehouseTo) {
      setFilterVersion((value) => value + 1)
      setFilterOpen(false)
      setPage(1)
    }
  }

  function downloadCsv() {
    const header = "Агент;Продажа кол-во;Продажа сумма;Возврат кол-во;Возврат сумма;Фактическая продажа кол-во;Фактическая продажа сумма;Скидки;Бонус"
    const body = rows.map((row) => `${row.agent};${row.saleQty};${row.saleSum};${row.returnQty};${row.returnSum};${row.saleQty - row.returnQty};${row.saleSum - row.returnSum};${row.discountSum};${row.bonusSum}`)
    const url = URL.createObjectURL(new Blob([`\uFEFF${[header, ...body].join("\n")}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "sales-by-agents.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Продажа по агентам")} /></div>
      <section className={`${fullscreen ? "fixed inset-0 z-[80] overflow-auto bg-white p-5" : "border-b border-[#d9d9d9] bg-white px-[30px] pb-[1px] pt-[21px]"}`}>
        <ReportTopRow
          filterLabel="Фильтр / 1"
          scope={organization || "Во всей организации"}
          onFilter={() => setFilterOpen(true)}
          onDownload={downloadCsv}
        />
        {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="absolute right-5 top-5 rounded border px-3 py-2">{t("Закрыть")}</button>}
        <div className="mt-[15px] grid gap-[14px] md:grid-cols-3">
          <ReportSummaryCard label="Сумма от продаж">{totals.saleSum.toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.saleQty} шт)</small></ReportSummaryCard>
          <ReportSummaryCard label="Сумма возвратов">{totals.returnSum.toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.returnQty} шт)</small></ReportSummaryCard>
          <ReportSummaryCard label="Фактические продажи" right>{(totals.saleSum - totals.returnSum).toLocaleString("ru-RU")} SUM<small className="ml-px text-[13px] font-medium">({totals.saleQty - totals.returnQty} шт)</small></ReportSummaryCard>
        </div>
        <div className="mt-[5px]">
          <ReportSearchBar
            value={query}
            onChange={(value) => { setQuery(value); setPage(1) }}
            pageSize={pageSize}
            onPageSize={setPageSize}
            rangeLabel={rows.length ? `${(page - 1) * pageSize + 1} - ${Math.min(page * pageSize, rows.length)} из ${rows.length}` : "1 - 0 из 0"}
            canPrev={page > 1}
            canNext={page < pages}
            onPrev={() => setPage((value) => value - 1)}
            onNext={() => setPage((value) => value + 1)}
            onFullscreen={() => setFullscreen((value) => !value)}
          />
        </div>
        <div className="-mx-[20px] flex items-start justify-between gap-4 py-[10px] pr-[20px]">
          <p className="flex w-[660px] items-center gap-2 text-[16px] font-semibold leading-[21px] text-[#4f71dc]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#4f71dc] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>
            Это оперативний отчеть для просмотра факта перейдите в другой раздел
          </p>
          <div className="mt-[2px] flex">
            <button type="button" onClick={() => setMode("created")} className={`h-8 px-4 text-[13px] font-normal uppercase ${mode === "created" ? "bg-[#4f71dc] text-white" : "border border-[#e0e0e0] text-black"}`}>ПОКАЗАТЬ ПРОДАЖУ ПО ДАТЕ СОЗДАНИЯ</button>
            <button type="button" onClick={() => setMode("realized")} className={`h-8 px-4 text-[13px] font-normal uppercase ${mode === "realized" ? "bg-[#4f71dc] text-white" : "border border-[#e0e0e0] text-black"}`}>ПРОДАЖА АГЕНТОВ ПО ДАТЕ РЕАЛИЗАЦИИ С ПРИБЫЛЬЮ</button>
          </div>
        </div>
        {itemsLoading ? (
          <p className="px-3 py-16 text-center text-slate-400">{t("Загрузка...")}</p>
        ) : itemsError ? (
          <p className="px-3 py-16 text-center text-red-600">{itemsError}</p>
        ) : shown.length === 0 ? (
          <ReportEmpty className="pb-[24px] pt-[24px]" text="По вашему запросу ничего не найдено" />
        ) : (
          <div className="overflow-x-auto"><table className="min-w-[1250px] border-collapse"><thead className="bg-[#5470e8] text-white"><tr><th rowSpan={2} className="min-w-[300px] border-r border-white/30 px-5 py-4 text-left">Агент</th>{["Продажа", "Возврат в этом периоде", "Фактическая продажа", "Скидки", "Бонус"].map((item) => <th key={item} colSpan={2} className="border-r border-white/30 px-4 py-3 text-left">{item}</th>)}</tr><tr>{Array.from({ length: 5 }).flatMap((_, index) => [<th key={`${index}-q`} className="border-r border-white/30 px-4 py-3">Кол-во</th>, <th key={`${index}-s`} className="border-r border-white/30 px-4 py-3">Сумма</th>])}</tr></thead><tbody>{shown.map((row, index) => { const actualQty = row.saleQty - row.returnQty; const actualSum = row.saleSum - row.returnSum; return <tr key={row.agent} className={index % 2 ? "bg-white" : "bg-slate-50"}><td className="border-r px-5 py-3">{row.agent}</td>{[row.saleQty, row.saleSum, row.returnQty, row.returnSum, actualQty, actualSum, row.discountQty, row.discountSum, row.bonusQty, row.bonusSum].map((value, cell) => <td key={cell} className={`border-r px-4 py-3 text-right ${value > 0 ? "text-green-600" : value < 0 ? "text-red-500" : ""}`}>{typeof value === "number" ? value.toLocaleString("ru-RU") : value}</td>)}</tr>})}</tbody></table></div>
        )}
      </section>
      {filterOpen && <FilterDialog from={from} setFrom={setFrom} to={to} setTo={setTo} warehouseFrom={warehouseFrom} setWarehouseFrom={setWarehouseFrom} warehouseTo={warehouseTo} setWarehouseTo={setWarehouseTo} branch={branch} setBranch={setBranch} organization={organization} setOrganization={setOrganization} productType={productType} setProductType={setProductType} status={status} setStatus={setStatus} client={client} setClient={setClient} agent={agent} setAgent={setAgent} clientType={clientType} setClientType={setClientType} showBonus={showBonus} setShowBonus={setShowBonus} onClose={() => setFilterOpen(false)} onSubmit={applyFilters} />}
    </ReportPage>
  )
}

type Setter = (value: string) => void
function FilterDialog(props: { from: string; setFrom: Setter; to: string; setTo: Setter; warehouseFrom: string; setWarehouseFrom: Setter; warehouseTo: string; setWarehouseTo: Setter; branch: string; setBranch: Setter; organization: string; setOrganization: Setter; productType: string; setProductType: Setter; status: string; setStatus: Setter; client: string; setClient: Setter; agent: string; setAgent: Setter; clientType: string; setClientType: Setter; showBonus: boolean; setShowBonus: (value: boolean) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  const branches = useDirectoryNames("branches")
  const organizations = useDirectoryNames("organizations")
  const productTypes = useDirectoryNames("productTypes")
  const clients = useDirectoryNames("clients")
  const agents = useDirectoryNames("employees")
  const clientTypes = useDirectoryNames("clientTypes")
  return (
    <ReportFilterPanel onClose={props.onClose} onApply={() => props.onSubmit({ preventDefault() {} } as FormEvent)}>
      <ReportRangeField label="Период создания" from={props.from} to={props.to} onFrom={props.setFrom} onTo={props.setTo} />
      <ReportRangeField label="Период передачи со склада" from={props.warehouseFrom} to={props.warehouseTo} onFrom={props.setWarehouseFrom} onTo={props.setWarehouseTo} />
      <ReportSelectField label="Филиалы" value={props.branch} onChange={props.setBranch} options={branches} clearable={false} />
      <ReportSelectField label="Организация" value={props.organization} onChange={props.setOrganization} options={organizations} clearable={false} />
      <ReportSelectField label="Тип товара" value={props.productType} onChange={props.setProductType} options={productTypes} clearable={false} />
      <ReportSelectField label="Статус" value={props.status} onChange={props.setStatus} options={statuses} clearable={false} />
      <ReportSelectField label="Клиент" value={props.client} onChange={props.setClient} options={clients} clearable={false} />
      <ReportSelectField label="Агент" value={props.agent} onChange={props.setAgent} options={agents} clearable={false} />
      <ReportSelectField label="Тип клиента" value={props.clientType} onChange={props.setClientType} options={clientTypes} clearable={false} />
      <ReportCheckboxField label="Показать бонусные продукты" checked={props.showBonus} onChange={props.setShowBonus} />
    </ReportFilterPanel>
  )
}
