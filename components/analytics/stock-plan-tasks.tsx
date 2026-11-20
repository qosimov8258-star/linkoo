"use client"

import { useEffect, useState, type ReactNode } from "react"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import type { StockOptions } from "@/components/analytics/stock-move-filters"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { ListBTable } from "@/components/analytics/list-b-table"
import { StockPlanDetail } from "@/components/analytics/stock-plan-detail"
import { RI, RefAppliedFilter, RefCard, RefIconButton, RefToolbar } from "@/components/ref/list-kit"
import { PlanTaskFilterDialog, type PlanFilterChanges } from "@/components/analytics/stock-plan-filters"
import { CLEAR_PLAN_FILTERS, countPlanFilters, planDate, taskApiQuery, type PlanState } from "@/components/analytics/stock-plan-state"
import { downloadExcelTable } from "@/lib/excel-export"
import { useLanguage } from "@/lib/i18n/language-context"
import { PLAN_TAB_LABELS, PLAN_TYPE_LABELS, type PlanRights, type PlanTaskListResult, type PlanTaskRow, type PlanTaskTab } from "@/lib/stock-plan-types"

// The four task tabs of "План приемок и передач" (demo c88 / c89 grids):
//   (Тип: Поставка / Передача / Возврат on the receive tabs, Заказ / Передача on the transfer tabs)
//   Приемка           № | От кого | Тип | Дата приемки | Склад
//   История Приемки   № | От кого | Тип | Дата приемки | Принял | Склад
//   Передача          № | Дата запроса | Склад | Тип | Кому | Передал | Дата передачи
//   История Передачи  № | Дата запроса | Склад | Тип | Кому | Передал | Дата передачи
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
  // Linko's «Передал» without a user reads «Не указана» (its «Дата передачи» word).
  const who = (label: string, empty = "Не указано"): Column => ({ label, sort: "doneBy", cell: (row) => row.doneBy || t(empty), excel: (row) => row.doneBy })
  const deliverer: Column = { label: "Доставщик", sort: "deliverer", cell: (row) => name(row.deliverer), excel: (row) => row.deliverer }
  if (tab === "receive") return [no, party("От кого"), type, when("Дата приемки", "date", "date"), warehouse]
  if (tab === "receive_history") return [{ ...no, label: "№ заказа" }, party("От кого"), type, when("Дата приемки", "doneAt", "date"), who("Принял"), warehouse]
  if (tab === "transfer") return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), who("Передал", "Не указана"), when("Дата передачи", "doneAt", "date")]
  void deliverer
  return [no, when("Дата запроса", "requestDate", "requestDate"), warehouse, type, party("Кому"), who("Передал", "Не указана"), when("Дата передачи", "doneAt", "date")]
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

  const pageSize = state.pageSize
  const total = data?.count ?? 0
  const page = data?.page ?? state.page
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  const filterCount = countPlanFilters(state)
  // Linko's grid: 12 equal units inside the 30 px sides; a column's text starts 8 px in, the first one's at its edge.
  const units = tab === "receive" ? [2, 4, 2, 2, 2] : tab === "receive_history" ? [2, 2, 2, 2, 2, 2] : [1, 2, 2, 1, 2, 2, 2]
  const gridCols = units.map((unit) => `minmax(0,${unit}fr)`).join(" ")
  const inset = (index: number, node: ReactNode) => (index ? <span className="block pl-[8px]">{node}</span> : node)

  return (
    <RefCard className="mt-5 bg-white">
      <RefToolbar
        filterOpen={filterOpen}
        filterPanel={<PlanTaskFilterDialog tab={tab} state={state} options={options} doneByOptions={data?.doneByOptions ?? []} onClose={() => setFilterOpen(false)} onApply={applyFilter} />}
        // Linko's toolbar: «Показать фильтр» with its small chevron, the 300 px search 430 px from the window edge; an
        // applied filter turns into the grey «Фильтр: N элемента» bar.
        linkFilter="flush"
        thinChevron
        filterWidth={379.5}
        searchWidth={300}
        onToggleFilter={() => (filterOpen ? setFilterOpen(false) : openFilter())}
        leftSlot={
          filterCount > 0 && <RefAppliedFilter count={filterCount} width={371.5} shift={4} onEdit={openFilter} onClear={() => update({ ...CLEAR_PLAN_FILTERS })} />
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
          <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <div className={list.loading ? "opacity-60" : undefined}>
        <ListBTable
          cols={gridCols}
          minWidth={900}
          cellPad={0}
          heads={columns.map((column, index) =>
            inset(index, column.sort ? (
              <button key={column.label} type="button" onClick={() => sort(column.sort!)} className="text-left font-semibold hover:opacity-80">
                {t(column.label)}
                {state.ordering === column.sort ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${column.sort}` ? <span className="ml-1 text-[10px]">▼</span> : null}
              </button>
            ) : (
              t(column.label)
            )),
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
              <span>{t(filterCount || state.search ? "По вашему запросу ничего не найдено" : EMPTY_TEXT[tab])}</span>
            )
          }
          render={(row) => columns.map((column, index) => inset(index, column.cell(row)))}
          expanded={(row) =>
            state.detail === `${row.type}-${row.id}` ? (
              <div className="bg-[#f2f5f8] px-2 py-3 md:px-4">
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
              </div>
            ) : null
          }
        />
      </div>

    </RefCard>
  )
}
