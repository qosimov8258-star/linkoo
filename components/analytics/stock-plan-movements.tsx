"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"

import { useCashJson } from "@/components/analytics/cash/use-cash"
import { ListBTable } from "@/components/analytics/list-b-table"
import type { StockOptions } from "@/components/analytics/stock-move-filters"
import { PlanMoveFilterDialog, type PlanFilterChanges } from "@/components/analytics/stock-plan-filters"
import { CLEAR_PLAN_FILTERS, countPlanFilters, moveApiQuery, planQty, type PlanState } from "@/components/analytics/stock-plan-state"
import { RI, RefCard, RefIconButton, RefToolbar } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import { formatCategoryDate } from "@/components/analytics/categories-grid"
import { useLanguage } from "@/lib/i18n/language-context"
import { planMoveType, type PlanMovementResult, type PlanMovementRow } from "@/lib/stock-plan-types"

// "Движение товаров" (demo stock/barcode_history): every stock ledger line as the reference
// lists it — Товар (↓ green in / ↑ red out) | Кол-во | Серия | Дата | Склад | Тип + № of the
// document (blue). Filters: Тип продукта, Тип, Товар, Склад, Статус (Приход / Расход), Период.
// The checklist icon shows the checkbox column (?showCheckboxes=true); "Скачать все" lives in
// the page menu (⋮) of StockPlanView and arrives as the "plan-movements-download-all" event.
// Data: GET /api/stock/plan/movements (lib/stock stockMovementsSql()).

type UrlChanges = Record<string, string | number | string[] | null>

export const PLAN_MOVEMENTS_DOWNLOAD_EVENT = "plan-movements-download-all"

const ARROW_DOWN = "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z"
const ARROW_UP = "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z"
const SELECT_ALL =
  "M3 5h2V3c-1.1 0-2 .9-2 2zm0 8h2v-2H3v2zm4 8h2v-2H7v2zM3 9h2V7H3v2zm10-6h-2v2h2V3zm6 0v2h2c0-1.1-.9-2-2-2zM5 21v-2H3c0 1.1.9 2 2 2zm-2-4h2v-2H3v2zM9 3H7v2h2V3zm2 18h2v-2h-2v2zm8-8h2v-2h-2v2zm0 8c1.1 0 2-.9 2-2h-2v2zm0-12h2V7h-2v2zm0 8h2v-2h-2v2zm-4 4h2v-2h-2v2zm0-16h2V3h-2v2zM7 17h10V7H7v10zm2-8h6v6H9V9z"
const EYE_OFF =
  "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button type="button" onClick={onChange} aria-pressed={checked} className="flex h-6 w-6 shrink-0 items-center justify-center">
      <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]">
        <path d={checked ? "M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" : "M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z"} />
      </svg>
    </button>
  )
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
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const showCheckboxes = searchParams.get("showCheckboxes") === "true"
  const list = useCashJson<PlanMovementResult>(`/api/stock/plan/movements?${moveApiQuery(state)}`)
  const data = list.data
  const rows = data?.results ?? []
  const [filterOpen, setFilterOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
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
  const openFilter = () => {
    onOptionsWanted()
    setFilterOpen(true)
  }
  const applyFilter = (changes: PlanFilterChanges) => {
    setFilterOpen(false)
    update({ ...changes, page: null })
  }

  const typeText = (row: PlanMovementRow) => t(planMoveType(row.kind).label)
  const dateText = (row: PlanMovementRow) => (row.day ? `${formatCategoryDate(row.day, language)}${row.time ? `, ${row.time}` : ""}` : t("Не указана"))
  const exportRows = (source: PlanMovementRow[]) => {
    const header = ["Дата", "Склад", "Тип", "№", "Товар", "Кол-во", "Ед. измерения", "Серия"].map((label) => t(label))
    const lines = source.map((row) => [
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
  }
  const downloadAll = async () => {
    setExporting(true)
    try {
      const response = await fetch(`/api/stock/plan/movements?${moveApiQuery(state, 0)}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (PlanMovementResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      exportRows(body.results)
    } catch (reason) {
      notify(reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), true)
    } finally {
      setExporting(false)
    }
  }
  // The page menu (⋮) of StockPlanView asks for "Скачать все".
  useEffect(() => {
    const handler = () => void downloadAll()
    window.addEventListener(PLAN_MOVEMENTS_DOWNLOAD_EVENT, handler)
    return () => window.removeEventListener(PLAN_MOVEMENTS_DOWNLOAD_EVENT, handler)
  })

  const pageSize = state.pageSize
  const total = data?.count ?? 0
  const page = data?.page ?? state.page
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
  const from = total > 0 ? (page - 1) * pageSize + 1 : 0
  const to = Math.min(total, page * pageSize)
  const filterCount = countPlanFilters(state)
  const allChecked = rows.length > 0 && rows.every((row) => selected.includes(row.id))
  const toggleAll = () => setSelected(allChecked ? [] : rows.map((row) => row.id))
  const toggleRow = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((value) => value !== id) : [...current, id]))
  const toggleCheckboxes = () => {
    setSelected([])
    update({ showCheckboxes: showCheckboxes ? null : "true" })
  }

  const headLabel = (key: string, label: string) => (
    <button key={key} type="button" onClick={() => sort(key)} className="text-left font-semibold hover:opacity-80">
      {t(label)}
      {state.ordering === key ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${key}` ? <span className="ml-1 text-[10px]">▼</span> : null}
    </button>
  )

  return (
    <RefCard className="mt-5 bg-white">
      <RefToolbar
        filterOpen={filterOpen}
        filterPanel={<PlanMoveFilterDialog state={state} options={options} onClose={() => setFilterOpen(false)} onApply={applyFilter} />}
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
        onPageSize={(size) => update({ pageSize: size === 25 ? null : size, page: null })}
        from={from}
        to={to}
        total={total}
        page={page}
        pageCount={pageCount}
        onPage={(next) => update({ page: next > 1 ? next : null })}
        icons={
          <>
            <RefIconButton path={showCheckboxes ? EYE_OFF : RI.checklist} label={t("Выбрать из списка")} color="#5d6474" onClick={toggleCheckboxes} />
            <RefIconButton
              path={RI.download}
              label={t("Скачать Excel")}
              color="#5d6474"
              onClick={() => {
                if (exporting || !data) return
                const chosen = rows.filter((row) => selected.includes(row.id))
                exportRows(chosen.length ? chosen : rows)
              }}
            />
          </>
        }
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
          cols={showCheckboxes ? "483px 113px 114px 227px 227px 1fr" : "469px 116px 115px 231px 230px 1fr"}
          minWidth={900}
          cellPad={0}
          heads={[
            showCheckboxes ? (
              <span key="goods" className="inline-flex items-center gap-[6px] -ml-[6px]">
                <button type="button" onClick={toggleAll} aria-label={t("Выбрать все")} className="flex h-6 w-6 items-center justify-center">
                  <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
                    <path d={SELECT_ALL} />
                  </svg>
                </button>
                {t("Товар")}
              </span>
            ) : (
              t("Товар")
            ),
            headLabel("qty", "Кол-во"),
            t("Серия"),
            headLabel("day", "Дата"),
            headLabel("warehouse", "Склад"),
            t("Тип"),
          ]}
          rows={rows}
          rowKey={(row) => row.id}
          rowClass={(row) => (row.isDefect ? "!bg-[#fff4f4]" : "")}
          empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
          render={(row) => {
            const out = row.qty < 0
            return [
              <span key="goods" className={`relative top-[2px] inline-flex items-center ${showCheckboxes ? "-ml-[6px]" : ""}`}>
                {showCheckboxes && <Checkbox checked={selected.includes(row.id)} onChange={() => toggleRow(row.id)} />}
                <svg viewBox="0 0 24 24" className={`${showCheckboxes ? "ml-[1px]" : ""} h-4 w-4 shrink-0 ${out ? "fill-[#ff584b]" : "fill-[#6fc988]"}`}>
                  <path d={out ? ARROW_UP : ARROW_DOWN} />
                </svg>
                <span className={showCheckboxes ? "ml-[6px]" : "ml-[5px]"}>{row.name}</span>
                {row.isDefect && <strong className="ml-2 text-[#e57373]">{t("брак")}</strong>}
              </span>,
              <span key="qty" className="whitespace-nowrap">
                {planQty(row.qty, row.unit, t)}
              </span>,
              "-",
              <span key="day" className="whitespace-nowrap">
                {dateText(row)}
              </span>,
              row.warehouse,
              <span key="type">
                {typeText(row)} <span className="ml-1 font-semibold text-[#1ca1f5]">{row.docNumber}</span>
              </span>,
            ]
          }}
        />
      </div>
    </RefCard>
  )
}
