"use client"

import { useEffect, useState } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, Search, TrendingDown, TrendingUp } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import type { StockOptions } from "@/components/analytics/stock-move-filters"
import { PlanMoveFilterDialog, type PlanFilterChanges } from "@/components/analytics/stock-plan-filters"
import { CLEAR_PLAN_FILTERS, countPlanFilters, moveApiQuery, planQty, type PlanState } from "@/components/analytics/stock-plan-state"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_PAGE_SIZES, planMoveType, type PlanMovementResult, type PlanMovementRow } from "@/lib/stock-plan-types"

// "Движение товаров" (demo stock/barcode_history, chunk c90): every stock
// ledger line — Дата | Склад | Тип | № | Товар (↑ in / ↓ out, "брак") |
// Кол-во (signed, with unit) | Серия; filters Тип продукта, Подкатегория, Тип,
// Товар, Склад, Период; "Скачать все" = Excel of every matching line.
// Data: GET /api/stock/plan/movements (lib/stock stockMovementsSql()).

type UrlChanges = Record<string, string | number | string[] | null>

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

export function StockPlanMovements({
  state,
  update,
  options,
  onOptionsWanted,
  notify,
}: {
  state: PlanState
  update: (changes: UrlChanges) => void
  options: StockOptions
  onOptionsWanted: () => void
  notify: (text: string, error?: boolean) => void
}) {
  const { t } = useLanguage()
  const list = useCashJson<PlanMovementResult>(`/api/stock/plan/movements?${moveApiQuery(state)}`)
  const data = list.data
  const rows = data?.results ?? []
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [lastSearch, setLastSearch] = useState(state.search)
  if (state.search !== lastSearch) {
    setLastSearch(state.search)
    setSearchDraft(state.search)
  }
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => update({ search: value || null, page: null }), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, update])

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? null : key, page: null })
  const sortHeader = (key: string, label: string) => (
    <button type="button" onClick={() => sort(key)} className="inline-flex items-center gap-1 font-semibold">
      {t(label)}
      <SortIcon ordering={state.ordering} sortKey={key} />
    </button>
  )
  const openFilter = () => {
    onOptionsWanted()
    setFilterOpen(true)
  }
  const applyFilter = (changes: PlanFilterChanges) => {
    setFilterOpen(false)
    update({ ...changes, page: null })
  }

  const typeText = (row: PlanMovementRow) => t(planMoveType(row.kind).label)
  const downloadAll = async () => {
    setExporting(true)
    try {
      const response = await fetch(`/api/stock/plan/movements?${moveApiQuery(state, 0)}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (PlanMovementResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = ["Дата", "Склад", "Тип", "№", "Товар", "Кол-во", "Ед. измерения", "Серия"].map((label) => t(label))
      const lines = body.results.map((row) => [
        row.day ? formatDotDate(row.day) : "",
        row.warehouse,
        typeText(row),
        row.docNumber,
        row.isDefect ? `${row.name} (${t("брак")})` : row.name,
        row.qty,
        row.unit ? t(row.unit) : "",
        "-",
      ])
      downloadExcelTable(t("Движение товаров"), [header, ...lines])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    } finally {
      setExporting(false)
    }
  }

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-2.5 align-middle"

  return (
    <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#e1e5eb] px-4 py-3 md:px-6">
        <BalanceFilterChip count={countPlanFilters(state)} onOpen={openFilter} onClear={() => update({ ...CLEAR_PLAN_FILTERS })} />
        <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[340px]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
          />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <BalancePagination
            page={data?.page ?? state.page}
            pageSize={state.pageSize}
            count={data?.count ?? 0}
            sizes={PLAN_PAGE_SIZES}
            onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize === 25 ? null : next.pageSize })}
          />
          <BalanceDownloadMenu disabled={exporting || !data} items={[{ label: "Скачать все", onClick: () => void downloadAll() }]} />
        </div>
      </div>

      {list.error && !list.loading && (
        <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
          <span>
            {t("Не удалось загрузить данные")}: {t(list.error)}
          </span>
          <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <div className={`overflow-x-auto ${list.loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[960px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[#e1e5eb] text-[#17233b]">
              <th className={`${th} pl-6`}>{sortHeader("day", "Дата")}</th>
              <th className={th}>{sortHeader("warehouse", "Склад")}</th>
              <th className={th}>{t("Тип")}</th>
              <th className={th}>{sortHeader("docNumber", "№")}</th>
              <th className={th}>{t("Товар")}</th>
              <th className={`${th} text-right`}>{sortHeader("qty", "Кол-во")}</th>
              <th className={th}>{t("Серия")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const out = row.qty < 0
              return (
                <tr key={row.id} className={`border-b border-[#efefef] ${row.isDefect ? "bg-[#fff4f4]" : "hover:bg-[#f7f9fb]"}`}>
                  <td className={`${td} whitespace-nowrap pl-6`}>{row.day ? formatDotDate(row.day) : t("Не указана")}</td>
                  <td className={td}>{row.warehouse}</td>
                  <td className={td}>{typeText(row)}</td>
                  <td className={`${td} font-semibold`}>{row.docNumber}</td>
                  <td className={td}>
                    <span className="inline-flex items-center gap-2">
                      {out ? <TrendingDown className="h-4 w-4 shrink-0 text-[#e57373]" /> : <TrendingUp className="h-4 w-4 shrink-0 text-[#81c784]" />}
                      <span>{row.name}</span>
                      {row.isDefect && <strong className="text-[#e57373]">{t("брак")}</strong>}
                    </span>
                  </td>
                  <td className={`${td} whitespace-nowrap text-right font-semibold`} style={{ color: out ? "#e57373" : "#3aa76d" }}>
                    {planQty(row.qty, row.unit, t, true)}
                  </td>
                  <td className={td}>-</td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="px-4 py-16 text-center text-[#9aa3b6]">
                  {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filterOpen && <PlanMoveFilterDialog state={state} options={options} onClose={() => setFilterOpen(false)} onApply={applyFilter} />}
    </section>
  )
}
