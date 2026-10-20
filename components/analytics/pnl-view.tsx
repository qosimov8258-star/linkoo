"use client"

import { useEffect, useMemo, useState } from "react"
import { ReportPage, ReportRangeField, ReportSelectField, WidgetHeader } from "@/components/ref/report-kit"
import { currencyLabel } from "@/lib/finance/currency"
import { pnlMetrics, type PnlGroupRow, type PnlResult, type PnlTotals } from "@/lib/finance/pnl-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "P&L" widget: two periods side by side, computed on the server
// (GET /api/balances/pnl): Реализовано = released orders (В пути /
// Доставлено) by realization day, Возвраты = accepted client returns, cost of
// goods from the one cost of goods (lib/stock/costs.ts); every amount is in
// the base currency. Filter options are the factory's own branches, zones,
// agents, product types and products.

const metricTabs = ["РЕАЛИЗАЦИЯ", "ВОЗВРАТЫ", "ЧИСТАЯ РЕАЛИЗАЦИЯ", "ВАЛОВАЯ ПРИБЫЛЬ", "РЕНТАБЕЛЬНОСТЬ ВП"] as const
const sortModes = ["УБЫВАЮЩИЕ", "ВОЗРАСТАЮЩИЕ", "ВСЕ"] as const
type Metric = (typeof metricTabs)[number]

const number = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 2 }).format(value)

function pad(value: number) {
  return String(value).padStart(2, "0")
}
function toIso(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const metricValue = (totals: PnlTotals | undefined, metric: Metric) => {
  if (!totals) return 0
  const { net, profit, margin } = pnlMetrics(totals)
  if (metric === "РЕАЛИЗАЦИЯ") return totals.realization
  if (metric === "ВОЗВРАТЫ") return totals.returns
  if (metric === "ЧИСТАЯ РЕАЛИЗАЦИЯ") return net
  if (metric === "ВАЛОВАЯ ПРИБЫЛЬ") return profit
  return margin
}

function DiffCell({ first, second, plain }: { first: number; second: number; plain?: boolean }) {
  const diff = second - first
  const percent = first ? Math.round((diff / Math.abs(first)) * 100) : 0
  const tone = plain || diff === 0 ? "" : diff < 0 ? "bg-[#e57373] text-white" : "bg-[#8fcf8f] text-white"
  return (
    <div className={`flex h-full items-center justify-between px-[6px] font-semibold ${tone}`}>
      <span>{percent} %</span>
      <span>{number(diff)}</span>
    </div>
  )
}

function CompareTable({ title, rows, totalRow = true, className = "" }: { title: string; rows: { name: string; first: number; second: number }[]; totalRow?: boolean; className?: string }) {
  const { t } = useLanguage()
  const firstTotal = rows.reduce((sum, row) => sum + row.first, 0)
  const secondTotal = rows.reduce((sum, row) => sum + row.second, 0)
  return (
    <div className={`min-h-[140px] bg-white pb-[10px] shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] ${className}`}>
      <div className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center bg-[#f2f5f8] px-[6px] text-[13px] font-semibold">
        <span>{t(title)}</span><span>{t("Первый период")} ⇅</span><span>{t("Второй период")} ⇅</span><span>{t("Разница")} ⇅</span>
      </div>
      {rows.map((row) => (
        <div key={row.name} className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px]">
          <span className="truncate px-[6px]">{t(row.name)}</span><span className="border-l border-[#ececec] px-[6px]">{number(row.first)}</span><span className="border-l border-[#ececec] px-[6px]">{number(row.second)}</span><DiffCell first={row.first} second={row.second} />
        </div>
      ))}
      {totalRow && rows.length > 0 && (
        <div className="grid h-[36px] grid-cols-[1.3fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px] font-bold">
          <span className="px-[6px]">{t("Итого")}</span><span className="border-l border-[#ececec] px-[6px]">{number(firstTotal)}</span><span className="border-l border-[#ececec] px-[6px]">{number(secondTotal)}</span><DiffCell first={firstTotal} second={secondTotal} />
        </div>
      )}
    </div>
  )
}

export function PnLView() {
  const { t } = useLanguage()
  const today = useMemo(() => new Date(), [])
  const [firstFrom, setFirstFrom] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth() - 1, 1)))
  const [firstTo, setFirstTo] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth() - 1, Math.min(today.getDate(), 28))))
  const [secondFrom, setSecondFrom] = useState(() => toIso(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [secondTo, setSecondTo] = useState(() => toIso(today))

  const [branch, setBranch] = useState("")
  const [zone, setZone] = useState("")
  const [agent, setAgent] = useState("")
  const [productType, setProductType] = useState("")
  const [product, setProduct] = useState("")
  const [applied, setApplied] = useState(() => ({ firstFrom, firstTo, secondFrom, secondTo, branch, zone, agent, productType, product }))
  const [metric, setMetric] = useState<Metric>("РЕАЛИЗАЦИЯ")
  const [sortMode, setSortMode] = useState<(typeof sortModes)[number]>("ВСЕ")
  const [data, setData] = useState<PnlResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    const params = new URLSearchParams({ firstFrom: applied.firstFrom, firstTo: applied.firstTo, secondFrom: applied.secondFrom, secondTo: applied.secondTo })
    for (const [name, value] of [["branch", applied.branch], ["zone", applied.zone], ["agent", applied.agent], ["productType", applied.productType], ["product", applied.product]] as const) {
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

  const rowsOf = (list: PnlGroupRow[] | undefined) => {
    const rows = (list ?? []).map((row) => ({ name: row.name, first: metricValue(row.periods[0], metric), second: metricValue(row.periods[1], metric) }))
    if (sortMode === "ВСЕ") return rows
    return rows.sort((a, b) => (sortMode === "УБЫВАЮЩИЕ" ? b.second - a.second : a.second - b.second))
  }

  const [first, second] = [data?.totals[0], data?.totals[1]]
  const line = (name: string, pick: (totals: PnlTotals) => number) => ({ name, first: first ? pick(first) : 0, second: second ? pick(second) : 0 })
  const lines = [
    line("Реализовано", (x) => x.realization),
    line("Себестоимость реализованной продукции", (x) => x.cost),
    line("Возвраты", (x) => x.returns),
    line("Себестоимость возвратов", (x) => x.returnCost),
    line("Валовая прибыль", (x) => pnlMetrics(x).profit),
    line("Рентабельность ВП", (x) => pnlMetrics(x).margin),
  ]
  const options = data?.options
  const card = "bg-white shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]"

  return (
    <ReportPage>
      <WidgetHeader active="P&L" />

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (firstFrom > firstTo || secondFrom > secondTo) return
          setApplied({ firstFrom, firstTo, secondFrom, secondTo, branch, zone, agent, productType, product })
        }}
        className={`mx-7 px-[20px] pb-[22px] pt-[10px] ${card}`}
      >
        <h2 className="text-[14px] leading-[18px] text-[#666]">{t("Фильтр")}</h2>
        <div className="mt-[4px] grid gap-x-[10px] gap-y-[13px] md:grid-cols-2 xl:grid-cols-4">
          <ReportRangeField label="Первый период" from={firstFrom} to={firstTo} onFrom={setFirstFrom} onTo={setFirstTo} />
          <ReportRangeField label="Второй период" from={secondFrom} to={secondTo} onFrom={setSecondFrom} onTo={setSecondTo} />
          <ReportSelectField label="Филиалы" value={branch} onChange={setBranch} options={options?.branches ?? []} />
          <ReportSelectField label="Зона" value={zone} onChange={setZone} options={options?.zones ?? []} />
          <ReportSelectField label="Агент" value={agent} onChange={setAgent} options={options?.agents ?? []} />
          <ReportSelectField label="Тип товара" value={productType} onChange={setProductType} options={options?.productTypes ?? []} />
          <ReportSelectField label="Товар" value={product} onChange={setProduct} options={options?.products ?? []} />
        </div>
        <button type="submit" disabled={firstFrom > firstTo || secondFrom > secondTo} className="mt-[12px] h-9 rounded-[3px] bg-[#5d6474] px-[16px] text-[13px] font-semibold uppercase text-white shadow-[0_2px_5px_rgba(0,0,0,0.25)] hover:brightness-110 disabled:opacity-50">{t("Применить")}</button>
        <p className="mt-[8px] text-[12px] text-[#666]">
          {t("Суммы в основной валюте")}: {currencyLabel(data?.baseCurrency ?? "SUM")}
          {loading ? ` · ${t("Загрузка...")}` : ""}
        </p>
        {Boolean(data?.missingRates.length) && (
          <p className="mt-[4px] text-[12px] text-[#e57373]">
            {t("Нет курса валюты, суммы не учтены")}: {data!.missingRates.map(currencyLabel).join(", ")}
          </p>
        )}
        {error && <p className="mt-[4px] text-[12px] text-[#e57373]">{t(error)}</p>}
      </form>

      <section className="mx-7 mt-[20px] flex flex-wrap items-center">
        <div className="flex">
          {metricTabs.map((tab, index) => (
            <button key={tab} onClick={() => setMetric(tab)} className={`h-[30px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === metricTabs.length - 1 ? "rounded-r-[3px]" : ""} ${metric === tab ? "border-[#4f71dc] bg-[#4f71dc] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(tab)}</button>
          ))}
        </div>
        <div className="ml-auto flex">
          {sortModes.map((mode, index) => (
            <button key={mode} onClick={() => setSortMode(mode)} className={`h-[30px] border px-[16px] text-[13px] font-medium transition-colors ${index === 0 ? "rounded-l-[3px]" : ""} ${index === sortModes.length - 1 ? "rounded-r-[3px]" : ""} ${sortMode === mode ? "border-[#2bcd53] bg-[#2bcd53] text-white" : "border-[#e8e8e8] bg-white text-black hover:bg-[#f2f5f8]"}`}>{t(mode)}</button>
          ))}
        </div>
      </section>

      <section className="mx-7 mt-[20px] grid gap-[17px] pb-8 lg:grid-cols-2">
        <div className="space-y-[30px]">
          <CompareTable title="Филиал" rows={rowsOf(data?.groups.branch)} totalRow={metric !== "РЕНТАБЕЛЬНОСТЬ ВП"} />
          <div className={`pb-[6px] ${card}`}>
            <div className="grid h-[36px] grid-cols-[1.6fr_1fr_1fr_1.3fr] items-center bg-[#f2f5f8] px-[6px] text-[13px] font-semibold"><span>{t("Наименование")}</span><span>{t("Первый период")}</span><span>{t("Второй период")}</span><span>{t("Разница")}</span></div>
            {lines.map((item, index) => (
              <div key={item.name} className="grid min-h-[36px] grid-cols-[1.6fr_1fr_1fr_1.3fr] items-center border-t border-[#ececec] text-[13px]">
                <span className="px-[6px] py-[6px]">{t(item.name)}</span>
                <span className="border-l border-[#ececec] px-[6px]">{number(item.first)}</span>
                <span className="border-l border-[#ececec] px-[6px]">{number(item.second)}</span>
                <DiffCell first={item.first} second={item.second} plain={index === 2 || index === 3} />
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-[30px]">
          <CompareTable title="Агент" rows={rowsOf(data?.groups.agent)} totalRow={metric !== "РЕНТАБЕЛЬНОСТЬ ВП"} />
          <CompareTable title="Тип продукта" rows={rowsOf(data?.groups.productType)} totalRow={metric !== "РЕНТАБЕЛЬНОСТЬ ВП"} />
          <CompareTable title="Бренд" rows={rowsOf(data?.groups.brand)} totalRow={metric !== "РЕНТАБЕЛЬНОСТЬ ВП"} />
          <CompareTable title="Зона" rows={rowsOf(data?.groups.zone)} totalRow={metric !== "РЕНТАБЕЛЬНОСТЬ ВП"} />
        </div>
      </section>
    </ReportPage>
  )
}
