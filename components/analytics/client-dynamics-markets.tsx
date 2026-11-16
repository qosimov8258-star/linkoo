"use client"

import { useEffect, useMemo, useState } from "react"
import { X } from "lucide-react"

import { RI, RefButton, usePaging } from "@/components/ref/list-kit"
import { ReportPager, ReportSearchField } from "@/components/ref/report-kit"
import { SortArrows, nextSort, sortBy, type SortState } from "@/components/ref/sort-arrows"
import { csvText } from "@/lib/csv"
import { useLanguage } from "@/lib/i18n/language-context"

// Linko's «Классификация и динамика клиентов» drill-down: a store count opens the stores of that class and period
// under the table (market_classification/get_markets), and a store's «Ассортимент» opens what it bought
// (market_classification/get_products) in a full-screen window.

type MarketCell = { sale: number; sku: number; visits: number; successVisits: number }
type Market = { id: number; name: string; periods: [MarketCell, MarketCell, MarketCell] }
type ProductRow = { key: string; name: string; values: [number, number, number]; dynamics: [number, number] }

const PERIOD_PARAM = ["first", "second", "third"] as const
const GROUPS: { metric: keyof MarketCell; title: string }[] = [
  { metric: "sale", title: "Продажа" },
  { metric: "sku", title: "Ассортимент" },
  { metric: "visits", title: "Визит" },
  { metric: "successVisits", title: "Успешный визит" },
]

const format = (value: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(Math.round(value)).replace(/ /g, " ")

function download(name: string, rows: (string | number)[][]) {
  const url = URL.createObjectURL(new Blob([`﻿${csvText(rows)}`], { type: "text/csv;charset=utf-8" }))
  const link = document.createElement("a")
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

export function ClassificationMarkets({ query, period, bucket }: { query: string; period: 0 | 1 | 2; bucket: number }) {
  const { t } = useLanguage()
  const [markets, setMarkets] = useState<Market[] | null>(null)
  const [search, setSearch] = useState("")
  const [sort, setSort] = useState<SortState<string>>(null)
  const [products, setProducts] = useState<Market | null>(null)

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

  function exportList() {
    const header = [t("Клиент"), ...GROUPS.flatMap((group) => [1, 2, 3].map((n) => `${t(group.title)} · ${t("Период")} ${n}`))]
    download("client-classification-markets.csv", [header, ...filtered.map((market) => [market.name, ...GROUPS.flatMap((group) => market.periods.map((cell) => Math.round(cell[group.metric])))])])
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
      <div className="overflow-x-auto bg-white">
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
            ) : !pageRows.length ? (
              <tr><td colSpan={13} className="border border-[#ddd] py-[30px] text-center text-[#777]">{t("Нет данных")}</td></tr>
            ) : (
              pageRows.map((market, rowIndex) => (
                <tr key={market.id} className={`h-[42px] ${rowIndex % 2 ? "bg-[#f5f8fa]" : "bg-white"}`}>
                  <td className="border border-[#ddd] px-[6px] font-semibold text-[#1E4A9A]">{market.name}</td>
                  {GROUPS.flatMap((group) =>
                    market.periods.map((cell, index) =>
                      group.metric === "sku" ? (
                        <td key={`${group.metric}:${index}`} className="border border-[#ddd] px-[6px] text-right">
                          <button type="button" onClick={() => setProducts(market)} className="font-semibold text-[#1E4A9A] hover:underline">{format(cell.sku)}</button>
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
      {products && <ClassificationProducts query={query} market={products} onClose={() => setProducts(null)} />}
    </section>
  )
}

const GROUP_BY: { value: "product" | "product_type" | "brand"; label: string }[] = [
  { value: "product", label: "Продукт" },
  { value: "product_type", label: "Тип продукта" },
  { value: "brand", label: "Бренд" },
]

function ClassificationProducts({ query, market, onClose }: { query: string; market: Market; onClose: () => void }) {
  const { t } = useLanguage()
  const [groupBy, setGroupBy] = useState<(typeof GROUP_BY)[number]["value"]>("product")
  const [countType, setCountType] = useState<"amount" | "sum">("amount")
  const [rows, setRows] = useState<ProductRow[] | null>(null)
  const [search, setSearch] = useState("")

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

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (rows ?? []).filter((row) => !needle || row.name.toLowerCase().includes(needle))
  }, [rows, search])
  const paging = usePaging(filtered.length)
  const pageRows = filtered.slice(paging.start, paging.end)
  const th = "border border-[#e3e8ee] bg-[#f2f5f8] px-[6px] py-[8px] text-center text-[13px] font-semibold text-[#333]"

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
              {["Наименование", "Период 1", "Период 2", "Период 3", "Динамика 2", "Динамика 3"].map((title) => <th key={title} className={th}>{t(title)}</th>)}
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
