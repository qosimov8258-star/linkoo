"use client"

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react"
import { CircleAlert, Loader2, Search } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterButton, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import { StockMoveCards } from "@/components/analytics/stock-move-cards"
import { StockMoveDetail } from "@/components/analytics/stock-move-detail"
import {
  MOVE_PAGE_SIZES,
  MoveFilterDialog,
  moveApiQuery,
  moveStateFromParams,
  useStockOptions,
  useUrlState,
  type MoveFilterDraft,
  type MoveToggle,
} from "@/components/analytics/stock-move-filters"
import { StockMoveColumnPicker, StockMoveTable } from "@/components/analytics/stock-move-table"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { useLanguage } from "@/lib/i18n/language-context"
import { MOVE_GROUP_BY, moveColumns, type MoveField, type MoveGroupBy } from "@/lib/stock-movement-columns"
import type { MoveListResult, MoveRow, MoveSumResult } from "@/lib/stock-movement-report"

// "Остаток на определенную дату" (demo #/statistics/product-move, m2200 /
// m3875): filter header (Фильтр / N, period, scope, Скачать → full or
// simplified Excel), the 9 cards, then the toolbar (Кол-во | Себестоимость |
// Прайс лист, price list, search, Группировка, Показать, pagination,
// Расширенный вид) and the table. Everything lives in the URL (demo keys, see
// stock-move-filters.tsx). Data: /api/stock/movement (+ /sum, /item, /export).

const HIDDEN_KEY = "stock-move.hidden-columns"


export function StockMoveView() {
  return (
    <Suspense fallback={null}>
      <StockMoveContent />
    </Suspense>
  )
}

function StockMoveContent() {
  const { t } = useLanguage()
  const { searchParams, update } = useUrlState()
  const state = moveStateFromParams(searchParams)
  const priceListMissing = state.toggle === "priceList" && !state.priceList

  // --- data -------------------------------------------------------------------------
  const list = useCashJson<MoveListResult>(`/api/stock/movement?${moveApiQuery(state, { ordering: state.ordering, page: state.page, pageSize: state.pageSize })}`)
  const sum = useCashJson<MoveSumResult>(`/api/stock/movement/sum?${moveApiQuery(state)}`)
  const detailUrl = state.item ? `/api/stock/movement/item?${moveApiQuery({ ...state, search: "" }, { key: state.item })}` : null
  const data = list.data
  const rows = data?.results ?? []

  // --- local UI state ---------------------------------------------------------------
  const [filterOpen, setFilterOpen] = useState(false)
  const [lookupsWanted, setLookupsWanted] = useState(false)
  const { options, error: optionsError } = useStockOptions(lookupsWanted || state.toggle === "priceList")
  const [hidden, setHidden] = useState<MoveField[]>([])
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? "[]") as unknown
      if (Array.isArray(stored)) setHidden(stored.filter((field): field is MoveField => typeof field === "string"))
    } catch {
      setHidden([])
    }
  }, [])
  const [expanded, setExpanded] = useState(false)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [lastSearch, setLastSearch] = useState(state.search)
  if (state.search !== lastSearch) {
    setLastSearch(state.search)
    setSearchDraft(state.search)
  }
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")

  const allColumns = moveColumns(state.showOthers)
  const columns = allColumns.filter((column) => !hidden.includes(column.field))
  const withValue = Boolean(data && data.mode !== "quantity" && !data.needPriceList)
  const filterCount = countActiveFilters({
    toDate: state.urlTo,
    stock: state.warehouses,
    branch: state.branches,
    division: state.divisions,
    typeParent: state.typeParents,
    type: state.types,
    brand: state.brands,
    transactionInPeriod: state.transaction,
    balanceInPeriod: state.balance,
    showOthers: state.showOthers,
  })
  const toggles: Array<{ id: MoveToggle; label: string }> = [
    { id: "quantity", label: "Кол-во" },
    { id: "price", label: "Себестоимость" },
    // Demo: no price-list tab when grouping by warehouse / branch.
    ...(state.groupBy === "stock" || state.groupBy === "branch" ? [] : [{ id: "priceList" as const, label: "Прайс лист" }]),
  ]

  // --- actions ----------------------------------------------------------------------
  const changeHidden = (next: MoveField[]) => {
    setHidden(next)
    try {
      window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: keep the in-memory choice
    }
  }
  const openFilter = () => {
    setLookupsWanted(true)
    setFilterOpen(true)
  }
  const applyFilter = (period: { from: string; to: string }, draft: MoveFilterDraft) =>
    update({
      fromDate: period.from,
      toDate: period.to,
      stock: draft.warehouses,
      branch: draft.branches,
      division: draft.divisions,
      typeParent: draft.typeParents,
      type: draft.types,
      brand: draft.brands,
      transactionInPeriod: draft.transaction,
      balanceInPeriod: draft.balance,
      showOthers: draft.showOthers ? "true" : null,
      page: null,
      product: null,
      kind: null,
    })
  const setToggle = (next: MoveToggle) => update({ toggle: next === "quantity" ? null : next, page: null, ordering: state.ordering.includes(".value") ? null : state.ordering })
  const setGroupBy = (next: MoveGroupBy) => update({ groupBy: next === "product" ? null : next, toggle: null, priceList: null, ordering: null, search: null, page: null })
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    update({ search: searchDraft.trim(), page: null })
  }
  // Demo: a product row opens its history; a group row drills down to its products.
  const openRow = (row: MoveRow) => {
    if (state.groupBy === "product") return update({ product: row.key, kind: null })
    if (!row.key) return
    const drill: Record<Exclude<MoveGroupBy, "product">, Record<string, string[] | string | null>> = {
      stock: { stock: [row.key], groupBy: null },
      branch: { branch: [row.key], groupBy: "stock" },
      brand: { brand: [row.key], groupBy: null },
      type: { typeParent: [row.key], groupBy: null },
    }
    update({ ...drill[state.groupBy], page: null, search: null, ordering: null, toggle: null, priceList: null })
  }
  const openCell = (row: MoveRow, field: MoveField) => update({ product: row.key, kind: field === "other_in" || field === "other_out" ? null : field })
  const closeDetail = useCallback(() => update({ product: null, kind: null }), [update])

  const download = async (variant: "full" | "simple") => {
    setDownloading(true)
    setDownloadError("")
    try {
      const query = moveApiQuery(state, { ordering: state.ordering, variant, showOthers: state.showOthers ? 1 : undefined })
      const response = await fetch(`/api/stock/movement/export?${query}`, { cache: "no-store" })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error || `HTTP ${response.status}`)
      }
      const blob = await response.blob()
      const disposition = response.headers.get("Content-Disposition") ?? ""
      const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1]
      const link = document.createElement("a")
      link.href = URL.createObjectURL(blob)
      link.download = encoded ? decodeURIComponent(encoded) : "stock-movement.xlsx"
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-4 sm:px-6 md:px-9">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-xl font-bold text-[#586174] sm:text-2xl">{t("Остаток на определенную дату")}</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-4 py-4 sm:px-6 md:px-9">
        <BalanceFilterButton count={filterCount} from={state.from} to={state.to} scope={[...state.divisions, ...state.branches]} onOpen={openFilter} />
        <div className="ml-auto">
          <BalanceDownloadMenu
            disabled={downloading}
            items={[
              { label: "Скачать все", onClick: () => void download("full") },
              { label: "Скачать упрощенный список", onClick: () => void download("simple") },
            ]}
          />
        </div>
      </section>
      {downloadError && (
        <p className="px-4 pb-2 text-sm text-[#e57373] sm:px-6 md:px-9">
          {t("Не удалось выполнить запрос")}: {t(downloadError)}
        </p>
      )}

      {sum.error && !sum.loading ? (
        <p className="px-4 pb-4 text-sm text-[#e57373] sm:px-6 md:px-9">
          {t("Не удалось выполнить запрос")}: {t(sum.error)}
        </p>
      ) : (
        <StockMoveCards sum={sum.data} loading={sum.loading} showOthers={state.showOthers} />
      )}

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-3 border-t border-[#e1e5eb] px-4 py-3 sm:px-6 md:px-9">
          <div className="flex overflow-hidden rounded-md border border-[#dbe0e8]">
            {toggles.map((toggle) => (
              <button
                key={toggle.id}
                type="button"
                onClick={() => setToggle(toggle.id)}
                className={`h-9 px-4 text-[13px] font-semibold uppercase ${state.toggle === toggle.id ? "bg-[#4f70e7] text-white" : "bg-white text-[#586174] hover:bg-[#f2f5f8]"}`}
              >
                {t(toggle.label)}
              </button>
            ))}
          </div>
          {state.toggle === "priceList" && (
            <select
              value={state.priceList}
              onChange={(event) => update({ priceList: event.target.value || null, page: null })}
              aria-label={t("Прайс лист")}
              className="h-9 min-w-[180px] rounded-md border border-[#dbe0e8] bg-white px-3"
            >
              <option value="">{t("Прайс лист")}</option>
              {[...new Set([state.priceList, ...options.priceLists].filter(Boolean))].map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          )}
          <form onSubmit={submitSearch} className="relative w-full max-w-[260px] border-b border-[#dbe0e8] pb-1.5 focus-within:border-[#4f70e7]">
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="w-full bg-transparent pr-8 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <button type="submit" aria-label={t("Поиск")} className="absolute right-0 top-0 text-[#9aa3b6] hover:text-[#4f70e7]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <label className="flex items-center gap-2 text-[#586174]">
            <span className="text-[13px]">{t("Группировка")}</span>
            <select value={state.groupBy} onChange={(event) => setGroupBy(event.target.value as MoveGroupBy)} className="h-9 rounded-md border border-[#dbe0e8] bg-white px-2 text-[#17233b]">
              {MOVE_GROUP_BY.map((group) => (
                <option key={group.id} value={group.id}>
                  {t(group.label)}
                </option>
              ))}
            </select>
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <StockMoveColumnPicker columns={allColumns} hidden={hidden} onChange={changeHidden} />
            <BalancePagination
              page={data?.page ?? state.page}
              pageSize={state.pageSize}
              count={data?.count ?? 0}
              sizes={MOVE_PAGE_SIZES}
              onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize === 25 ? null : next.pageSize })}
            />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        {priceListMissing && <p className="border-t border-[#e1e5eb] px-4 py-3 text-center text-[#b7791f] sm:px-6 md:px-9">{t("Пожалуйста выберите прайс лист")}</p>}

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
        {data && !list.error && (
          <section className="border-t border-[#e1e5eb] pb-10">
            <StockMoveTable
              rows={rows}
              columns={columns}
              groupBy={data.groupBy}
              withValue={withValue}
              ordering={state.ordering}
              onOrderingChange={(next) => update({ ordering: next || null, page: null })}
              onRowClick={openRow}
              onCellClick={openCell}
              loading={list.loading}
            />
          </section>
        )}
      </ExpandedOverlay>

      <MoveFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} state={state} options={options} optionsError={optionsError} onApply={applyFilter} />
      <StockMoveDetail url={detailUrl} kind={state.kind} onKindChange={(kind) => update({ kind: kind || null })} onClose={closeDetail} />
    </main>
  )
}
