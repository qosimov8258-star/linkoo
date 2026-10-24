"use client"

import { useEffect, useMemo, useState } from "react"
import { CashOverview, WarehouseOverview } from "@/components/analytics/balance-sections"
import { MoreButton, SortArrows, ToggleButtons, formatAmount, signedColor, useWidgetPeriod } from "@/components/analytics/widget-table-kit"
import { ReportPage, WidgetHeader, WidgetUserCard } from "@/components/ref/report-kit"
import type { PeriodKey } from "@/lib/dashboard-date-range"
import { useLanguage } from "@/lib/i18n/language-context"

type Amounts = Record<string, number>
export type BranchRow = { key: string; name: string; currencies: Record<string, Amounts> }
export type ManualEntry = { id: number; branchId: number; kind: string; currency: string; amount: number; date: string; createdBy: string }
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

// Manual rows without an author are the balances carried over when the ledger was opened. Like the reference they feed the
// opening and closing balance (by their date) and are not "other income / expense" of the period; rows entered by a user are.
const CURRENCY_CODE: Record<string, string> = { sum: "SUM", usd: "USD", eur: "EUR", euro: "EUR" }

export function withRecordedBalances(row: BranchRow, entries: ManualEntry[], begin: string, end: string): BranchRow {
  const own = entries.filter((entry) => String(entry.branchId) === row.key)
  const carriedOver = entries.filter((entry) => !entry.createdBy).map((entry) => entry.date)
  const openedOn = carriedOver.length ? carriedOver.reduce((a, b) => (a > b ? a : b)) : ""
  const currencies: Record<string, Amounts> = {}
  for (const [code, figures] of Object.entries(row.currencies)) {
    const signed = (entry: ManualEntry) => (entry.kind === "expense" ? -Math.abs(entry.amount) : Math.abs(entry.amount))
    const mine = own.filter((entry) => (CURRENCY_CODE[entry.currency.toLowerCase()] ?? entry.currency.toUpperCase()) === code)
    const upTo = (limit: (date: string) => boolean) => mine.filter((entry) => limit(entry.date)).reduce((sum, entry) => sum + signed(entry), 0)
    const authored = mine.filter((entry) => entry.createdBy && entry.date >= begin && entry.date <= end)
    const plus = authored.filter((entry) => entry.kind !== "expense").reduce((sum, entry) => sum + signed(entry), 0)
    const minus = authored.filter((entry) => entry.kind === "expense").reduce((sum, entry) => sum + signed(entry), 0)
    const opening = upTo((date) => date < begin)
    // After the opening date the balance moves with the period's transfers and payments; before it the recorded balance is final.
    const moves = figures.stock_transfer_minus + figures.stock_transfer_plus + figures.payments + plus + minus
    currencies[code] = {
      ...figures,
      none_type_plus: plus,
      none_type_minus: minus,
      begin_balance: opening,
      end_balance: begin > openedOn ? opening + moves : upTo((date) => date <= end),
    }
  }
  return { ...row, currencies }
}

export function BranchTabView() {
  const { t } = useLanguage()
  const { period, setPeriod, beginIso, endIso, label } = useWidgetPeriod()
  const [report, setReport] = useState<BranchReport | null>(null)
  const [chartMode, setChartMode] = useState<"type" | "brand">("type")
  const [sort, setSort] = useState<{ field: string; currency: string; dir: "asc" | "desc" } | null>(null)
  const [expanded, setExpanded] = useState(false)
  // Like the reference, the table lists only branches that have manual balance entries, in the order of their first entry.
  const [entries, setEntries] = useState<ManualEntry[] | null>(null)

  useEffect(() => {
    fetch("/api/branch-balance-transactions")
      .then((response) => (response.ok ? (response.json() as Promise<ManualEntry[]>) : []))
      .then(setEntries)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/balances/branch?from=${beginIso}&to=${endIso}&pageSize=1000`, { signal: controller.signal })
      .then((response) => (response.ok ? (response.json() as Promise<BranchReport>) : null))
      .then((data) => setReport(data))
      .catch(() => {})
    return () => controller.abort()
  }, [beginIso, endIso])

  const entryOrder = useMemo(() => {
    if (!entries) return null
    const first = new Map<number, number>()
    for (const entry of entries) if (!first.has(entry.branchId) || entry.id < first.get(entry.branchId)!) first.set(entry.branchId, entry.id)
    return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([branchId]) => String(branchId))
  }, [entries])

  const rows = useMemo(() => {
    const all = report?.rows ?? []
    const listed = entryOrder ? entryOrder.map((key) => all.find((row) => row.key === key)).filter((row): row is BranchRow => !!row) : all
    const list = entries ? listed.map((row) => withRecordedBalances(row, entries, beginIso, endIso)) : listed
    if (!sort) return list
    const value = (row: BranchRow) => row.currencies[sort.currency]?.[sort.field] ?? 0
    return [...list].sort((a, b) => (sort.dir === "asc" ? value(a) - value(b) : value(b) - value(a)))
  }, [report, sort, entryOrder, entries, beginIso, endIso])

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
            {COLUMN_WIDTHS.map((width, index) => <col key={index} style={{ width: `${(width / 1440) * 100}%` }} />)}
          </colgroup>
          <thead className="bg-[#f0f4f9] text-left font-semibold text-[#374557]">
            <tr className="h-[35.1px]">
              <th rowSpan={2} className="px-[17.5px] align-middle font-semibold">{t("Филиал")}</th>
              {GROUPS.map((group) => <th key={group.field} colSpan={2} className="border-l border-white px-[17.5px] font-semibold">{t(group.head)}</th>)}
            </tr>
            <tr className="h-[35.6px]">
              {GROUPS.flatMap((group) =>
                TABLE_CURRENCIES.map((currency) => (
                  <th key={`${group.field}-${currency}`} onClick={() => toggleSort(group.field, currency)} className="cursor-pointer select-none border-l border-white px-[17.5px] font-semibold">
                    {currency}
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
                  TABLE_CURRENCIES.map((currency) => {
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

      <WarehouseOverview />
      <div className="mt-[36px]"><CashOverview /></div>
      <div className="h-[30px]" />
    </ReportPage>
  )
}
