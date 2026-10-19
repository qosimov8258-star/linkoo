"use client"

import { useState } from "react"
import { ArrowLeft, CircleAlert, Loader2, SearchX } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BalanceFilterButton, BalanceFilterDialog, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildBalanceQuery, useBalanceStatement, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { CashBalanceSummary } from "@/components/analytics/cash-balance-summary"
import { CashTransactionsTable, cashTransactionText, internalAmount } from "@/components/analytics/cash-balance-transactions"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, roundMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import type { StatementResult, StatementRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// Detail of one cashbox (demo #/statistics/cashbox/:id): a full-screen
// overlay above the list with its own filter ("Диапазон дат", "Категории
// расходов", "Тип", "Клиент", "Только не принятые переводы"), the cashbox
// totals whose movement cards filter by type, and the paged transactions.
// All of it lives in the URL (?cashbox=&type=&categoryExpense=&client=…).

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
  category: string
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
  const [draft, setDraft] = useState({ type: "", category: "", client: "", notAccepted: false })
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [lastSearch, setLastSearch] = useState(state.search)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")
  if (state.search !== lastSearch) {
    // Keep the search box in sync with the URL (browser back / reset).
    setLastSearch(state.search)
    setSearchDraft(state.search)
  }

  const column = CASH_TYPE_COLUMNS[state.type]
  // "Только не принятые переводы" (only with Тип = Перевод с кассы): the
  // statement API has no such flag, so the rows are fetched unpaged and
  // filtered + paged here.
  const onlyNotAccepted = state.notAccepted && state.type === "1"
  const query: BalanceQuery = {
    from: period.from,
    to: period.to,
    column: column ? [column] : undefined,
    category: state.category,
    counterparty: state.client,
    search: state.search,
    order: "desc",
    page: onlyNotAccepted ? undefined : state.page,
    pageSize: onlyNotAccepted ? 0 : state.pageSize,
  }
  const { data: statement, loading, error, reload } = useBalanceStatement("cashbox", state.key, query)

  const keepNotAccepted = (rows: StatementRow[]) => (onlyNotAccepted ? rows.filter((row) => !row.accepted) : rows)
  const filteredRows = statement ? keepNotAccepted(statement.rows) : []
  const count = statement ? (onlyNotAccepted ? filteredRows.length : statement.count) : 0
  const pageRows = onlyNotAccepted ? filteredRows.slice((state.page - 1) * state.pageSize, state.page * state.pageSize) : filteredRows
  const name = statement?.entity.name || fallbackName
  const currencies = statement ? detailCurrencies(statement) : []

  const update = (patch: Partial<CashDetailState>) => onChange(period, { ...state, page: 1, ...patch })
  // Demo badge: active detail filter keys except fromDate and search (toDate always counts).
  const filterCount = countActiveFilters({ toDate: period.to, type: state.type, categoryExpense: state.category, client: state.client })

  const openFilter = () => {
    setDraft({ type: state.type, category: state.category, client: state.client, notAccepted: state.notAccepted })
    setFilterOpen(true)
  }
  const applyFilter = (next: Period) =>
    onChange(next, { ...state, page: 1, type: draft.type, category: draft.category, client: draft.client, notAccepted: draft.type === "1" && draft.notAccepted })

  const withCurrent = (options: string[], current: string) => (current && !options.includes(current) ? [current, ...options] : options)
  const categoryOptions = withCurrent(statement?.facets.categories ?? [], draft.category)
  const clientOptions = withCurrent(statement?.facets.counterparties ?? [], draft.client)

  const downloadAll = async () => {
    setDownloading(true)
    setDownloadError("")
    try {
      const response = await fetch(`/api/balances/cashbox/statement?${buildBalanceQuery({ ...query, key: state.key, page: undefined, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (StatementResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = [t("№"), t("Дата"), t("Создал"), t("Описание"), t("Сумма"), t("Валюта"), t("Тип оплаты"), `${t("Сумма")} ${currencyLabel(body.baseCurrency)}`]
      const rows = keepNotAccepted(body.rows).map((row) => [
        row.sourceId ?? "",
        formatStatementDate(row.date, language),
        row.createdBy,
        cashTransactionText(row, t),
        roundMoney(row.amount),
        currencyLabel(row.currency),
        row.paymentType === "bank" ? t("банковский счет") : t("наличные"),
        row.currency === body.baseCurrency ? roundMoney(row.amount) : (internalAmount(row, body.baseCurrency, body.currencies)?.amount ?? ""),
      ])
      downloadExcelTable(`cash-balance-${(body.entity.name || state.key).replace(/[\\/:*?"<>|]+/g, "_")}`, [header, ...rows])
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Баланс кассы")}</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <BalanceFilterButton count={filterCount} from={period.from} to={period.to} onOpen={openFilter} />
        <div className="ml-auto flex items-center gap-3">
          <button type="button" onClick={onClose} className="flex h-11 items-center gap-2 rounded-md bg-[#4f71dc] px-5 font-semibold text-white">
            <ArrowLeft className="h-4 w-4" /> {t("Вернуться")}
          </button>
          <BalanceDownloadMenu disabled={downloading || !statement} items={[{ label: "Скачать все", onClick: () => void downloadAll() }]} />
        </div>
      </section>
      {downloadError && (
        <p className="px-6 pb-2 text-sm text-[#e57373] md:px-9">
          {t("Не удалось выполнить запрос")}: {t(downloadError)}
        </p>
      )}

      {!statement && loading && (
        <div className="flex items-center justify-center gap-2 py-24 text-[#586174]">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      )}
      {!statement && !loading && error && (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-[#586174]">
          <CircleAlert className="h-10 w-10 text-[#e57373]" />
          <p>
            {t("Не удалось выполнить запрос")}: {t(error)}
          </p>
          <button type="button" onClick={reload} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
            {t("Повторить")}
          </button>
        </div>
      )}

      {statement && (
        <>
          <div className="border-t border-[#efefef]">
            <CashBalanceSummary
              totals={statement.summary}
              currencies={currencies}
              loading={loading}
              activeField={column}
              onMetricClick={(field) => update({ type: CASH_COLUMN_TYPES[field] ?? "" })}
            />
          </div>

          <section className="px-6 pb-10 md:px-9">
            <div className="flex flex-wrap items-center justify-between gap-4 border-y border-[#efefef] py-2">
              <b>
                {t("Транзакции")} ({name})
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
                  className="h-9 w-64 border-b border-[#dbe0e8] bg-transparent outline-none focus:border-[#4f70e7]"
                />
              </form>
              <BalancePagination page={state.page} pageSize={state.pageSize} count={count} onChange={(next) => onChange(period, { ...state, ...next })} />
            </div>
            {error && (
              <p className="py-3 text-sm text-[#e57373]">
                {t("Не удалось выполнить запрос")}: {t(error)}
              </p>
            )}
            {pageRows.length ? (
              <CashTransactionsTable rows={pageRows} baseCurrency={statement.baseCurrency} currencies={statement.currencies} loading={loading} />
            ) : (
              <div className="flex flex-col items-center gap-3 py-20 text-center text-[13px] text-[#666]">
                <SearchX className="h-12 w-12 text-[#999]" />
                {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
              </div>
            )}
          </section>
        </>
      )}

      <BalanceFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} from={period.from} to={period.to} onApply={applyFilter}>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Категории расходов")}</span>
          <select value={draft.category} onChange={(event) => setDraft((value) => ({ ...value, category: event.target.value }))} className="h-10 rounded-md border border-[#dbe0e8] bg-white px-3">
            <option value="">{t("Все")}</option>
            {categoryOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Тип")}</span>
          <select value={draft.type} onChange={(event) => setDraft((value) => ({ ...value, type: event.target.value }))} className="h-10 rounded-md border border-[#dbe0e8] bg-white px-3">
            <option value="">{t("Все")}</option>
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.label)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Клиент")}</span>
          <select value={draft.client} onChange={(event) => setDraft((value) => ({ ...value, client: event.target.value }))} className="h-10 rounded-md border border-[#dbe0e8] bg-white px-3">
            <option value="">{t("Все")}</option>
            {clientOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {draft.type === "1" && (
          <label className="flex items-center gap-2 self-end pb-2">
            <input
              type="checkbox"
              checked={draft.notAccepted}
              onChange={(event) => setDraft((value) => ({ ...value, notAccepted: event.target.checked }))}
              className="h-4 w-4 accent-[#4f70e7]"
            />
            <span>{t("Только не принятые переводы")}</span>
          </label>
        )}
      </BalanceFilterDialog>
    </div>
  )
}
