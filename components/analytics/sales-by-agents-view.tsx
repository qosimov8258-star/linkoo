"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { RefHeader } from "@/components/ref/list-kit"
import { ReportCheckboxField, ReportEmpty, ReportFilterPanel, ReportPage, ReportRangeField, ReportSearchBar, ReportSelectField, ReportSummaryCard, ReportTopRow } from "@/components/ref/report-kit"
import { csvText } from "@/lib/csv"
import { inAppCurrency, useAppCurrencyInfo } from "@/lib/app-currency-context"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import { addLine, EMPTY_SALES_FILTERS, emptyTotals, profitOf, reportNumber, selectSalesLines, type SalesLineFilters, type SalesLines, type SalesTotals } from "@/lib/sales-lines-types"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { ORDER_STATUSES } from "@/components/orders/orders-data"

// Прибыль от агентов (Linko's #/statistics/agent, stats/user_profits), from GET /api/sales-lines:
// - «ПОКАЗАТЬ ПРОДАЖУ ПО ДАТЕ СОЗДАНИЯ» (Linko's menu item «Продажа по агентам» opens it: withProfit=False): the lines
//   created in «Период создания» (and transferred in its period);
// - «ПРОДАЖА АГЕНТОВ ПО ДАТЕ РЕАЛИЗАЦИИ С ПРИБЫЛЬЮ» (?withProfit=True, as «Прибыль от агентов»): the lines transferred
//   from the warehouse in «Период передачи со склада», with the net cost and the profit.
// Sales are the lines of the not cancelled orders, «Возврат в этом периоде» the accepted returns of the period;
// money is in the base currency (or the app currency). Every filter of the panel applies on «Применить».

type Mode = "created" | "realized"
type AgentRow = SalesTotals & { agent: string }

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

type Draft = SalesLineFilters & { from: string; to: string; transferFrom: string; transferTo: string; showBonus: boolean }

const statuses: string[] = [...ORDER_STATUSES]

export function SalesByAgentsView() {
  const { t } = useLanguage()
  const today = useMemo(() => inputDate(new Date()), [])
  const initial: Draft = useMemo(() => ({ ...EMPTY_SALES_FILTERS, from: monthStart(), to: today, transferFrom: monthStart(), transferTo: today, showBonus: false }), [today])
  const [filterOpen, setFilterOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [pageSize, setPageSize] = useState(25)
  const [page, setPage] = useState(1)
  const searchParams = useSearchParams()
  const [mode, setMode] = useState<Mode>(() => (searchParams.get("withProfit")?.toLowerCase() === "true" ? "realized" : "created"))
  const [fullscreen, setFullscreen] = useState(false)
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
  const withProfit = mode === "realized" && Boolean(data?.canSeeCost)

  // The server sends only the lines of the span the periods cover (created or transferred in it); the exact periods
  // are applied below.
  const windowQuery = useMemo(() => {
    const window = { from: [applied.from, applied.transferFrom].filter(Boolean).sort()[0] ?? "", to: [applied.to, applied.transferTo].filter(Boolean).sort().reverse()[0] ?? "" }
    return window.from && window.to && window.from <= window.to ? `?${new URLSearchParams(window)}` : ""
  }, [applied.from, applied.to, applied.transferFrom, applied.transferTo])
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/sales-lines${windowQuery}`, { cache: "no-store" })
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
  }, [windowQuery])

  const rows = useMemo<AgentRow[]>(() => {
    const transfer = { from: applied.transferFrom, to: applied.transferTo }
    const lines = selectSalesLines(data?.lines ?? [], { ...applied, belowCost: mode === "realized" && applied.belowCost }, mode === "created" ? { created: { from: applied.from, to: applied.to }, transfer } : { transfer })
    const map = new Map<string, AgentRow>()
    for (const line of lines) {
      const agent = line.agent.trim() || "Не указано"
      const row = map.get(agent) ?? { agent, ...emptyTotals() }
      addLine(row, line, money)
      map.set(agent, row)
    }
    const term = query.trim().toLowerCase()
    return [...map.values()].filter((row) => !term || row.agent.toLowerCase().includes(term)).sort((a, b) => b.saleSum - a.saleSum || a.agent.localeCompare(b.agent, "ru"))
  }, [data, applied, mode, money, query])

  const totals = useMemo(() => {
    const sum = emptyTotals()
    for (const row of rows) for (const key of Object.keys(sum) as Array<keyof SalesTotals>) sum[key] += row[key]
    return sum
  }, [rows])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const shown = rows.slice((current - 1) * pageSize, current * pageSize)

  // "Фильтр / N" as Linko counts it: the periods of the mode plus every chosen field and ticked box.
  const filterCount =
    (mode === "created" ? 2 : 1) +
    [applied.branch, applied.organization, applied.productType, applied.status, applied.client, applied.agent, applied.clientType].filter(Boolean).length +
    (applied.showBonus ? 1 : 0) +
    (mode === "realized" && applied.belowCost ? 1 : 0)
  const scope = [applied.branch, applied.organization].filter(Boolean).join(" ") || "Во всей организации"

  const groups: { title: string; columns: { label: string; value: (row: SalesTotals) => number }[] }[] = [
    {
      title: "Продажа",
      columns: [
        { label: "Кол-во", value: (row) => row.saleQty },
        { label: "Сумма", value: (row) => row.saleSum },
        ...(withProfit ? [{ label: "Себестоимость", value: (row: SalesTotals) => row.saleCost }] : []),
      ],
    },
    {
      title: "Возврат в этом периоде",
      columns: [
        { label: "Кол-во", value: (row) => row.returnQty },
        { label: "Сумма", value: (row) => row.returnSum },
        ...(withProfit ? [{ label: "Себестоимость", value: (row: SalesTotals) => row.returnCost }] : []),
      ],
    },
    {
      title: "Фактическая продажа",
      columns: [
        { label: "Кол-во", value: (row) => row.saleQty - row.returnQty },
        { label: "Сумма", value: (row) => row.saleSum - row.returnSum },
      ],
    },
    ...(withProfit ? [{ title: "Прибыль от продаж", columns: [{ label: "Сумма", value: (row: SalesTotals) => profitOf(row) }] }] : []),
    {
      title: "Скидки",
      columns: [
        { label: "Кол-во", value: (row) => row.discountQty },
        { label: "Сумма", value: (row) => row.discountSum },
      ],
    },
    // Bonus products are not kept on the order lines here: 0, never a made-up figure.
    { title: "Бонус", columns: [{ label: "Кол-во", value: () => 0 }, { label: "Сумма", value: () => 0 }] },
  ]
  const flatColumns = groups.flatMap((group) => group.columns)

  function downloadCsv() {
    const header = ["Агент", ...groups.flatMap((group) => group.columns.map((column) => `${t(group.title)} ${t(column.label)}`))]
    const body = rows.map((row) => [row.agent, ...flatColumns.map((column) => Math.round(column.value(row) * 1000) / 1000)])
    const url = URL.createObjectURL(new Blob([`﻿${csvText([header.map((title) => t(title)), ...body])}`], { type: "text/csv;charset=utf-8" }))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "sales-by-agents.csv"
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const tone = (value: number) => (value > 0 ? "text-green-600" : value < 0 ? "text-red-500" : "")

  return (
    <ReportPage>
      <div className="pl-[30px] pr-[38px]"><RefHeader title={t("Прибыль от агентов")} /></div>
      <section className={`${fullscreen ? "fixed inset-0 z-[80] overflow-auto bg-white p-5" : "border-b border-[#d9d9d9] bg-white px-[30px] pb-[1px] pt-[21px]"}`}>
        <ReportTopRow
          filterLabel={<>{t("Фильтр")} / {filterCount}</>}
          scope={scope}
          onFilter={() => {
            setDraft(applied)
            setFilterOpen(true)
          }}
          onDownload={downloadCsv}
        />
        {fullscreen && <button type="button" onClick={() => setFullscreen(false)} className="absolute right-5 top-5 rounded border px-3 py-2">{t("Закрыть")}</button>}
        <div className="mt-[15px] grid gap-[14px] md:grid-cols-3">
          <ReportSummaryCard label="Сумма от продаж">{reportNumber(totals.saleSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.saleQty)} {t("шт")})</small></ReportSummaryCard>
          <ReportSummaryCard label="Сумма возвратов">{reportNumber(totals.returnSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.returnQty)} {t("шт")})</small></ReportSummaryCard>
          <ReportSummaryCard label="Фактические продажи" right>{reportNumber(totals.saleSum - totals.returnSum)} {moneyLabel}<small className="ml-px text-[13px] font-medium">({reportNumber(totals.saleQty - totals.returnQty)} {t("шт")})</small></ReportSummaryCard>
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
            onFullscreen={() => setFullscreen((value) => !value)}
          />
        </div>
        <div className="-mx-[20px] flex items-start justify-between gap-4 py-[10px] pr-[20px]">
          <p className="flex w-[660px] items-center gap-2 text-[16px] font-semibold leading-[21px] text-[#1E4A9A]">
            <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 fill-none stroke-[#1E4A9A] stroke-2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" strokeLinecap="round" /></svg>
            {t("Это оперативний отчеть для просмотра факта перейдите в другой раздел")}
          </p>
          <div className="mt-[2px] flex">
            <button type="button" onClick={() => { setMode("created"); setPage(1) }} className={`h-8 px-4 text-[13px] font-normal uppercase ${mode === "created" ? "bg-[#1E4A9A] text-white" : "border border-[#e0e0e0] text-black"}`}>{t("ПОКАЗАТЬ ПРОДАЖУ ПО ДАТЕ СОЗДАНИЯ")}</button>
            <button type="button" onClick={() => { setMode("realized"); setPage(1) }} className={`h-8 px-4 text-[13px] font-normal uppercase ${mode === "realized" ? "bg-[#1E4A9A] text-white" : "border border-[#e0e0e0] text-black"}`}>{t("ПРОДАЖА АГЕНТОВ ПО ДАТЕ РЕАЛИЗАЦИИ С ПРИБЫЛЬЮ")}</button>
          </div>
        </div>
        {loading ? (
          <p className="px-3 py-16 text-center text-slate-400">{t("Загрузка...")}</p>
        ) : error ? (
          <p className="px-3 py-16 text-center text-red-600">{t(error)}</p>
        ) : shown.length === 0 ? (
          <ReportEmpty className="pb-[24px] pt-[24px]" text="По вашему запросу ничего не найдено" />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1250px] border-collapse">
              <thead className="bg-[#5470e8] text-white">
                <tr>
                  <th rowSpan={2} className="min-w-[300px] border-r border-white/30 px-5 py-4 text-left">{t("Агент")}</th>
                  {groups.map((group) => <th key={group.title} colSpan={group.columns.length} className="border-r border-white/30 px-4 py-3 text-left">{t(group.title)}</th>)}
                </tr>
                <tr>
                  {groups.map((group) => (
                    <Fragment key={group.title}>
                      {group.columns.map((column) => <th key={`${group.title}-${column.label}`} className="border-r border-white/30 px-4 py-3">{t(column.label)}</th>)}
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((row, index) => (
                  <tr key={row.agent} className={index % 2 ? "bg-white" : "bg-slate-50"}>
                    <td className="border-r px-5 py-3">{row.agent === "Не указано" ? t(row.agent) : row.agent}</td>
                    {flatColumns.map((column, cell) => {
                      const value = column.value(row)
                      return <td key={cell} className={`border-r px-4 py-3 text-right ${tone(value)}`}>{reportNumber(value)}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {filterOpen && (
        <FilterDialog
          mode={mode}
          draft={draft}
          onDraft={(patch) => setDraft((value) => ({ ...value, ...patch }))}
          onClose={() => setFilterOpen(false)}
          onApply={() => {
            if (draft.from > draft.to || draft.transferFrom > draft.transferTo) return
            setApplied(draft)
            setFilterOpen(false)
            setPage(1)
          }}
        />
      )}
    </ReportPage>
  )
}

function FilterDialog({ mode, draft, onDraft, onClose, onApply }: { mode: Mode; draft: Draft; onDraft: (patch: Partial<Draft>) => void; onClose: () => void; onApply: () => void }) {
  const branches = useDirectoryNames("branches")
  const organizations = useDirectoryNames("organizations")
  const productTypes = useDirectoryNames("productTypes")
  const clients = useDirectoryNames("clients")
  const agents = useDirectoryNames("employees")
  const clientTypes = useDirectoryNames("clientTypes")
  return (
    <ReportFilterPanel onClose={onClose} onApply={onApply}>
      {/* Linko's fields: the creation period only in the creation-date mode, "Продано дешевле себестоимости" only with profit. */}
      {mode === "created" && <ReportRangeField label="Период создания" from={draft.from} to={draft.to} onFrom={(from) => onDraft({ from })} onTo={(to) => onDraft({ to })} />}
      <ReportRangeField label="Период передачи со склада" from={draft.transferFrom} to={draft.transferTo} onFrom={(transferFrom) => onDraft({ transferFrom })} onTo={(transferTo) => onDraft({ transferTo })} />
      <ReportSelectField label="Филиалы" value={draft.branch} onChange={(branch) => onDraft({ branch })} options={branches} />
      <ReportSelectField label="Организация" value={draft.organization} onChange={(organization) => onDraft({ organization })} options={organizations} />
      <ReportSelectField label="Тип товара" value={draft.productType} onChange={(productType) => onDraft({ productType })} options={productTypes} />
      <ReportSelectField label="Статус" value={draft.status} onChange={(status) => onDraft({ status })} options={statuses} />
      <ReportSelectField label="Клиент" value={draft.client} onChange={(client) => onDraft({ client })} options={clients} />
      <ReportSelectField label="Агент" value={draft.agent} onChange={(agent) => onDraft({ agent })} options={agents} />
      <ReportSelectField label="Тип клиента" value={draft.clientType} onChange={(clientType) => onDraft({ clientType })} options={clientTypes} />
      <ReportCheckboxField label="Показать бонусные продукты" checked={draft.showBonus} onChange={(showBonus) => onDraft({ showBonus })} />
      {mode === "realized" && <ReportCheckboxField label="Продано дешевле себестоимости" checked={draft.belowCost} onChange={(belowCost) => onDraft({ belowCost })} />}
    </ReportFilterPanel>
  )
}
