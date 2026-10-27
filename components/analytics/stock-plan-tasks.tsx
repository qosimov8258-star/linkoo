"use client"

import { Fragment, useEffect, useState, type ReactNode } from "react"
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, Search } from "lucide-react"

import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useCashJson } from "@/components/analytics/cash/use-cash"
import type { StockOptions } from "@/components/analytics/stock-move-filters"
import { StockPlanDetail } from "@/components/analytics/stock-plan-detail"
import { PlanTaskFilterDialog, type PlanFilterChanges } from "@/components/analytics/stock-plan-filters"
import { CLEAR_PLAN_FILTERS, countPlanFilters, planDate, taskApiQuery, type PlanState } from "@/components/analytics/stock-plan-state"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_PAGE_SIZES, PLAN_TAB_LABELS, PLAN_TYPE_LABELS, type PlanRights, type PlanTaskListResult, type PlanTaskRow, type PlanTaskTab } from "@/lib/stock-plan-types"

// The four task tabs of "План приемок и передач" (demo c88 / c89 grids):
//   (Тип: Поставка / Передача / Возврат on the receive tabs, Заказ / Передача on the transfer tabs)
//   Приемка           № | От кого | Тип | Дата приемки | Склад
//   История Приемки   № | От кого | Тип | Дата приемки | Принял | Склад
//   Передача          № | Дата запроса | Склад | Тип | Кому | Доставщик | Дата передачи
//   История Передачи  № | Дата запроса | Склад | Тип | Кому | Доставщик | Передал | Дата передачи
// A row expands into its document (StockPlanDetail). Data: GET /api/stock/plan.

type UrlChanges = Record<string, string | number | string[] | null>

type Column = { label: string; sort?: string; cell: (row: PlanTaskRow) => ReactNode; excel: (row: PlanTaskRow) => string | number }

function SortIcon({ ordering, sortKey }: { ordering: string; sortKey: string }) {
  if (ordering === sortKey) return <ArrowUp className="h-3.5 w-3.5" />
  if (ordering === `-${sortKey}`) return <ArrowDown className="h-3.5 w-3.5" />
  return <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
}

function useColumns(tab: PlanTaskTab): Column[] {
  const { t, language } = useLanguage()
  const date = (iso: string) => planDate(iso, language) || t("Не указана")
  const name = (value: string) => value || t("Не указано")
  const no: Column = { label: "№", sort: "id", cell: (row) => <span className="font-semibold">{row.id}</span>, excel: (row) => row.id }
  const type: Column = { label: "Тип", sort: "type", cell: (row) => t(PLAN_TYPE_LABELS[row.type]), excel: (row) => t(PLAN_TYPE_LABELS[row.type]) }
  const warehouse: Column = { label: "Склад", sort: "warehouse", cell: (row) => name(row.warehouse), excel: (row) => row.warehouse }
  const party = (label: string): Column => ({ label, sort: "party", cell: (row) => name(row.party), excel: (row) => row.party })
  const when = (label: string, field: "date" | "requestDate" | "doneAt", sort: string): Column => ({ label, sort, cell: (row) => <span className="whitespace-nowrap">{date(row[field])}</span>, excel: (row) => planDate(row[field], language) })
  const who = (label: string): Column => ({ label, sort: "doneBy", cell: (row) => name(row.doneBy), excel: (row) => row.doneBy })
  const deliverer: Column = { label: "Доставщик", sort: "deliverer", cell: (row) => name(row.deliverer), excel: (row) => row.deliverer }
  if (tab === "receive") return [no, party("От кого"), type, when("Дата приемки", "date", "date"), warehouse]
  if (tab === "receive_history") return [no, party("От кого"), type, when("Дата приемки", "doneAt", "date"), who("Принял"), warehouse]
  if (tab === "transfer") return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), deliverer, when("Дата передачи", "date", "date")]
  return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), deliverer, who("Передал"), when("Дата передачи", "doneAt", "date")]
}

const EMPTY_TEXT: Record<PlanTaskTab, string> = {
  receive: "Нет товаров, ожидающих приемки",
  transfer: "Нет товаров, ожидающих передачи",
  receive_history: "По вашему запросу ничего не найдено",
  transfer_history: "По вашему запросу ничего не найдено",
}

export function StockPlanTasks({
  tab,
  state,
  update,
  rights,
  options,
  onOptionsWanted,
  notify,
  onChanged,
}: {
  tab: PlanTaskTab
  state: PlanState
  update: (changes: UrlChanges) => void
  rights: PlanRights
  options: StockOptions
  onOptionsWanted: () => void
  notify: (text: string, error?: boolean) => void
  /** A row action succeeded: refresh what depends on it (tab counts). */
  onChanged: () => void
}) {
  const { t } = useLanguage()
  const columns = useColumns(tab)
  const list = useCashJson<PlanTaskListResult>(`/api/stock/plan?${taskApiQuery(state, tab)}`)
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
    const timer = window.setTimeout(() => update({ search: value || null, page: null, id: null }), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search, update])

  const sort = (key: string) => update({ ordering: state.ordering === key ? `-${key}` : state.ordering === `-${key}` ? null : key, page: null })
  const openFilter = () => {
    onOptionsWanted()
    setFilterOpen(true)
  }
  const applyFilter = (changes: PlanFilterChanges) => {
    setFilterOpen(false)
    update({ ...changes, page: null, id: null })
  }

  const downloadExcel = async () => {
    setExporting(true)
    try {
      const response = await fetch(`/api/stock/plan?${taskApiQuery(state, tab, 0)}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (PlanTaskListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t(PLAN_TAB_LABELS[tab]), [columns.map((column) => t(column.label)), ...body.results.map((row) => columns.map((column) => column.excel(row)))])
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    } finally {
      setExporting(false)
    }
  }

  const th = "whitespace-nowrap px-3 py-3 text-left font-semibold"
  const td = "px-3 py-3 align-middle"

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
            onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize === 25 ? null : next.pageSize, id: null })}
          />
          <button
            type="button"
            onClick={() => void downloadExcel()}
            disabled={!data || exporting}
            title={t("Скачать Excel")}
            aria-label={t("Скачать Excel")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#4caf72] hover:bg-[#f2f5f8] disabled:opacity-40"
          >
            <FileSpreadsheet className="h-5 w-5" />
          </button>
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
        <table className="w-full min-w-[860px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-[#e1e5eb] text-[#17233b]">
              {columns.map((column, index) => (
                <th key={column.label} className={`${th} ${index === 0 ? "pl-6" : ""}`}>
                  {column.sort ? (
                    <button type="button" onClick={() => sort(column.sort!)} className="inline-flex items-center gap-1 font-semibold">
                      {t(column.label)}
                      <SortIcon ordering={state.ordering} sortKey={column.sort} />
                    </button>
                  ) : (
                    t(column.label)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const id = `${row.type}-${row.id}`
              const open = state.detail === id
              return (
                <Fragment key={id}>
                  <tr onClick={() => update({ id: open ? null : id })} className={`cursor-pointer border-b border-[#efefef] ${open ? "bg-[#eef2ff]" : "hover:bg-[#f2f5f8]"}`}>
                    {columns.map((column, index) => (
                      <td key={column.label} className={`${td} ${index === 0 ? "pl-6" : ""}`}>
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={columns.length} className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                        <StockPlanDetail
                          tab={tab}
                          row={row}
                          rights={rights}
                          onClose={() => update({ id: null })}
                          onDone={(message) => {
                            notify(message)
                            update({ id: null })
                            list.reload()
                            onChanged()
                          }}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center text-[#9aa3b6]">
                  {list.loading ? (
                    t("Загрузка...")
                  ) : list.error ? (
                    ""
                  ) : (
                    <span>{t(countPlanFilters(state) || state.search ? "По вашему запросу ничего не найдено" : EMPTY_TEXT[tab])}</span>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {filterOpen && (
        <PlanTaskFilterDialog tab={tab} state={state} options={options} doneByOptions={data?.doneByOptions ?? []} onClose={() => setFilterOpen(false)} onApply={applyFilter} />
      )}
    </section>
  )
}
