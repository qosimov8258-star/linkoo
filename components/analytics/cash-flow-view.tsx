"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"

import { RefSearchSelect, type RefSelectItem } from "@/components/analytics/ref-search-select"
import { useLookup } from "@/components/analytics/balance/use-balance"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { RefHeader } from "@/components/ref/list-kit"
import type { CashFlowResult } from "@/lib/cash/flow-types"
import { formatRangeLabel, parseISODate } from "@/lib/dashboard-date-range"
import { currencyLabel } from "@/lib/finance/currency"
import { defaultBalancePeriod, isIsoDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { useRouter, useSearchParams } from "next/navigation"

// "Движения денежных средств" (demo #/cash-flow/?beginDate&endDate): a filter card (Организация | Филиалы | Касса | date range |
// Применить) over the cash flow statement of GET /api/cash/flow (lib/cash/flow.ts): opening balance, money in and out by
// article and month, transfers between cash desks, net flow and closing balance. (The reference account's own
// `stats/cashflow/` endpoint answers 404, so it always says "Нет данных"; a working company needs the statement.)
// The period and the filters live in the URL like the demo's hash route.
const CARD = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

type Named = { id: number; name: string }

const MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"]
const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const tone = (value: number) => (value > 0 ? "text-[#3aa76d]" : value < 0 ? "text-[#e5484d]" : "text-[#333]")

export function CashFlowView() {
  const { t } = useLanguage()
  const router = useRouter()
  const params = useSearchParams()
  const fallback = useMemo(() => defaultBalancePeriod(), [])
  const begin = params.get("beginDate")
  const end = params.get("endDate")
  const [range, setRange] = useState({ from: isIsoDay(begin) ? begin : fallback.from, to: isIsoDay(end) ? end : fallback.to })
  const [pickerOpen, setPickerOpen] = useState(false)
  const [organization, setOrganization] = useState<RefSelectItem[]>([])
  const [branch, setBranch] = useState<RefSelectItem[]>([])
  const [cashbox, setCashbox] = useState<RefSelectItem[]>([])
  const organizations = useLookup<Named>("/api/organizations")
  const branches = useLookup<Named>("/api/branches")
  const cashboxes = useLookup<Named>("/api/cashboxes")
  const items = (rows: Named[]): RefSelectItem[] => rows.map((row) => ({ value: String(row.id), label: row.name }))
  const [data, setData] = useState<CashFlowResult | null>(null)
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading")

  // The URL is the applied filter (Применить writes it): fetch the statement whenever it changes.
  const query = params.toString()
  useEffect(() => {
    const search = new URLSearchParams(query)
    const from = search.get("beginDate")
    const to = search.get("endDate")
    const api = new URLSearchParams({ from: isIsoDay(from) ? from : fallback.from, to: isIsoDay(to) ? to : fallback.to })
    for (const name of search.getAll("divisionName")) api.append("organization", name)
    for (const name of search.getAll("branchName")) api.append("branch", name)
    for (const id of search.getAll("cashbox")) api.append("cashbox", id)
    let cancelled = false
    setState("loading")
    fetch(`/api/cash/flow?${api}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((next: CashFlowResult) => {
        if (cancelled) return
        setData(next)
        setState("ready")
      })
      .catch(() => {
        if (!cancelled) setState("failed")
      })
    return () => {
      cancelled = true
    }
  }, [query, fallback])

  const apply = () => {
    const query = new URLSearchParams({ beginDate: range.from, endDate: range.to })
    for (const item of organization) {
      query.append("division", item.value)
      query.append("divisionName", item.label)
    }
    if (branch[0]) {
      query.set("branch", branch[0].value)
      query.set("branchName", branch[0].label)
    }
    if (cashbox[0]) query.set("cashbox", cashbox[0].value)
    router.replace(`/analytics/cash-flow?${query.toString()}`)
  }

  return (
    <main className="min-h-[calc(100vh-50px)] bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="pl-[28px] pr-[36px]">
        <RefHeader title={t("Движения денежных средств")} />
      </div>

      <section className={`relative mx-[28px] h-[78px] ${CARD}`}>
        <div className="absolute left-[30px] top-[4px] w-[327px]"><RefSearchSelect label={t("Организация")} items={items(organizations)} selected={organization} onChange={setOrganization} multi /></div>
        <div className="absolute left-[372px] top-[4px] w-[281px]"><RefSearchSelect label={t("Филиалы")} items={items(branches)} selected={branch} onChange={setBranch} /></div>
        <div className="absolute left-[668px] top-[4px] w-[280px]"><RefSearchSelect label={t("Касса")} items={items(cashboxes)} selected={cashbox} onChange={setCashbox} /></div>
        <div className="absolute left-[963px] top-[26px] h-[36px] w-[327px] border-b border-[#e8e8e8]">
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute left-0 top-[9px] text-[13px] text-black">
            {formatRangeLabel(parseISODate(range.from), parseISODate(range.to)).toLowerCase()}
          </button>
          {pickerOpen && (
            <DateRangePicker
              positionClassName="left-0 top-[36px]"
              begin={range.from}
              end={range.to}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setRange({ from, to })
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <button type="button" onClick={apply} className="absolute left-[1305px] top-[26px] h-[30px] rounded-[4px] bg-[#1E4A9A] px-[16px] text-[13px] font-bold uppercase text-white">
          {t("Применить")}
        </button>
      </section>

      {state !== "ready" || !data || !data.sections.some((section) => section.rows.length) ? (
        <section className="mx-[28px] mt-[16px] flex h-[130px] items-center justify-center rounded-[16px] bg-white">
          <span className="text-[14px] font-semibold text-[#a0a7b5]">{t(state === "loading" ? "Загрузка..." : state === "failed" ? "Не удалось загрузить данные" : "Нет данных")}</span>
        </section>
      ) : (
        <CashFlowTable data={data} />
      )}
    </main>
  )
}

function CashFlowTable({ data }: { data: CashFlowResult }) {
  const { t } = useLanguage()
  const currency = currencyLabel(data.baseCurrency)
  const monthLabel = (key: string) => `${t(MONTHS[Number(key.slice(5, 7)) - 1] ?? key)} ${key.slice(0, 4)}`
  const many = data.months.length > 1
  const cells = (values: Record<string, number>, total: number, bold = false) => (
    <>
      {many && data.months.map((month) => (
        <td key={month} className={`whitespace-nowrap px-[12px] py-[8px] text-right ${tone(values[month] ?? 0)} ${bold ? "font-bold" : ""}`}>{money(values[month] ?? 0)}</td>
      ))}
      <td className={`whitespace-nowrap px-[12px] py-[8px] text-right ${tone(total)} ${bold ? "font-bold" : "font-semibold"}`}>{money(total)}</td>
    </>
  )
  const balanceRow = (label: string, value: number) => (
    <tr className="bg-[#f7f9fc]">
      <td className="px-[16px] py-[10px] font-bold">{t(label)}</td>
      {many && data.months.map((month) => <td key={month} />)}
      <td className="whitespace-nowrap px-[12px] py-[10px] text-right font-bold">{money(value)} {currency}</td>
    </tr>
  )
  return (
    <section className="mx-[28px] mt-[16px] mb-[24px] overflow-x-auto rounded-[16px] bg-white">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[#e8e8e8] text-[12px] text-[#666]">
            <th className="px-[16px] py-[10px] text-left font-semibold">{t("Статья")}</th>
            {many && data.months.map((month) => <th key={month} className="px-[12px] py-[10px] text-right font-semibold">{monthLabel(month)}</th>)}
            <th className="px-[12px] py-[10px] text-right font-semibold">{t("Итого")}, {currency}</th>
          </tr>
        </thead>
        <tbody>
          {balanceRow("Баланс на начало периода", data.opening)}
          {data.sections.map((section) =>
            section.rows.length ? (
              <SectionRows key={section.key} title={section.title} rows={section.rows} totals={section.months} total={section.total} cells={cells} />
            ) : null,
          )}
          <tr className="border-t border-[#e8e8e8]">
            <td className="px-[16px] py-[10px] font-bold">{t("Чистый денежный поток")}</td>
            {cells(data.net, data.netTotal, true)}
          </tr>
          {balanceRow("Баланс на конец периода", data.closing)}
        </tbody>
      </table>
    </section>
  )
}

function SectionRows({
  title,
  rows,
  totals,
  total,
  cells,
}: {
  title: string
  rows: CashFlowResult["sections"][number]["rows"]
  totals: Record<string, number>
  total: number
  cells: (values: Record<string, number>, total: number, bold?: boolean) => ReactNode
}) {
  const { t } = useLanguage()
  return (
    <>
      <tr className="border-t border-[#e8e8e8] bg-[#fbfcfe]">
        <td className="px-[16px] py-[9px] font-bold uppercase text-[12px] text-[#1E4A9A]">{t(title)}</td>
        {cells(totals, total, true)}
      </tr>
      {rows.map((row) => (
        <tr key={row.name} className="border-t border-[#f0f0f0] hover:bg-[#f7f9fc]">
          <td className="py-[8px] pl-[32px] pr-[16px]">
            <span>{t(row.name)}</span>
            <span className="ml-[8px] text-[11px] text-[#a0a7b5]">({row.count})</span>
          </td>
          {cells(row.months, row.total)}
        </tr>
      ))}
    </>
  )
}
