"use client"

import { useEffect, useMemo, useState } from "react"

import { ReportBand, ReportChipField, ReportEmpty, ReportFilters, ReportHeader, ReportPage, ReportRangeField, ReportSelectField } from "@/components/ref/report-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { monthStartIso, todayIso } from "@/lib/finance/dates"
import { pnlMetrics, type PnlResult, type PnlTotals } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Прибыль от товаров" / "Прибыль от агентов": realization, returns, cost of goods
// and gross profit of one period per product / brand / branch (or agent / branch /
// zone), from the server P&L (GET /api/balances/pnl): released orders by
// realization day, accepted client returns, the one cost of goods; every amount is
// in the base currency.

type GroupKey = keyof PnlResult["groups"]
type ProfitReportProps = {
  title: string
  file: string
  /** Grouping choices: [label, P&L group]. */
  groups: ReadonlyArray<readonly [string, GroupKey]>
  /** The second filter next to "Филиалы". */
  secondFilter: "brand" | "agent"
}

const PRODUCT_GROUPS = [
  ["По продукту", "product"],
  ["По бренду", "brand"],
  ["По филиалу", "branch"],
] as const
const AGENT_GROUPS = [
  ["По агенту", "agent"],
  ["По филиалу", "branch"],
  ["По зоне", "zone"],
] as const
const NAME_HEADER: Record<GroupKey, string> = { product: "Товар", brand: "Бренд", branch: "Филиал", agent: "Агент", zone: "Зона", productType: "Тип продукта" }

const EMPTY: PnlTotals = { realization: 0, returns: 0, cost: 0, returnCost: 0, quantity: 0 }
const money = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

export function ProductProfitView() {
  return <ProfitReportView title="Прибыль от товаров" file="product-profit.xls" groups={PRODUCT_GROUPS} secondFilter="brand" />
}

export function AgentProfitReportView() {
  return <ProfitReportView title="Прибыль от агентов" file="agent-profit.xls" groups={AGENT_GROUPS} secondFilter="agent" />
}

function ProfitReportView({ title, file, groups, secondFilter }: ProfitReportProps) {
  const { t } = useLanguage()
  const [from, setFrom] = useState(() => monthStartIso())
  const [to, setTo] = useState(() => todayIso())
  const [branch, setBranch] = useState("")
  const [second, setSecond] = useState("")
  const [applied, setApplied] = useState(() => ({ from, to, branch, second }))
  const [group, setGroup] = useState<string>(groups[0][0])
  const [query, setQuery] = useState("")
  const [data, setData] = useState<PnlResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    // One period: the P&L endpoint compares two, so both are the chosen one.
    const params = new URLSearchParams({ firstFrom: applied.from, firstTo: applied.to, secondFrom: applied.from, secondTo: applied.to })
    if (applied.branch) params.append("branch", applied.branch)
    if (applied.second) params.append(secondFilter, applied.second)
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
  }, [applied, secondFilter])

  const groupKey: GroupKey = groups.find(([label]) => label === group)?.[1] ?? groups[0][1]
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (data?.groups[groupKey] ?? [])
      .map((row) => ({ name: row.name, totals: row.periods[0] ?? EMPTY }))
      .filter((row) => row.totals.realization || row.totals.returns || row.totals.cost || row.totals.returnCost)
      .filter((row) => !needle || row.name.toLowerCase().includes(needle))
      .sort((a, b) => pnlMetrics(b.totals).profit - pnlMetrics(a.totals).profit)
  }, [data, groupKey, query])
  const total = rows.reduce<PnlTotals>(
    (sum, row) => ({
      realization: sum.realization + row.totals.realization,
      returns: sum.returns + row.totals.returns,
      cost: sum.cost + row.totals.cost,
      returnCost: sum.returnCost + row.totals.returnCost,
      quantity: sum.quantity + row.totals.quantity,
    }),
    EMPTY,
  )
  const totalMetrics = pnlMetrics(total)
  const base = currencyLabel(data?.baseCurrency ?? "SUM")

  const headers = [t(NAME_HEADER[groupKey]), t("Продажа"), t("Возврат в этом периоде"), t("Фактическая продажа"), t("Себестоимость"), t("Прибыль от продаж"), `${t("Рентабельность ВП")}, %`]
  const cells = (name: string, totals: PnlTotals) => {
    const { net, profit, margin } = pnlMetrics(totals)
    return [name, totals.realization, totals.returns, net, totals.cost - totals.returnCost, profit, margin] as const
  }
  const exportExcel = () => downloadExcelTable(file, [headers, ...rows.map((row) => [...cells(row.name, row.totals)]), [...cells(t("Итого"), total)]])

  return (
    <ReportPage>
      <ReportHeader title={t(title)} onExcel={rows.length ? exportExcel : undefined} />
      <ReportBand>
        <ReportFilters onApply={() => from <= to && setApplied({ from, to, branch, second })} applyDisabled={from > to}>
          <ReportRangeField label="Период" from={from} to={to} onFrom={setFrom} onTo={setTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={data?.options.branches ?? []} />
          <ReportSelectField
            label={secondFilter === "brand" ? "Бренд" : "Агент"}
            value={second}
            onChange={setSecond}
            options={(secondFilter === "brand" ? data?.options.brands : data?.options.agents) ?? []}
          />
          <ReportChipField label="Группировка" value={group} options={groups.map(([label]) => label)} onChange={setGroup} compact />
        </ReportFilters>
        <div className="mt-[16px] grid grid-cols-1 gap-3 lg:grid-cols-4">
          {(
            [
              ["Сумма от продаж", total.realization],
              ["Сумма возвратов", total.returns],
              ["Фактические продажи", totalMetrics.net],
              ["Прибыль от продаж", totalMetrics.profit],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="border bg-white p-4 text-right">
              <p className="text-slate-500">{t(label)}</p>
              <strong className="text-xl">
                {money(value)} {base}
              </strong>
            </div>
          ))}
        </div>
        <div className="mt-[16px] flex flex-wrap items-end gap-6">
          <label className="relative w-[500px] max-w-full">
            <span className="font-semibold">{t("Поиск")}</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} className="mt-1 w-full border-b bg-transparent py-2 outline-none" />
          </label>
          <p className="ml-auto text-[13px] text-[#4f71dc]">
            ⓘ {t("В этом отчете показываются только реализованные заказы и возвраты")}
            {loading ? ` · ${t("Загрузка...")}` : ""}
            {error ? ` · ${t(error)}` : ""}
            {data?.missingRates.length ? ` · ${t("Нет курса валюты, суммы не учтены")}: ${data.missingRates.map(currencyLabel).join(", ")}` : ""}
          </p>
        </div>
      </ReportBand>

      <section className="mx-[30px] mb-[30px] mt-[20px] overflow-x-auto bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]">
        {rows.length ? (
          <table className="w-full min-w-[1000px] border-collapse text-[13px]">
            <thead className="bg-[#edf2f7]">
              <tr className="h-[40px]">
                {headers.map((header, index) => (
                  <th key={header} className={`px-[10px] font-semibold ${index ? "text-right" : "text-left"}`}>
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.name} className="h-[38px] border-t border-[#efefef]">
                  {cells(row.name, row.totals).map((cell, index) => (
                    <td key={index} className={`px-[10px] ${index ? "text-right" : ""} ${index === 5 ? (Number(cell) < 0 ? "font-semibold text-[#e5484d]" : "font-semibold text-[#3aa76d]") : ""}`}>
                      {typeof cell === "number" ? money(cell) : cell}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="h-[40px] border-t border-[#d9d9d9] bg-[#edf2f7] font-bold">
                {cells(t("Итого"), total).map((cell, index) => (
                  <td key={index} className={`px-[10px] ${index ? "text-right" : ""}`}>
                    {typeof cell === "number" ? money(cell) : cell}
                  </td>
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
