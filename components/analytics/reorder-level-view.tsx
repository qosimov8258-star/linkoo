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

const PERIOD_MONTHS = {
  ru: ["янв.", "февр.", "мар.", "апр.", "мая", "июня", "июля", "авг.", "сент.", "окт.", "нояб.", "дек."],
  uz: ["Yan", "Fev", "Mar", "Apr", "May", "Iyn", "Iyl", "Avg", "Sen", "Okt", "Noy", "Dek"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
} as const

function ReorderLevelContent() {
  const { t, language } = useLanguage()
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

  const periodWord = (iso: string) => {
    const [y, m, d] = iso.split("-")
    const months = PERIOD_MONTHS[language === "ru" || language === "uz" ? language : "en"]
    return `${d} ${months[Number(m) - 1]} ${y}`
  }

  return (
    <main className="min-h-screen bg-[#f2f5f8] font-sans text-[13px] text-[#333]">
      <div className="pl-[30px] pr-7">
        <RefHeader title={t("Рекомендованный запас")} />
      </div>

      <div className="border-t border-[#e8eaee] bg-white pb-[20px]">
      {/* Five blocks spread with equal gaps (the reference's flex row): at 1296px the gaps are 0 and the blocks sit at 30 / 299.7 / 648 / 1068.4px. */}
      <section className="flex h-[50px] justify-between px-[30px]">
        <div className="relative w-[269.7px] shrink-0">
          <div className="absolute left-0 top-[17px]">
            <BalanceFilterChip count={filterCount} onOpen={openFilter} onClear={clearFilter} />
          </div>
        </div>
        <div className="relative w-[348.3px] shrink-0">
          <form onSubmit={submitSearch} className="absolute left-0 top-0 h-[41px] w-[182px] border-b border-[#e0e0e0] focus-within:border-[#5d6474]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-[40px] w-[147px] bg-transparent pt-[10px] text-[13px] outline-none placeholder:text-black/30"
            />
            <button type="submit" aria-label={t("Поиск")} className="absolute left-[156px] top-[13px] text-[#ccc] hover:text-[#4f70e7]">
              <Search className="h-6 w-6" />
            </button>
          </form>
        </div>
        <div className="relative w-[410px] shrink-0">
          <button type="button" onClick={openFilter} className="absolute left-0 top-[25px] w-[200px] text-right text-[13px] font-bold text-[#4f71dc]" title={t("Диапазон дат")} data-no-translate>
            {periodWord(state.from)} - {periodWord(state.to)}
          </button>
          <label className="absolute left-[210px] top-[9.5px] block h-[36px] w-[200px] border-b border-[#e8e8e8]">
            <span className="pointer-events-none absolute left-0 top-[12px] text-[13px] font-semibold leading-[16.3px] text-black">{t("Показать по типу ед.")}{state.unit !== "measurement" ? `: ${t(REORDER_UNITS.find((unit) => unit.id === state.unit)?.label ?? "")}` : ""}</span>
            <select
              value={state.unit}
              onChange={(event) => update({ selectType: event.target.value === "measurement" ? null : event.target.value, page: null })}
              aria-label={t("Показать по типу ед.")}
              className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0"
            >
              {REORDER_UNITS.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {t(unit.label)}
                </option>
              ))}
            </select>
            <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[21px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
          </label>
        </div>
        <div className="w-0" />
        <div className="relative ml-[10.4px] w-[197.6px] shrink-0">
          <button
            type="button"
            onClick={() => void downloadAll()}
            disabled={downloading}
            className="absolute left-0 top-[10px] flex h-[30px] w-[189.6px] items-center rounded-[5px] bg-[#4f71dc] pl-[12px] text-[13px] font-semibold text-white disabled:opacity-50"
          >
            {downloading ? <Loader2 className="mr-2 h-[18px] w-[18px] animate-spin" /> : <svg viewBox="0 0 24 24" className="mr-2 h-[18px] w-[18px] fill-white"><path d={RI.download} /></svg>}
            {t("Скачать все")}
          </button>
        </div>
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
        <ReorderLevelTable rows={rows} ordering={state.ordering} unit={state.unit} onOrderingChange={(next) => update({ ordering: next || null, page: null })} loading={list.loading} />
      )}
      </div>

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
