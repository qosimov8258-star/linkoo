"use client"

import { useEffect, useMemo, useState } from "react"

import { ReportBand, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportRangeField, ReportSelectField } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { monthStartIso, todayIso } from "@/lib/finance/dates"
import { pnlMetrics, type PnlResult, type PnlTotals } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Прибыль по типам продуктов": realization, returns, cost of goods and gross
// profit per product type of one period, from the server P&L
// (GET /api/balances/pnl, groups.productType): released orders by realization
// day, accepted client returns, cost from the one cost of goods; every amount
// is in the base currency.

const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

type Row = { name: string; totals: PnlTotals }

const EMPTY: PnlTotals = { realization: 0, returns: 0, cost: 0, returnCost: 0, quantity: 0 }

export function ProductTypeProfitView() {
  const { t } = useLanguage()
  const [from, setFrom] = useState(() => monthStartIso())
  const [to, setTo] = useState(() => todayIso())
  const [branch, setBranch] = useState("")
  const [agent, setAgent] = useState("")
  const [brand, setBrand] = useState("")
  const [applied, setApplied] = useState(() => ({ from, to, branch, agent, brand }))
  const [data, setData] = useState<PnlResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    // One period: the P&L endpoint compares two, so both are the chosen one.
    const params = new URLSearchParams({ firstFrom: applied.from, firstTo: applied.to, secondFrom: applied.from, secondTo: applied.to })
    for (const [name, value] of [["branch", applied.branch], ["agent", applied.agent], ["brand", applied.brand]] as const) {
      if (value) params.append(name, value)
    }
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(`/api/balances/pnl?${params.toString()}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (PnlResult & { error?: string }) | null
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

  const rows: Row[] = useMemo(
    () =>
      (data?.groups.productType ?? [])
        .map((row) => ({ name: row.name, totals: row.periods[0] ?? EMPTY }))
        .filter((row) => row.totals.realization || row.totals.returns || row.totals.cost || row.totals.returnCost)
        .sort((a, b) => pnlMetrics(b.totals).profit - pnlMetrics(a.totals).profit),
    [data],
  )
  const total = data?.totals[0] ?? EMPTY
  const base = currencyLabel(data?.baseCurrency ?? "SUM")
  const options = data?.options

  const headers = [
    t("Тип продукта"),
    t("Реализовано"),
    t("Возвраты"),
    t("Чистая реализация"),
    t("Себестоимость реализованной продукции"),
    t("Себестоимость возвратов"),
    t("Валовая прибыль"),
    `${t("Рентабельность ВП")}, %`,
  ]
  const cells = (name: string, totals: PnlTotals) => {
    const { net, profit, margin } = pnlMetrics(totals)
    return [name, totals.realization, totals.returns, net, totals.cost, totals.returnCost, profit, margin] as const
  }
  const exportExcel = () =>
    downloadExcelTable("product-type-profit.xls", [headers, ...rows.map((row) => [...cells(row.name, row.totals)]), [...cells(t("Итого"), total)]])

  return (
    <ReportPage>
      <ReportHeader title={t("Прибыль по типам продуктов")} onExcel={rows.length ? exportExcel : undefined} />
      <ReportBand>
        <ReportFilters onApply={() => from <= to && setApplied({ from, to, branch, agent, brand })} applyDisabled={from > to}>
          <ReportRangeField label="Период" from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={options?.branches ?? []} />
          <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={options?.agents ?? []} />
          <ReportSelectField label="Бренд" value={brand} onChange={setBrand} options={options?.brands ?? []} />
        </ReportFilters>
        <p className="mb-[10px] mt-[8px] text-[12px] text-[#666]">
          {t("Суммы в основной валюте")}: {base}
          {loading ? ` · ${t("Загрузка...")}` : ""}
          {error ? ` · ${t(error)}` : ""}
          {data?.missingRates.length ? ` · ${t("Нет курса валюты, суммы не учтены")}: ${data.missingRates.map(currencyLabel).join(", ")}` : ""}
        </p>
      </ReportBand>

      <section className="mx-[30px] mb-[30px] mt-[20px] overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        {rows.length ? (
          <table className="w-full min-w-[1000px] border-collapse text-[13px]">
            <thead className="bg-[#f2f5f8]">
              <tr className="h-[40px]">
                {headers.map((header, index) => (
                  <th key={header} className={`px-[10px] font-semibold ${index ? "text-right" : "text-left"}`}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="h-[38px] border-t border-[#efefef]">
                  {cells(row.name, row.totals).map((cell, index) => (
                    <td key={index} className={`px-[10px] ${index ? "text-right" : ""} ${index === 6 ? (Number(cell) < 0 ? "font-semibold text-[#e5484d]" : "font-semibold text-[#3aa76d]") : ""}`}>
                      {typeof cell === "number" ? money(cell) : t(cell)}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="h-[40px] border-t border-[#d9d9d9] bg-[#f2f5f8] font-bold">
                {cells(t("Итого"), total).map((cell, index) => (
                  <td key={index} className={`px-[10px] ${index ? "text-right" : ""}`}>{typeof cell === "number" ? money(cell) : cell}</td>
                ))}
              </tr>
            </tbody>
          </table>
        ) : (
          <ReportEmpty text={loading ? t("Загрузка...") : t("Нет данных")} />
        )}
      </section>
    </ReportPage>
  )
}
