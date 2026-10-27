"use client"

import { useEffect, useMemo, useState } from "react"
import { downloadExcelTable } from "@/lib/excel-export"
import { DashboardDialog } from "./dashboard-dialog"
import { ReportBand, ReportDateField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportSelectField } from "@/components/ref/report-kit"
import { useDirectoryNames } from "@/components/clients/use-directory"
import { currencyLabel } from "@/lib/finance/currency"
import type { BalanceListResult } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Продажа и оплата по магазинам": per store, the sales, returns and payments of
// the period from the client ledger (GET /api/balances/client — the same numbers
// as Баланс клиентов), in the base currency. The filters are the factory's own
// directories and are sent to the ledger as real filters.

type StoreRow = { store: string; sale: number; returned: number; payment: number }

const COLUMNS = ["Продажа", "Оплата", "Возврат"] as const
type FilterKey = "responsible" | "organization" | "storeType" | "zone" | "branch" | "column"
const EMPTY_FILTERS: Record<FilterKey, string> = { responsible: "", organization: "", storeType: "", zone: "", branch: "", column: "" }

function iso(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function ClientSalesPaymentsView() {
  const { t } = useLanguage()
  const now = useMemo(() => new Date(), [])
  const [from, setFrom] = useState(() => iso(new Date(now.getFullYear(), now.getMonth(), 1)))
  const [to, setTo] = useState(() => iso(now))
  const [filters, setFilters] = useState<Record<FilterKey, string>>(EMPTY_FILTERS)
  const [applied, setApplied] = useState(() => ({ from, to, ...EMPTY_FILTERS }))
  const [data, setData] = useState<BalanceListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [dashboardOpen, setDashboardOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [visibility, setVisibility] = useState("all")
  const [dashboard, setDashboard] = useState("Основной дашборд")

  const options: Record<FilterKey, string[]> = {
    responsible: useDirectoryNames("employees"),
    organization: useDirectoryNames("organizations"),
    storeType: useDirectoryNames("clientTypes"),
    zone: useDirectoryNames("zones"),
    branch: useDirectoryNames("branches"),
    column: [...COLUMNS],
  }

  useEffect(() => {
    const params = new URLSearchParams({ from: applied.from, to: applied.to, pageSize: "0" })
    const sent: Array<[string, string]> = [
      ["agent", applied.responsible],
      ["organization", applied.organization],
      ["clientType", applied.storeType],
      ["zone", applied.zone],
      ["branch", applied.branch],
    ]
    for (const [name, value] of sent) if (value) params.append(name, value)
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(`/api/balances/client?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || "Не удалось загрузить данные")
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [applied])

  const base = data?.baseCurrency ?? ""
  const rows = useMemo<StoreRow[]>(() => {
    const list = (data?.rows ?? []).map((row) => {
      const money = row.currencies[base] ?? ({} as Record<string, number>)
      // order is booked negative (the client owes), returns / payments positive.
      return { store: row.name, sale: -(Number(money.order) || 0), returned: Number(money.order_return) || 0, payment: Number(money.payment) || 0 }
    })
    const column = applied.column
    return list
      .filter((row) => (column === "Продажа" ? row.sale : column === "Оплата" ? row.payment : column === "Возврат" ? row.returned : row.sale || row.returned || row.payment))
      .sort((a, b) => b.sale - a.sale || a.store.localeCompare(b.store, "ru"))
  }, [data, base, applied.column])

  const totals = rows.reduce((sum, row) => ({ sale: sum.sale + row.sale, returned: sum.returned + row.returned, payment: sum.payment + row.payment }), { sale: 0, returned: 0, payment: 0 })
  const heads = ["Магазин", "Продажа", "Возврат", "Факт продаж", "Оплата"].map((title) => t(title))
  const cells = (row: Omit<StoreRow, "store">) => [row.sale, row.returned, row.sale - row.returned, row.payment]

  function setFilter(key: FilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: value }))
  }
  function download() {
    downloadExcelTable("client-sales-payments.xls", [heads, ...rows.map((row) => [row.store, ...cells(row)]), [t("Итого"), ...cells(totals)]])
  }

  return (
    <ReportPage>
      <ReportHeader title={t("Продажа и оплата по магазинам")} onExcel={rows.length ? download : undefined} onDashboard={() => setDashboardOpen(true)} inDashboard={saved} />

      <ReportBand>
        <ReportFilters applyDisabled={from > to} onApply={() => from <= to && setApplied({ from, to, ...filters })}>
          <ReportDateField label="Дата от" value={from} max={to} onChange={setFrom} />
          <ReportDateField label="Дата до" value={to} min={from} onChange={setTo} />
          {(Object.keys(labels) as FilterKey[]).map((key) => (
            <ReportSelectField key={key} label={labels[key]} value={filters[key]} onChange={(value) => setFilter(key, value)} options={options[key]} />
          ))}
        </ReportFilters>
        <p className="mt-[8px] text-[12px] text-[#666]">
          {base ? `${t("Суммы в основной валюте")}: ${currencyLabel(base)}` : ""}
          {loading ? ` · ${t("Загрузка...")}` : ""}
          {error ? ` · ${t(error)}` : ""}
        </p>

        {rows.length === 0 ? (
          <ReportEmpty text={loading ? t("Загрузка...") : undefined} />
        ) : (
          <section className="mt-5 overflow-x-auto bg-white">
            <table className="w-full min-w-[900px] border-collapse text-[13px]">
              <thead className="bg-[#5d6474] text-white">
                <tr>{heads.map((title, index) => <th key={title} className={`px-[10px] py-[10px] ${index ? "text-right" : "text-left"}`}>{title}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.store} className="border-t border-[#efefef]">
                    <td className="px-[10px] py-[8px]">{row.store}</td>
                    {cells(row).map((value, index) => <td key={index} className="px-[10px] py-[8px] text-right">{format(value)}</td>)}
                  </tr>
                ))}
                <tr className="border-t border-[#d9d9d9] font-bold">
                  <td className="px-[10px] py-[8px]">{t("Итого")}</td>
                  {cells(totals).map((value, index) => <td key={index} className="px-[10px] py-[8px] text-right">{format(value)}</td>)}
                </tr>
              </tbody>
            </table>
          </section>
        )}
      </ReportBand>

      {dashboardOpen && <button type="button" aria-label={t("Закрыть")} onClick={() => setDashboardOpen(false)} className="fixed inset-0 z-[90] bg-black/55" />}
      {dashboardOpen && (
        <DashboardDialog
          reportSlug="client-sales-payments"
          reportLabel="Оплаты от клиентов"
          visibility={visibility}
          setVisibility={setVisibility}
          dashboard={dashboard}
          setDashboard={setDashboard}
          onClose={() => setDashboardOpen(false)}
          onSave={() => setSaved(true)}
        />
      )}
    </ReportPage>
  )
}

const labels: Record<FilterKey, string> = { responsible: "Отв.агент магазина", organization: "Организация", storeType: "Тип магазина", zone: "Зона", branch: "Филиал", column: "Колонка" }
function format(value: number) {
  return value.toLocaleString("ru-RU", { maximumFractionDigits: 2 })
}
