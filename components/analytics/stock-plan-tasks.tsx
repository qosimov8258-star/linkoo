"use client"

import { useEffect, useState, type ReactNode } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import type { StockOptions } from "@/components/analytics/stock-move-filters"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { ListBTable } from "@/components/analytics/list-b-table"
import { StockPlanDetail } from "@/components/analytics/stock-plan-detail"
import { RI, RefCard, RefIconButton, RefToolbar } from "@/components/ref/list-kit"
import { PlanTaskFilterDialog, type PlanFilterChanges } from "@/components/analytics/stock-plan-filters"
import { CLEAR_PLAN_FILTERS, countPlanFilters, planDate, taskApiQuery, type PlanState } from "@/components/analytics/stock-plan-state"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_TAB_LABELS, PLAN_TYPE_LABELS, type PlanTaskListResult, type PlanTaskRow, type PlanTaskTab } from "@/lib/stock-plan-types"

// The four task tabs of "План приемок и передач" (demo c88 / c89 grids):
//   Приемка           № | От кого | Тип | Дата приемки | Склад
//   История Приемки   № | От кого | Тип | Дата приемки | Принял | Склад
//   Передача          № | Дата запроса | Склад | Тип | Кому | Доставщик | Дата передачи
//   История Передачи  № | Дата запроса | Склад | Тип | Кому | Доставщик | Передал | Дата передачи
// A row expands into its document (StockPlanDetail). Data: GET /api/stock/plan.

type UrlChanges = Record<string, string | number | string[] | null>

type Column = { label: string; sort?: string; cell: (row: PlanTaskRow) => ReactNode; excel: (row: PlanTaskRow) => string | number }

function useColumns(tab: PlanTaskTab): Column[] {
  const { t, language } = useLanguage()
  const date = (iso: string) => (iso ? formatCategoryDate(iso.slice(0, 10), language) : "") || t("Не указана")
  const name = (value: string) => value || t("Не указано")
  const no: Column = { label: "№", sort: "id", cell: (row) => row.id, excel: (row) => row.id }
  const type: Column = { label: "Тип", sort: "type", cell: (row) => t(PLAN_TYPE_LABELS[row.type]), excel: (row) => t(PLAN_TYPE_LABELS[row.type]) }
  const warehouse: Column = { label: "Склад", sort: "warehouse", cell: (row) => name(row.warehouse), excel: (row) => row.warehouse }
  const party = (label: string): Column => ({ label, sort: "party", cell: (row) => name(row.party), excel: (row) => row.party })
  const when = (label: string, field: "date" | "requestDate" | "doneAt", sort: string): Column => ({ label, sort, cell: (row) => <span className="whitespace-nowrap">{date(row[field])}</span>, excel: (row) => planDate(row[field], language) })
  const who = (label: string): Column => ({ label, sort: "doneBy", cell: (row) => name(row.doneBy), excel: (row) => row.doneBy })
  const deliverer: Column = { label: "Доставщик", sort: "deliverer", cell: (row) => name(row.deliverer), excel: (row) => row.deliverer }
  if (tab === "receive") return [no, party("От кого"), type, when("Дата приемки", "date", "date"), warehouse]
  if (tab === "receive_history") return [{ ...no, label: "№ заказа" }, party("От кого"), type, when("Дата приемки", "doneAt", "date"), who("Принял"), warehouse]
  if (tab === "transfer") return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), who("Передал"), when("Дата передачи", "date", "date")]
  void deliverer
  return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), who("Передал"), when("Дата передачи", "doneAt", "date")]
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
  canWrite,
  options,
  onOptionsWanted,
  notify,
  onChanged,
}: {
  tab: PlanTaskTab
  state: PlanState
  update: (changes: UrlChanges) => void
  canWrite: boolean
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

  const pageSize = state.pageSize
  const total = data?.count ?? 0
  const page = data?.page ?? state.page
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  const filterCount = countPlanFilters(state)
  const gridCols = tab === "receive" ? "239px 461px 231px 230px 1fr" : tab === "receive_history" ? "239px 230px 231px 231px 230px 1fr" : "123px 231px 231px 115px 231px 230px 1fr"

  return (
    <RefCard className="mt-5 bg-white">
      <RefToolbar
        filterOpen={filterOpen}
        filterPanel={<PlanTaskFilterDialog tab={tab} state={state} options={options} doneByOptions={data?.doneByOptions ?? []} onClose={() => setFilterOpen(false)} onApply={applyFilter} />}
        leftSlot={
          filterCount === 0 ? (
            <button type="button" onClick={openFilter} className="text-[13px] text-[#4f71dc]">
              {t("Показать фильтр")} ⌄
            </button>
          ) : (
            <span className="ml-[5px] inline-flex h-[30px] items-center gap-2 rounded-md bg-[#efefef] px-4 text-[#666]">
              {t("Фильтр")}: {filterCount} {t("элемента")}
              <button type="button" onClick={openFilter} aria-label={t("Изменить")} className="border-l border-white pl-2 text-[#8f8f8f]">✎</button>
              <button type="button" onClick={() => update({ ...CLEAR_PLAN_FILTERS })} aria-label={t("Очистить")} className="border-l border-white pl-2 text-[#8f8f8f]">×</button>
            </span>
          )
        }
        query={searchDraft}
        onQuery={setSearchDraft}
        pageSize={pageSize}
        onPageSize={(size) => update({ pageSize: size === 25 ? null : size, page: null, id: null })}
        from={from}
        to={to}
        total={total}
        page={page}
        pageCount={pageCount}
        onPage={(next) => update({ page: next > 1 ? next : null, id: null })}
        icons={<RefIconButton path={RI.download} label={t("Скачать Excel")} color="#5d6474" onClick={() => !exporting && data && void downloadExcel()} />}
      />

      {list.error && !list.loading && (
        <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
          <span>
            {t("Не удалось загрузить данные")}: {t(list.error)}
          </span>
          <button type="button" onClick={list.reload} className="font-semibold text-[#4f71dc] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <div className={list.loading ? "opacity-60" : undefined}>
        <ListBTable
          cols={gridCols}
          minWidth={900}
          cellPad={0}
          heads={columns.map((column) =>
            column.sort ? (
              <button key={column.label} type="button" onClick={() => sort(column.sort!)} className="text-left font-semibold hover:opacity-80">
                {t(column.label)}
                {state.ordering === column.sort ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${column.sort}` ? <span className="ml-1 text-[10px]">▼</span> : null}
              </button>
            ) : (
              t(column.label)
            ),
          )}
          rows={rows}
          rowKey={(row) => `${row.type}-${row.id}`}
          rowClass={(row) => (state.detail === `${row.type}-${row.id}` ? "!bg-[#eef2ff]" : "")}
          onRowClick={(row) => update({ id: state.detail === `${row.type}-${row.id}` ? null : `${row.type}-${row.id}` })}
          empty={
            list.loading ? (
              t("Загрузка...")
            ) : list.error ? (
              ""
            ) : (
              <div className="flex flex-col items-center gap-2">
                <span>{t(filterCount || state.search ? "По вашему запросу ничего не найдено" : EMPTY_TEXT[tab])}</span>
                {(tab === "transfer" || tab === "transfer_history") && (
                  <span className="max-w-[560px] text-[13px]">
                    {t("Заказы появятся здесь, когда в заказе будет указан склад: модуль заказов пока не указывает склад")}
                  </span>
                )}
              </div>
            )
          }
          render={(row) => columns.map((column) => column.cell(row))}
          expanded={(row) =>
            state.detail === `${row.type}-${row.id}` ? (
              <div className="bg-[#f2f5f8] px-2 py-3 md:px-4">
                <StockPlanDetail
                  tab={tab}
                  row={row}
                  canWrite={canWrite}
                  onClose={() => update({ id: null })}
                  onDone={(message) => {
                    notify(message)
                    update({ id: null })
                    list.reload()
                    onChanged()
                  }}
                />
              </div>
            ) : null
          }
        />
      </div>

    </RefCard>
  )
}
