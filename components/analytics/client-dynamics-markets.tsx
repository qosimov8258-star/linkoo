"use client"

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"

import { RI, RefButton, RefNothingFound, usePaging } from "@/components/ref/list-kit"
import { ReportPager, ReportSearchField } from "@/components/ref/report-kit"
import { SortArrows, nextSort, sortBy, type SortState } from "@/components/ref/sort-arrows"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's «Классификация и динамика клиентов» drill-down: a store count opens the stores of that class and period
// under the table (market_classification/get_markets); a store's name opens its card, its «Ассортимент» what it
// bought (market_classification/get_products) in a full-screen window. The page keeps all three in the URL.

type MarketCell = { sale: number; sku: number; visits: number; successVisits: number }
type Market = { id: number; name: string; periods: [MarketCell, MarketCell, MarketCell] }
export type PeriodIndex = 0 | 1 | 2
/** The «Ассортимент» window: the store and the period whose cell was clicked (Linko's marketId / listPeriod). */
export type ProductsTarget = { id: number; name: string; period: PeriodIndex }
type ProductRow = { key: string; name: string; values: [number, number, number]; dynamics: [number, number] }

const PERIOD_PARAM = ["first", "second", "third"] as const
const GROUPS: { metric: keyof MarketCell; title: string }[] = [
  { metric: "sale", title: "Продажа" },
  { metric: "sku", title: "Ассортимент" },
  { metric: "visits", title: "Визит" },
  { metric: "successVisits", title: "Успешный визит" },
]

const format = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/ /g, " ")

export function ClassificationMarkets({
  query,
  period,
  bucket,
  title,
  onOpenShop,
  products,
  onOpenProducts,
  onCloseProducts,
}: {
  query: string
  period: PeriodIndex
  bucket: number
  /** The class and its period, for the downloaded file. */
  title: string
  onOpenShop: (id: number) => void
  products: ProductsTarget | null
  onOpenProducts: (target: ProductsTarget) => void
  onCloseProducts: () => void
}) {
  const { t } = useLanguage()
  const [markets, setMarkets] = useState<Market[] | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortState<string>>(null)

  useEffect(() => {
    let cancelled = false
    setMarkets(null)
    fetch(`/api/client-classification?${query}&markets=1&period=${PERIOD_PARAM[period]}&bucket=${bucket}`)
      .then((response) => (response.ok ? (response.json() as Promise<Market[]>) : []))
      .then((data) => {
        if (!cancelled) setMarkets(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setMarkets([])
      })
    return () => {
      cancelled = true
    }
  }, [query, period, bucket])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (markets ?? []).filter((market) => !needle || market.name.toLowerCase().includes(needle))
    return sortBy(list, sort, (market, key) => {
      if (key === "name") return market.name
      const [metric, index] = key.split(":")
      return market.periods[Number(index)][metric as keyof MarketCell]
    })
  }, [markets, search, sort])
  const paging = usePaging(filtered.length)
  const pageRows = filtered.slice(paging.start, paging.end)

  // Linko's «Скачать» of the list: an Excel of its stores (the search applied), the table's two header rows.
  function exportList() {
    const groups = [t("Клиент"), ...GROUPS.flatMap((group) => [t(group.title), "", ""])]
    const periods = ["", ...GROUPS.flatMap(() => [1, 2, 3].map((n) => `${t("Период")} ${n}`))]
    const body = filtered.map((market) => [market.name, ...GROUPS.flatMap((group) => market.periods.map((cell) => Math.round(cell[group.metric])))])
    // A file name cannot hold < > : " / \ | ? * (the browser would put "_" for the class "< 1 млн").
    const name = `${t("Классификация и динамика клиентов")} - ${title}`.replace(/[<>:"/\\|?*]+/g, " ").replace(/\s+/g, " ").trim()
    downloadExcelTable(name, [groups, periods, ...body], { merges: ["A1:A2", "B1:D1", "E1:G1", "H1:J1", "K1:M1"] })
  }

  const th = "border border-[#ddd] px-[6px] py-[10px] text-center text-[13px] font-semibold text-[#333]"
  const head = (key: string, label: string) => (
    <button type="button" onClick={() => setSort((current) => nextSort(current, key))} className="inline-flex items-center justify-center gap-[2px] font-semibold">
      {label}
      <SortArrows dir={sort?.key === key ? sort.dir : null} />
    </button>
  )

  return (
    <section className="mx-7 mt-[40px]">
      <div className="mb-[18px] flex items-center justify-between">
        <RefButton icon={RI.chart} green label="Скачать" onClick={exportList} />
        <div className="rounded-[3px] border border-[#e0e0e0] bg-white px-[10px] pb-[8px] pt-[12px]">
          <ReportSearchField value={search} onChange={(value) => { setSearch(value); paging.setPage(1) }} width={258} light />
        </div>
        <ReportPager
          pageSize={paging.pageSize}
          onPageSize={paging.setPageSize}
          rangeLabel={`${filtered.length ? paging.start + 1 : 0} - ${paging.end} ${t("из")} ${filtered.length}`}
          canPrev={paging.page > 1}
          canNext={paging.page < paging.pageCount}
          onPrev={() => paging.setPage(paging.page - 1)}
          onNext={() => paging.setPage(paging.page + 1)}
        />
      </div>
      {markets !== null && !pageRows.length ? (
        <RefNothingFound text="По вашему запросу ничего не найдено..." />
      ) : (
        <div id="mainTableWrapper" className="overflow-x-auto bg-white">
          <table data-no-sort className="w-full min-w-[1200px] border-collapse text-[13px]">
            <thead>
              <tr>
                <th rowSpan={2} className={`${th} w-[240px]`}>{head("name", t("Клиент"))}</th>
                {GROUPS.map((group) => <th key={group.metric} colSpan={3} className={th}>{t(group.title)}</th>)}
              </tr>
              <tr>
                {GROUPS.flatMap((group) => [0, 1, 2].map((index) => <th key={`${group.metric}:${index}`} className={th}>{head(`${group.metric}:${index}`, `${t("Период")} ${index + 1}`)}</th>))}
              </tr>
            </thead>
            <tbody>
              {markets === null ? (
                <tr><td colSpan={13} className="border border-[#ddd] py-[30px] text-center text-[#777]">{t("Загрузка...")}</td></tr>
              ) : (
                pageRows.map((market, rowIndex) => (
                  <tr key={market.id} className={`h-[42px] ${rowIndex % 2 ? "bg-[#f5f8fa]" : "bg-white"}`}>
                    <td className="border border-[#ddd] px-[6px]">
                      <button type="button" onClick={() => onOpenShop(market.id)} className="text-left text-[#1E4A9A] hover:underline">{market.name}</button>
                    </td>
                    {GROUPS.flatMap((group) =>
                      market.periods.map((cell, index) =>
                        group.metric === "sku" ? (
                          <td key={`${group.metric}:${index}`} className="border border-[#ddd] px-[6px] text-right">
                            <button type="button" onClick={() => onOpenProducts({ id: market.id, name: market.name, period: index as PeriodIndex })} className="text-[#1E4A9A] hover:underline">{format(cell.sku)}</button>
                          </td>
                        ) : (
                          <td key={`${group.metric}:${index}`} className="border border-[#ddd] px-[6px] text-right">{format(cell[group.metric])}</td>
                        ),
                      ),
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {products && <ClassificationProducts query={query} target={products} onClose={onCloseProducts} />}
    </section>
  )
}

const GROUP_BY: { value: "product" | "product_type" | "brand"; label: string }[] = [
  { value: "product", label: "Продукт" },
  { value: "product_type", label: "Тип продукта" },
  { value: "brand", label: "Бренд" },
]

function ClassificationProducts({ query, target, onClose }: { query: string; target: ProductsTarget; onClose: () => void }) {
  const { t } = useLanguage()
  const market = target
  const [groupBy, setGroupBy] = useState<(typeof GROUP_BY)[number]["value"]>("product")
  const [countType, setCountType] = useState<"amount" | "sum">("amount")
  const [rows, setRows] = useState<ProductRow[] | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortState<string>>(null)

  useEffect(() => {
    const close = (event: KeyboardEvent) => event.key === "Escape" && onClose()
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setRows(null)
    fetch(`/api/client-classification?${query}&products=1&market=${market.id}&group_by=${groupBy}&count_type=${countType}`)
      .then((response) => (response.ok ? (response.json() as Promise<ProductRow[]>) : []))
      .then((data) => {
        if (!cancelled) setRows(Array.isArray(data) ? data : [])
      })
      .catch(() => {
        if (!cancelled) setRows([])
      })
    return () => {
      cancelled = true
    }
  }, [query, market.id, groupBy, countType])

  // Linko lists the products by the clicked period's figure, largest first (newest first among equal ones, the API's
  // order); a header sorts by its column.
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const list = (rows ?? []).filter((row) => !needle || row.name.toLowerCase().includes(needle))
    if (sort) return sortBy(list, sort, (row, key) => (key === "name" ? row.name : row.values[Number(key)]))
    return [...list].sort((a, b) => b.values[target.period] - a.values[target.period])
  }, [rows, search, sort, target.period])
  const paging = usePaging(filtered.length)
  const pageRows = filtered.slice(paging.start, paging.end)
  const th = "border border-[#e3e8ee] bg-[#f2f5f8] px-[6px] py-[8px] text-center text-[13px] font-semibold text-[#333]"
  const sortHead = (key: string, label: string) => (
    <button type="button" onClick={() => setSort((current) => nextSort(current, key))} className="inline-flex items-center justify-center gap-[2px] font-semibold">
      {label}
      <SortArrows dir={sort?.key === key ? sort.dir : null} />
    </button>
  )

  return (
    <div role="dialog" aria-modal="true" aria-label={market.name} className="fixed inset-0 z-[1000] overflow-y-auto bg-white text-[13px] text-[#333]">
      <div className="flex h-[60px] items-center justify-between border-b border-[#e0e0e0] px-[30px]">
        <h2 className="text-[14px] font-bold uppercase">{market.name}</h2>
        <button type="button" onClick={onClose} aria-label={t("Закрыть")}><X className="h-6 w-6" /></button>
      </div>
      <div className="px-[30px] pt-[15px]">
        <div className="flex items-center justify-between">
          <div className="flex">
            {GROUP_BY.map((item, index) => (
              <button
                key={item.value}
                type="button"
                onClick={() => { setGroupBy(item.value); paging.setPage(1) }}
                className={`h-[32px] border px-[16px] uppercase ${index === 0 ? "rounded-l-[3px]" : ""} ${index === GROUP_BY.length - 1 ? "rounded-r-[3px]" : ""} ${groupBy === item.value ? "border-[#1E4A9A] bg-[#1E4A9A] text-white" : "border-[#e0e0e0] bg-white text-black hover:bg-[#f2f5f8]"}`}
              >
                {t(item.label)}
              </button>
            ))}
          </div>
          <div className="flex">
            {(["sum", "amount"] as const).map((item, index) => (
              <button
                key={item}
                type="button"
                onClick={() => setCountType(item)}
                className={`h-[32px] border px-[16px] uppercase ${index === 0 ? "rounded-l-[3px]" : "rounded-r-[3px]"} ${countType === item ? "border-[#71ce87] bg-[#71ce87] text-white" : "border-[#e0e0e0] bg-white text-black hover:bg-[#f2f5f8]"}`}
              >
                {t(item === "sum" ? "Сумма" : "Кол-во")}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-[18px] flex items-center justify-between">
          <ReportSearchField value={search} onChange={(value) => { setSearch(value); paging.setPage(1) }} width={300} light />
          <ReportPager
            pageSize={paging.pageSize}
            onPageSize={paging.setPageSize}
            rangeLabel={`${filtered.length ? paging.start + 1 : 0} - ${paging.end} ${t("из")} ${filtered.length}`}
            canPrev={paging.page > 1}
            canNext={paging.page < paging.pageCount}
            onPrev={() => paging.setPage(paging.page - 1)}
            onNext={() => paging.setPage(paging.page + 1)}
          />
        </div>
        <table data-no-sort className="mt-[18px] w-full border-collapse">
          <colgroup>
            <col style={{ width: "22.7%" }} /><col style={{ width: "21.4%" }} /><col style={{ width: "21.4%" }} /><col style={{ width: "21.4%" }} /><col style={{ width: "6.5%" }} /><col style={{ width: "6.5%" }} />
          </colgroup>
          <thead>
            <tr>
              <th className={th}>{sortHead("name", t("Наименование"))}</th>
              {[0, 1, 2].map((index) => <th key={index} className={th}>{sortHead(String(index), `${t("Период")} ${index + 1}`)}</th>)}
              {["Динамика 2", "Динамика 3"].map((title) => <th key={title} className={th}>{t(title)}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={6} className="border border-[#e3e8ee] py-[30px] text-center text-[#777]">{t("Загрузка...")}</td></tr>
            ) : !pageRows.length ? (
              <tr><td colSpan={6} className="border border-[#e3e8ee] py-[30px] text-center text-[#777]">{t("Нет данных")}</td></tr>
            ) : (
              pageRows.map((row, index) => (
                <tr key={row.key} className={`h-[47px] ${index % 2 ? "bg-[#f5f8fa]" : "bg-white"}`}>
                  <td className="border border-[#e3e8ee] px-[6px]">{row.name}</td>
                  {row.values.map((value, period) => <td key={period} className="border border-[#e3e8ee] px-[6px]">{format(value)}</td>)}
                  {row.dynamics.map((value, period) => (
                    <td key={`d${period}`} className="border border-[#e3e8ee] p-[5px] text-center"><DynamicBadge value={value} /></td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function DynamicBadge({ value, spaced }: { value: number; spaced?: boolean }) {
  const positive = value > 0
  return (
    <span className={`inline-block w-full rounded-[3px] py-[8px] text-[13px] font-semibold ${positive ? "bg-[#dff5e3] text-[#35b653]" : "bg-[#fde2e2] text-[#f25555]"}`}>
      {positive ? "▲" : "▼"} {format(value)}{spaced ? " %" : "%"}
    </span>
  )
}
