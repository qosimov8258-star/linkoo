"use client"

import { useEffect, useMemo, useState } from "react"
import { CashOverview, useBalanceOverview, WarehouseOverview } from "@/components/analytics/balance-sections"
import { MoreButton, SortArrows, ToggleButtons, formatAmount, signedColor, useWidgetPeriod } from "@/components/analytics/widget-table-kit"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import { useAppCurrencyInfo } from "@/lib/app-currency-context"
import type { PeriodKey } from "@/lib/dashboard-date-range"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

type Amounts = Record<string, number>
export type BranchRow = { key: string; name: string; currencies: Record<string, Amounts> }
type BranchReport = { rows: BranchRow[]; totals: Record<string, Amounts>; visibleCurrencies: string[]; currencies: { code: string; label: string }[] }

// Column groups of the table, in the reference order: [field of the balance row, header, summary label, summary colour].
const GROUPS = [
  { field: "begin_balance", head: "Баланс на начало периода", summary: "Баланс на начало периода", tone: "text-[#0d99ff]" },
  { field: "stock_transfer_minus", head: "Передача на склад", summary: "Передача на склад", tone: "text-[#e57373]" },
  { field: "stock_transfer_plus", head: "Возврат передачи", summary: "Возврат передачи", tone: "text-[#8acb8d]" },
  { field: "payments", head: "Оплата", summary: "Принятие оплаты", tone: "text-[#8acb8d]" },
  { field: "none_type_plus", head: "Прочие приходы", summary: "Прочие приходы", tone: "text-[#8acb8d]" },
  { field: "none_type_minus", head: "Прочие расходы", summary: "Прочие расходы", tone: "text-[#e57373]" },
  { field: "end_balance", head: "Баланс на конец", summary: "Баланс на конец периода", tone: "text-[#0d99ff]" },
] as const
// Table column widths (px of the 1440px card): branch, then SUM | USD of every group.
const COLUMN_WIDTHS = [203.2, 117.6, 96.6, 85.1, 82.6, 85.1, 82.6, 85.1, 82.6, 85.1, 82.6, 85.1, 82.6, 100.6, 82.8]
const TABLE_CURRENCIES = ["SUM", "USD"] as const
const COLLAPSED_ROWS = 7
const CARD_SHADOW = "shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

export function BranchTabView() {
  const { t } = useLanguage()
  const app = useAppCurrencyInfo()
  // One column per group with an app currency (it is the only currency of the ledger then).
  const tableCurrencies: readonly string[] = app.code ? [app.code] : TABLE_CURRENCIES
  const columnWidths = app.code ? [COLUMN_WIDTHS[0], ...GROUPS.map((_, index) => COLUMN_WIDTHS[1 + index * 2] + COLUMN_WIDTHS[2 + index * 2])] : COLUMN_WIDTHS
  const { period, setPeriod, beginIso, endIso, label } = useWidgetPeriod()
  const [report, setReport] = useState<BranchReport | null>(null)
  // The warehouse and cash sections follow the same period (GET /api/balances/overview).
  const overview = useBalanceOverview({ from: beginIso, to: endIso })
  const [chartMode, setChartMode] = useState<"type" | "brand">("type")
  const [sort, setSort] = useState<{ field: string; currency: string; dir: "asc" | "desc" } | null>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/balances/branch?from=${beginIso}&to=${endIso}&pageSize=1000`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<BranchReport>) : null))
      .then((data) => setReport(data))
      .catch(() => {})
    return () => controller.abort()
  }, [beginIso, endIso])

  // As Linko's stats/widget/branch: the branches the ledger keeps in the balance, with the ledger's own figures.
  const rows = useMemo(() => {
    const list = report?.rows ?? []
    if (!sort) return list
    const value = (row: BranchRow) => row.currencies[sort.currency]?.[sort.field] ?? 0
    return [...list].sort((a, b) => (sort.dir === "asc" ? value(a) - value(b) : value(b) - value(a)))
  }, [report, sort])

  // The summary strip adds up the listed branches only (the reference does not count the others).
  const totals = useMemo(() => {
    const sums: Record<string, Amounts> = {}
    for (const row of rows) {
      for (const [code, figures] of Object.entries(row.currencies)) {
        const target = (sums[code] ??= {})
        for (const [field, value] of Object.entries(figures)) target[field] = (target[field] ?? 0) + value
      }
    }
    return sums
  }, [rows])

  const toggleSort = (field: string, currency: string) =>
    setSort((current) => (current?.field === field && current.currency === currency ? { field, currency, dir: current.dir === "asc" ? "desc" : "asc" } : { field, currency, dir: "asc" }))

  const summaryCurrencies = [...(report?.visibleCurrencies ?? ["SUM"])].sort()
  const labelOf = (code: string) => report?.currencies.find((currency) => currency.code === code)?.label ?? code
  const summaryText = (field: string) => summaryCurrencies.map((code) => `${formatAmount(totals[code]?.[field] ?? 0)} ${labelOf(code)}`).join(", ")
  const shown = expanded ? rows : rows.slice(0, COLLAPSED_ROWS)

  return (
    <ReportPage>
      <WidgetHeader active="ФИЛИАЛ" />
      <WidgetUserCard period={period} onPeriod={(value) => setPeriod(value as PeriodKey)} range={label} />

      <section className={`relative mx-[30px] mt-[30px] h-[365px] rounded-[10px] bg-white ${CARD_SHADOW}`}>
        {[5, 4, 3, 2, 1, 0].map((tick, index) => (
          <div key={tick} className="absolute left-[14px] right-[49px] border-t border-[#e0e0e0]" style={{ top: 28 + index * 56.4 }}>
            <span className="absolute -top-[8px] left-[calc(100%+9px)] text-[11px] text-[#373d3f]">{tick}</span>
          </div>
        ))}
      </section>
      <div className="mx-[30px]">
        <ToggleButtons
          tone="blue"
          value={chartMode}
          onChange={setChartMode}
          options={[{ value: "type", label: t("Тип продукта") }, { value: "brand", label: t("Бренд") }] as const}
        />
      </div>

      <section className={`mx-[30px] mt-[40px] overflow-hidden rounded-[10px] bg-white ${CARD_SHADOW}`}>
        <div className="grid grid-cols-7">
          {GROUPS.map((group) => (
            <div key={group.field} className="flex h-[83.8px] flex-col items-center px-[15px] pt-[15px] text-center">
              <div className={`text-[15px] font-semibold leading-[18.75px] ${group.tone}`}>{summaryText(group.field)}</div>
              <div className="text-[13px] leading-[18px] text-[#666]">{t(group.summary)}</div>
            </div>
          ))}
        </div>
        <table className="w-full table-fixed border-collapse text-[13px] text-[#333]">
          <colgroup>
            {columnWidths.map((width, index) => <col key={index} style={{ width: `${(width / 1440) * 100}%` }} />)}
          </colgroup>
          <thead className="bg-[#f0f4f9] text-left font-semibold text-[#374557]">
            <tr className="h-[35.1px]">
              <th rowSpan={2} className="px-[17.5px] align-middle font-semibold">{t("Филиал")}</th>
              {GROUPS.map((group) => <th key={group.field} colSpan={tableCurrencies.length} className="border-l border-white px-[17.5px] font-semibold">{t(group.head)}</th>)}
            </tr>
            <tr className="h-[35.6px]">
              {GROUPS.flatMap((group) =>
                tableCurrencies.map((currency) => (
                  <th key={`${group.field}-${currency}`} onClick={() => toggleSort(group.field, currency)} className="cursor-pointer select-none border-l border-white px-[17.5px] font-semibold">
                    {currencyLabel(currency)}
                    <SortArrows />
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.key} className="h-[41.6px] border-b border-[#eee]">
                <td className="border-r border-[#eee] px-[17.5px]">{row.name}</td>
                {GROUPS.flatMap((group) =>
                  tableCurrencies.map((currency) => {
                    const value = row.currencies[currency]?.[group.field] ?? 0
                    return <td key={`${group.field}-${currency}`} className={`px-[17.5px] ${signedColor(value)}`}>{formatAmount(value)}</td>
                  }),
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > COLLAPSED_ROWS && <MoreButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />}
      </section>

      <WarehouseOverview data={overview.data} />
      <div className="mt-[36px]"><CashOverview data={overview.data} /></div>
      <div className="h-[30px]" />
    </ReportPage>
  )
}
