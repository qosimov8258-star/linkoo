"use client"

import { useState } from "react"
import { CalendarDays, CircleAlert, Loader2, Reply, SearchX } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BalanceFilterButton, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useBalanceStatement } from "@/components/analytics/balance/use-balance"
import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import { CashBalanceSummary } from "@/components/analytics/cash-balance-summary"
import { CashTransactionsTable, cashOperationText } from "@/components/analytics/cash-balance-transactions"
import { OperationPopupDialog, type DetailsPopup } from "@/components/analytics/cash-management-details"
import { useJsonList, type CashCategory, type Named } from "@/components/analytics/cash-management-shared"
import { RefSearchSelect } from "@/components/analytics/ref-search-select"
import { DateRangePicker } from "@/components/dashboard/date-range-picker"
import { downloadExcelTable } from "@/lib/excel-export"
import type { CashListResult } from "@/lib/cash/types"
import { currencyLabel, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { StatementResult } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Detail of one cashbox (demo #/statistics/cashbox/:id): under the top menu, the filter row («Фильтр» with
// "Диапазон дат", "Категории расходов", "Тип", "Клиент", "Только не принятые переводы"; «Вернуться», «Скачать»), the
// cashbox totals (cards filter by type) and its transactions as the reference lists them (finance/transaction?cashbox=:
// the same operations as «Управления кассой», № = the document number). All of it lives in the URL
// (?cashbox=&type=&categoryExpense=&client=&notAcceptedTransfer=&search=…).

/** Demo transaction type codes of the detail filter → ledger movement column. */
export const CASH_TYPE_COLUMNS: Record<string, string> = {
  "1": "transfer_expense",
  "2": "transfer_income",
  "4": "income",
  "5": "expenses",
}

/** Movement column of a clicked list cell → demo type code (null for other columns). */
export const CASH_COLUMN_TYPES: Record<string, string> = Object.fromEntries(Object.entries(CASH_TYPE_COLUMNS).map(([type, column]) => [column, type]))

// Demo static items of the "Тип" select (FROM_TRANSFER, TO_TRANSFER, INCOME, OUTCOME).
const TYPE_OPTIONS = [
  { value: "1", label: "Перевод с кассы" },
  { value: "2", label: "Перевод на кассу" },
  { value: "4", label: "Приход" },
  { value: "5", label: "Расход" },
]

export const DEFAULT_DETAIL_PAGE_SIZE = 25

export type CashDetailState = {
  /** BalanceRow.key of the cashbox (cashboxes.id). */
  key: string
  /** "" | "1" | "2" | "4" | "5" */
  type: string
  /** Expense category id ("" = all). */
  category: string
  /** Client id ("" = all). */
  client: string
  notAccepted: boolean
  search: string
  page: number
  pageSize: number
}

type Period = { from: string; to: string }

function nonZero(values: Record<string, number> | undefined): boolean {
  return Object.values(values ?? {}).some((value) => typeof value === "number" && Math.abs(value) > 1e-9)
}

/** Currencies of the detail cards: the cashbox currency first, then any other currency with movements. */
function detailCurrencies(statement: StatementResult): string[] {
  const own = String(statement.entity.info.currency || "") || statement.visibleCurrencies[0] || statement.baseCurrency
  const others = statement.visibleCurrencies.filter((code) => code !== own && nonZero(statement.summary[code]))
  return [own, ...others]
}

const dayLabel = (iso: string, language: string) => formatStatementDate(iso, language === "ru" ? "ru" : language, false)

export function CashBalanceDetail({
  period,
  state,
  fallbackName,
  onChange,
  onClose,
}: {
  period: Period
  state: CashDetailState
  /** Cashbox name from the list, shown until the statement arrives. */
  fallbackName: string
  onChange: (period: Period, state: CashDetailState) => void
  onClose: () => void
}) {
  const { t, language } = useLanguage()
  const [filterOpen, setFilterOpen] = useState(false)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [lastSearch, setLastSearch] = useState(state.search)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")
  const [popup, setPopup] = useState<DetailsPopup | null>(null)
  if (state.search !== lastSearch) {
    // Keep the search box in sync with the URL (browser back / reset).
    setLastSearch(state.search)
    setSearchDraft(state.search)
  }

  const column = CASH_TYPE_COLUMNS[state.type]
  // The cards: the cashbox totals of the period (one statement page carries them).
  const { data: statement, loading: summaryLoading, error: summaryError, reload: reloadSummary } = useBalanceStatement("cashbox", state.key, {
    from: period.from,
    to: period.to,
    page: 1,
    pageSize: 1,
  })
  const listQuery = {
    cashbox: [state.key],
    from: period.from,
    to: period.to,
    type: state.type ? [state.type] : [],
    expenseCategory: state.category ? [state.category] : [],
    client: state.client ? [state.client] : [],
    notAcceptedTransfer: state.notAccepted && state.type === "1",
    search: state.search,
    ordering: "-id",
  }
  const list = useCashJson<CashListResult>(`/api/cash/operations?${buildCashQuery({ ...listQuery, page: state.page, pageSize: state.pageSize })}`)
  const rows = list.data?.rows ?? []
  const name = statement?.entity.name || fallbackName
  const currencies = statement ? detailCurrencies(statement) : []

  const update = (patch: Partial<CashDetailState>) => onChange(period, { ...state, page: 1, ...patch })
  // Demo badge: active detail filter keys except fromDate and search (toDate always counts).
  const filterCount = countActiveFilters({ toDate: period.to, type: state.type, categoryExpense: state.category, client: state.client, notAcceptedTransfer: state.notAccepted && state.type === "1" ? "1" : "" })

  const downloadAll = async () => {
    setDownloading(true)
    setDownloadError("")
    try {
      const response = await fetch(`/api/cash/operations?${buildCashQuery({ ...listQuery, page: 1, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (CashListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = [t("№"), t("Дата"), t("Создал"), t("Описание"), t("Сумма"), t("Валюта"), t("Тип оплаты"), `${t("Сумма")} ${currencyLabel(body.baseCurrency)}`]
      const lines = body.rows.map((row) => [
        row.docNo,
        formatStatementDate(row.date, language),
        row.createdBy,
        cashOperationText(row, t),
        roundMoney(row.amount),
        currencyLabel(row.currency),
        row.cashbox.type === "bank" ? t("банковский счет") : t("наличные"),
        row.baseAmount ?? "",
      ])
      downloadExcelTable(`cash-balance-${(name || state.key).replace(/[\\/:*?"<>|]+/g, "_")}`, [header, ...lines])
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  return (
    // The reference keeps its top menu above the detail (50 px) and drops the page title.
    <div className="fixed inset-x-0 bottom-0 top-[50px] z-[80] overflow-y-auto bg-white text-[13px] text-[#333]">
      <div className="relative px-[32px]">
        <section className="flex flex-wrap items-center gap-4 border-b border-[#efefef] pb-[20px] pt-[10px]">
          <BalanceFilterButton count={filterCount} from={period.from} to={period.to} onOpen={() => setFilterOpen(true)} />
          <div className="ml-auto flex items-center gap-[10px]">
            <button type="button" onClick={onClose} className="flex h-[34px] items-center gap-1 rounded-[5px] bg-[#1E4A9A] px-[16px] text-[13px] font-semibold text-white hover:brightness-95">
              <Reply className="h-[18px] w-[18px]" /> {t("Вернуться")}
            </button>
            <BalanceDownloadMenu disabled={downloading || !list.data} items={[{ label: "Скачать все", onClick: () => void downloadAll() }]} />
          </div>
        </section>
        {downloadError && (
          <p className="pt-2 text-sm text-[#e57373]">
            {t("Не удалось выполнить запрос")}: {t(downloadError)}
          </p>
        )}

        {filterOpen && <div className="fixed inset-x-0 bottom-0 top-[50px] z-20 bg-black/10" onClick={() => setFilterOpen(false)} />}
        {filterOpen && (
          <DetailFilter
            period={period}
            state={state}
            onClose={() => setFilterOpen(false)}
            onApply={(nextPeriod, patch) => {
              setFilterOpen(false)
              onChange(nextPeriod, { ...state, page: 1, ...patch })
            }}
          />
        )}

        {!statement && summaryLoading && (
          <div className="flex items-center justify-center gap-2 py-24 text-[#586174]">
            <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
          </div>
        )}
        {!statement && !summaryLoading && summaryError && (
          <div className="flex flex-col items-center gap-3 py-24 text-center text-[#586174]">
            <CircleAlert className="h-10 w-10 text-[#e57373]" />
            <p>
              {t("Не удалось выполнить запрос")}: {t(summaryError)}
            </p>
            <button type="button" onClick={reloadSummary} className="rounded-md border border-[#1E4A9A] px-4 py-2 font-semibold text-[#1E4A9A]">
              {t("Повторить")}
            </button>
          </div>
        )}

        {statement && (
          <>
            <div className="-mx-[32px] border-b border-[#efefef]">
              <CashBalanceSummary
                totals={statement.summary}
                currencies={currencies}
                loading={summaryLoading}
                activeField={column}
                onMetricClick={(field) => update({ type: CASH_COLUMN_TYPES[field] ?? "" })}
              />
            </div>

            <section className="pb-10">
              <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-4 border-b border-[#efefef]">
                <b>
                  {t("Транзакции")} {!list.loading || list.data ? <span>({name})</span> : null}
                </b>
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    update({ search: searchDraft.trim() })
                  }}
                >
                  <input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder={t("Поиск")}
                    aria-label={t("Поиск")}
                    className="h-[38px] w-[256px] border-b border-[#e0e0e0] bg-transparent text-[13px] outline-none placeholder:text-[#bdbdbd] focus:border-[#1E4A9A]"
                  />
                </form>
                <BalancePagination page={state.page} pageSize={state.pageSize} count={list.data?.count ?? 0} onChange={(next) => onChange(period, { ...state, ...next })} />
              </div>
              {list.error && (
                <p className="py-3 text-sm text-[#e57373]">
                  {t("Не удалось выполнить запрос")}: {t(list.error)}
                </p>
              )}
              {list.loading && !list.data ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-[#586174]" />
                </div>
              ) : rows.length ? (
                <CashTransactionsTable rows={rows} loading={list.loading} onPopup={setPopup} />
              ) : (
                <div className="flex flex-col items-center gap-3 py-20 text-center text-[13px] text-[#666]">
                  <SearchX className="h-12 w-12 text-[#999]" />
                  {t("По вашему запросу ничего не найдено")}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      {popup && <OperationPopupDialog popup={popup} onClose={() => setPopup(null)} />}
    </div>
  )
}

/** The detail's filter card (the reference's StatisticsFilterForm): full-width fields over the filter row. */
function DetailFilter({
  period: applied,
  state: current,
  onClose: close,
  onApply,
}: {
  period: Period
  state: CashDetailState
  onClose: () => void
  onApply: (period: Period, patch: Partial<CashDetailState>) => void
}) {
  const { t, language } = useLanguage()
  const [draft, setDraft] = useState({ from: applied.from, to: applied.to, type: current.type, category: current.category, client: current.client, notAccepted: current.notAccepted })
  const [pickerOpen, setPickerOpen] = useState(false)
  const categories = useCashJson<{ categories: CashCategory[] }>("/api/cash/categories").data?.categories ?? []
  const clients = useJsonList<Named>("/api/clients").items
  const expenseItems = categories.filter((item) => item.kind === "expense").map((item) => ({ value: String(item.id), label: item.name }))
  const clientItems = clients.map((item) => ({ value: String(item.id), label: item.name }))
  const typeItems = TYPE_OPTIONS.map((option) => ({ value: option.value, label: t(option.label) }))
  const pick = (items: Array<{ value: string; label: string }>, value: string) => (value ? [{ value, label: items.find((item) => item.value === value)?.label ?? value }] : [])
  return (
    <div className="absolute inset-x-[32px] top-[10px] z-30 bg-white px-[30px] pb-[20px] pt-[20px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]">
      <div className="flex h-[34px] items-center justify-between">
        <h3 className="text-[14px] font-semibold text-[#333]">{t("Фильтр")}</h3>
        <button type="button" onClick={close} aria-label={t("Закрыть")} className="text-[#666] hover:text-[#333]">
          <svg viewBox="0 0 24 24" className="h-[22px] w-[22px] fill-current" aria-hidden>
            <path d="M14.59 8 12 10.59 9.41 8 8 9.41 10.59 12 8 14.59 9.41 16 12 13.41 14.59 16 16 14.59 13.41 12 16 9.41 14.59 8zM12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z" />
          </svg>
        </button>
      </div>
      <div className="mt-[10px] flex flex-col">
        <div className="relative h-[60px]">
          <span className="absolute left-0 top-[8px] text-[10px] font-bold leading-3 text-black">{t("Диапазон дат")}</span>
          <button type="button" onClick={() => setPickerOpen((open) => !open)} className="absolute inset-x-0 top-[22px] flex h-[36px] items-center justify-between border-b border-[#e0e0e0] text-left text-[13px] text-black">
            <span>
              {dayLabel(draft.from, language)} – {dayLabel(draft.to, language)}
            </span>
            <CalendarDays className="h-[18px] w-[18px] text-[#8a90a0]" />
          </button>
          {pickerOpen && (
            <DateRangePicker
              positionClassName="left-0 top-[58px]"
              begin={draft.from}
              end={draft.to}
              onClose={() => setPickerOpen(false)}
              onApply={(from, to) => {
                setDraft((value) => ({ ...value, from, to }))
                setPickerOpen(false)
              }}
            />
          )}
        </div>
        <RefSearchSelect label={t("Категории расходов")} items={expenseItems} selected={pick(expenseItems, draft.category)} onChange={(next) => setDraft((value) => ({ ...value, category: next[0]?.value ?? "" }))} />
        <RefSearchSelect label={t("Тип")} items={typeItems} selected={pick(typeItems, draft.type)} onChange={(next) => setDraft((value) => ({ ...value, type: next[0]?.value ?? "" }))} searchable={false} />
        <RefSearchSelect label={t("Клиент")} items={clientItems} selected={pick(clientItems, draft.client)} onChange={(next) => setDraft((value) => ({ ...value, client: next[0]?.value ?? "" }))} />
        {draft.type === "1" && (
          <label className="flex h-[40px] cursor-pointer items-center gap-[10px] text-[13px] font-semibold text-[#333]">
            <input type="checkbox" checked={draft.notAccepted} onChange={(event) => setDraft((value) => ({ ...value, notAccepted: event.target.checked }))} className="h-[18px] w-[18px] accent-[#5d6474]" />
            {t("Только не принятые переводы")}
          </label>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          const ordered = draft.from <= draft.to ? { from: draft.from, to: draft.to } : { from: draft.to, to: draft.from }
          onApply(ordered, { type: draft.type, category: draft.category, client: draft.client, notAccepted: draft.type === "1" && draft.notAccepted })
        }}
        className="mt-[10px] h-9 w-full rounded-[5px] bg-[#71ce87] text-[13px] font-semibold text-white hover:brightness-95"
      >
        {t("Применить")}
      </button>
    </div>
  )
}
