"use client"

import { Suspense, useCallback, useEffect, useState, type FormEvent } from "react"
import { CircleAlert, Loader2 } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { countActiveFilters } from "@/components/analytics/balance/filter-bar"
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
import { StockMoveTable } from "@/components/analytics/stock-move-table"
import { RI, RefHeader, RefPage } from "@/components/ref/list-kit"
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

  const lastPage = Math.max(1, Math.ceil((data?.count ?? 0) / state.pageSize))
  const currentPage = Math.min(data?.page ?? state.page, lastPage)
  const rangeFrom = data?.count ? (currentPage - 1) * state.pageSize + 1 : 0
  const rangeTo = Math.min(currentPage * state.pageSize, data?.count ?? 0)
  const scope = [...state.divisions, ...state.branches]
  const groupLabel = t(MOVE_GROUP_BY.find((group) => group.id === state.groupBy)?.label ?? "")
  const selectBox = "absolute top-[23px] block h-[36px] w-[200px] border-b border-[#e8e8e8]"
  const floatLabel = "absolute -top-[13px] left-0 text-[10px] font-semibold leading-[12.2px] text-black"
  return (
    <RefPage>
      <div className="pl-[2px]">
        <RefHeader title={t("Остаток на определенную дату")} />
      </div>

      <div className="-mx-7 -mb-7 min-h-[calc(100vh-111px)] border-t border-[#e8eaee] bg-white px-[30px] pb-[30px] pt-[20px]">
        <section className="flex h-[34px] items-center justify-between">
          <div className="flex h-[34px] items-center">
            <button type="button" onClick={openFilter} className="flex h-[34px] items-center rounded-[5px] bg-[#4f71dc] pl-[12.8px] pr-[17px] text-[13px] font-semibold text-white hover:brightness-95">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] shrink-0 fill-white" aria-hidden>
                <path d={RI.filter} />
              </svg>
              <span className="pl-2">
                {t("Фильтр")}
                {filterCount > 0 ? ` / ${filterCount}` : ""}
              </span>
            </button>
            <span className="ml-[14px] whitespace-nowrap text-[13px] font-semibold text-[#4f71dc]">{scope.length ? scope.join(", ") : t("Во всей организации")}</span>
          </div>
          <BalanceDownloadMenu
            disabled={downloading}
            items={[
              { label: "Скачать все", onClick: () => void download("full") },
              { label: "Скачать упрощенный список", onClick: () => void download("simple") },
            ]}
          />
        </section>
        {downloadError && (
          <p className="pt-2 text-[13px] text-[#e57373]">
            {t("Не удалось выполнить запрос")}: {t(downloadError)}
          </p>
        )}

        {sum.error && !sum.loading ? (
          <p className="pt-4 text-[13px] text-[#e57373]">
            {t("Не удалось выполнить запрос")}: {t(sum.error)}
          </p>
        ) : (
          <StockMoveCards sum={sum.data} loading={sum.loading} showOthers={state.showOthers} />
        )}

        <ExpandedOverlay expanded={expanded}>
          <section className="relative h-[67px] border-t border-[#efefef]">
            <div className="absolute left-0 top-[25px] flex h-[32px]">
              {toggles.map((toggle, index) => (
                <button
                  key={toggle.id}
                  type="button"
                  onClick={() => setToggle(toggle.id)}
                  style={{ minWidth: [66, 90.7, 146.7][index] }}
                  className={`h-[32px] px-[16px] text-[13px] uppercase first:rounded-l-[5px] last:rounded-r-[5px] ${state.toggle === toggle.id ? "bg-[#4f71dc] text-white [box-shadow:0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)]" : "bg-white text-black [box-shadow:inset_0_0_2px_rgba(0,0,0,0.12)]"}`}
                >
                  {t(toggle.label)}
                </button>
              ))}
            </div>
            {state.toggle === "priceList" && (
              <label className="absolute left-[330px] top-[19px] w-[100px]">
                <select
                  value={state.priceList}
                  onChange={(event) => update({ priceList: event.target.value || null, page: null })}
                  aria-label={t("Прайс лист")}
                  className="h-9 w-full border-b border-[#e0e0e0] bg-transparent text-[13px]"
                >
                  <option value="">{t("Прайс лист")}</option>
                  {[...new Set([state.priceList, ...options.priceLists].filter(Boolean))].map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <form onSubmit={submitSearch} className="absolute left-[407.8px] top-[22px] block h-[36px] w-[200px] border-b border-[#e0e0e0]">
              <input
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder={t("Поиск")}
                aria-label={t("Поиск")}
                className="h-[31px] w-full bg-transparent pt-[13px] text-[13px] font-semibold leading-[18px] outline-none placeholder:font-semibold placeholder:text-black"
              />
            </form>
            <label className={`${selectBox} left-[637.8px]`}>
              <span className={floatLabel}>{t("Группировка")}</span>
              <span className="pointer-events-none absolute left-0 top-[13px] text-[13px] font-semibold leading-[18px] text-[#333]">{groupLabel}</span>
              <select value={state.groupBy} onChange={(event) => setGroupBy(event.target.value as MoveGroupBy)} aria-label={t("Группировка")} className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0">
                {MOVE_GROUP_BY.map((group) => (
                  <option key={group.id} value={group.id}>
                    {t(group.label)}
                  </option>
                ))}
              </select>
              <span aria-hidden className="pointer-events-none absolute left-[158px] top-[14px] text-[18px] leading-[18px] text-[#999]">×</span>
              <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[21px] h-[5px] w-[10px] fill-[#333]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
            </label>
            <label className={`${selectBox} left-[867.8px]`}>
              <span className={floatLabel}>{t("Показать")}</span>
              <span className="pointer-events-none absolute left-0 top-[13px] text-[13px] font-semibold leading-[18px] text-[#333]">{t("Количество")}</span>
              <span aria-hidden className="pointer-events-none absolute left-[158px] top-[14px] text-[18px] leading-[18px] text-[#999]">×</span>
              <svg viewBox="0 0 10 5" className="pointer-events-none absolute right-[10px] top-[21px] h-[5px] w-[10px] fill-[#333]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
            </label>
            <div className="absolute right-0 top-[13px] flex h-[56px] items-center">
              <label className="relative flex h-[56px] w-[56px] items-center justify-center text-[13px] text-[#333]">
                <select
                  value={state.pageSize}
                  onChange={(event) => update({ page: null, pageSize: Number(event.target.value) === 25 ? null : Number(event.target.value) })}
                  aria-label={t("Количество строк")}
                  className="h-full w-full appearance-none bg-transparent text-[13px] outline-none"
                >
                  {MOVE_PAGE_SIZES.map((size) => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
                <svg viewBox="0 0 10 5" className="pointer-events-none absolute left-[23px] top-[26px] h-[5px] w-[10px] fill-[#999]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
              </label>
              <span className="ml-[11px] whitespace-nowrap text-[13px] text-[#5d6474]">
                {rangeFrom} - {rangeTo} {t("из")} {data?.count ?? 0}
              </span>
              <button type="button" disabled={currentPage <= 1} onClick={() => update({ page: currentPage - 1 > 1 ? currentPage - 1 : null })} aria-label={t("Назад")} className="pl-[10px] pr-[5px] disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-5l-3-3 3-3v6z" /></svg>
              </button>
              <button type="button" disabled={currentPage >= lastPage} onClick={() => update({ page: currentPage + 1 })} aria-label={t("Вперед")} className="disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-black/60" aria-hidden><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-11l3 3-3 3V9z" /></svg>
              </button>
              <span className="ml-[10px]">
                <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
              </span>
            </div>
          </section>

          {priceListMissing && <p className="py-3 text-center text-[#b7791f]">{t("Пожалуйста выберите прайс лист")}</p>}

          {!data && list.loading && (
            <div className="flex items-center justify-center gap-2 py-24 text-[#586174]">
              <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
            </div>
          )}
          {list.error && !list.loading && (
            <div className="flex flex-col items-center gap-3 px-4 py-10 text-center text-[#586174]">
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
          )}
        </ExpandedOverlay>
      </div>

      <MoveFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} state={state} options={options} optionsError={optionsError} onApply={applyFilter} />
      <StockMoveDetail url={detailUrl} kind={state.kind} onKindChange={(kind) => update({ kind: kind || null })} onClose={closeDetail} />
    </RefPage>
  )
}
