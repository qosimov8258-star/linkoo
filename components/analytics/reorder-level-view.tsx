"use client"

import { Suspense, useState, type FormEvent } from "react"
import Image from "next/image"
import { CircleAlert, Info, Loader2, Search } from "lucide-react"

import { BalanceFilterChip, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import {
  REORDER_PAGE_SIZES,
  REORDER_UNITS,
  ReorderFilterDialog,
  reorderApiQuery,
  reorderStateFromParams,
  type ReorderDraft,
} from "@/components/analytics/reorder-level-filters"
import { ReorderLevelTable } from "@/components/analytics/reorder-level-table"
import { useStockOptions, useUrlState } from "@/components/analytics/stock-move-filters"
import { RI, RefHeader } from "@/components/ref/list-kit"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import type { RecommendedListResult, RecommendedUnit } from "@/lib/stock-recommended"

// "Рекомендованный запас" (demo #/recommended-stock, chunk c138): "Показать
// фильтр" (Склад, Организация, Тип продукта, Подкатегория, По брендам, period),
// the period, "Показать по типу ед.", search, "Скачать все" and the table of
// items sold in the period, by sold descending. Sales = shipped orders of a
// warehouse (stock ledger `order` movements); available = on hand − reserved −
// defects now. Data: /api/stock/recommended (+ /export).

export function ReorderLevelView() {
  return (
    <Suspense fallback={null}>
      <ReorderLevelContent />
    </Suspense>
  )
}

function ReorderLevelContent() {
  const { t } = useLanguage()
  const { searchParams, update } = useUrlState()
  const state = reorderStateFromParams(searchParams)
  const list = useCashJson<RecommendedListResult>(`/api/stock/recommended?${reorderApiQuery(state, { page: state.page, pageSize: state.pageSize })}`)
  const data = list.data
  const rows = data?.results ?? []

  const [filterOpen, setFilterOpen] = useState(false)
  const [lookupsWanted, setLookupsWanted] = useState(false)
  const { options, error: optionsError } = useStockOptions(lookupsWanted)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [lastSearch, setLastSearch] = useState(state.search)
  if (state.search !== lastSearch) {
    setLastSearch(state.search)
    setSearchDraft(state.search)
  }
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")

  // Demo counter: the filter keys except the period.
  const filterCount = countActiveFilters({ stock: state.warehouses, division: state.divisions, typeParent: state.typeParents, typeChild: state.typeChildren, brand: state.brands })

  const openFilter = () => {
    setLookupsWanted(true)
    setFilterOpen(true)
  }
  const applyFilter = (period: { from: string; to: string }, draft: ReorderDraft) =>
    update({ beginDate: period.from, endDate: period.to, stock: draft.warehouses, division: draft.divisions, typeParent: draft.typeParents, typeChild: draft.typeChildren, brand: draft.brands, page: null })
  const clearFilter = () => update({ stock: null, division: null, typeParent: null, typeChild: null, brand: null, page: null })
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    update({ search: searchDraft.trim(), page: null })
  }
  const downloadAll = async () => {
    setDownloading(true)
    setDownloadError("")
    try {
      const response = await fetch(`/api/stock/recommended/export?${reorderApiQuery(state)}`, { cache: "no-store" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(response.headers.get("Content-Disposition") ?? "")?.[1]
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = encoded ? decodeURIComponent(encoded) : "recommended-stock.xlsx"
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  const sales = data?.sales
  const noWarehouseSales = Boolean(sales && sales.orderMovements === 0)

  return (
    <main className="min-h-screen bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="px-7">
        <RefHeader title={t("Рекомендованный запас")} />
      </div>

      <section className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-white px-[20px] py-[14px]">
        <BalanceFilterChip count={filterCount} onOpen={openFilter} onClear={clearFilter} />
        <form onSubmit={submitSearch} className="relative ml-[40px] w-[300px] border-b border-[#e0e0e0] pb-1.5 focus-within:border-[#5d6474]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="w-full bg-transparent pr-8 text-[13px] outline-none placeholder:text-black/30"
          />
          <button type="submit" aria-label={t("Поиск")} className="absolute right-0 top-0 text-[#ccc] hover:text-[#4f70e7]">
            <Search className="h-5 w-5" />
          </button>
        </form>
        <button type="button" onClick={openFilter} className="text-[13px] font-bold text-[#4f71dc]" title={t("Диапазон дат")}>
          {formatDotDate(state.from)} - {formatDotDate(state.to)}
        </button>
        <label className="flex items-center gap-2 text-[#333]">
          <span className="text-[13px] font-semibold">{t("Показать по типу ед.")}</span>
          <select
            value={state.unit}
            onChange={(event) => update({ selectType: event.target.value === "measurement" ? null : event.target.value, page: null })}
            className="h-8 border-b border-[#e0e0e0] bg-transparent px-1 text-[13px] text-[#333] outline-none"
          >
            {REORDER_UNITS.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {t(unit.label)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void downloadAll()}
          disabled={downloading}
          className="ml-auto flex h-[34px] items-center rounded-[3px] bg-[#4f71dc] pl-3 pr-4 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {downloading ? <Loader2 className="mr-2 h-[18px] w-[18px] animate-spin" /> : <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white"><path d={RI.download} /></svg>}
          {t("Скачать все")}
        </button>
      </section>
      {downloadError && (
        <p className="px-4 pb-2 text-sm text-[#e57373] sm:px-6 md:px-9">
          {t("Не удалось выполнить запрос")}: {t(downloadError)}
        </p>
      )}
      {state.unit === "box" && <UnitNote unit={state.unit} />}

      {(data?.count ?? 0) > state.pageSize && (
        <section className="flex justify-end bg-white px-[20px] py-2">
          <BalancePagination
            page={data?.page ?? state.page}
            pageSize={state.pageSize}
            count={data?.count ?? 0}
            sizes={REORDER_PAGE_SIZES}
            onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize === 25 ? null : next.pageSize })}
          />
        </section>
      )}

      {!data && list.loading && (
        <div className="flex items-center justify-center gap-2 border-t border-[#e1e5eb] py-24 text-[#586174]">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      )}
      {list.error && !list.loading && (
        <div className="flex flex-col items-center gap-3 border-t border-[#e1e5eb] px-4 py-10 text-center text-[#586174]">
          <CircleAlert className="h-10 w-10 text-[#e57373]" />
          <p>
            {t("Не удалось выполнить запрос")}: {t(list.error)}
          </p>
          <button type="button" onClick={list.reload} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
            {t("Повторить")}
          </button>
        </div>
      )}
      {data && !list.error && !rows.length && (
        <div className="flex flex-col items-center justify-center border-t border-[#e1e5eb] px-4 py-20 text-center">
          {list.loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-[#586174]" />
          ) : (
            <>
              <Image src="/robot-empty.png" alt="" width={120} height={120} className="h-28 w-28 object-contain" />
              <p className="mt-4 text-[#9aa3b6]">{t("По вашему запросу ничего не найдено")}</p>
              {noWarehouseSales && (
                <p className="mt-4 flex max-w-[640px] items-start gap-2 rounded-md bg-[#f2f5f8] px-4 py-3 text-left text-[14px] text-[#586174]">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#4f70e7]" />
                  <span>
                    {t("Рекомендации строятся по продажам за период: отгруженные заказы («В пути», «Доставлено») со склада.")}{" "}
                    {sales && (!sales.warehouseColumn || sales.ordersWithWarehouse === 0)
                      ? t("Пока ни один заказ не привязан к складу, поэтому продаж нет.")
                      : t("За выбранный период отгруженных заказов со склада нет.")}
                  </span>
                </p>
              )}
            </>
          )}
        </div>
      )}
      {data && !list.error && rows.length > 0 && (
        <section className="border-t border-[#e1e5eb] pb-10">
          <ReorderLevelTable rows={rows} ordering={state.ordering} onOrderingChange={(next) => update({ ordering: next || null, page: null })} loading={list.loading} />
        </section>
      )}

      <ReorderFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} state={state} options={options} optionsError={optionsError} onApply={applyFilter} />
    </main>
  )
}

/** "Блок": the catalog has no units-per-block yet, so the numbers stay in pieces. */
function UnitNote({ unit }: { unit: RecommendedUnit }) {
  const { t } = useLanguage()
  if (unit !== "box") return null
  return <p className="px-4 pb-2 text-[13px] text-[#b7791f] sm:px-6 md:px-9">{t("Количество в блоке не задано в справочнике — показано в штуках")}</p>
}
