"use client"

import { Suspense, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { CircleAlert, Loader2, SearchX } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { BalanceFilterButton, BalanceFilterDialog, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { useBalanceList } from "@/components/analytics/balance/use-balance"
import { CASH_COLUMN_TYPES, CashBalanceDetail, DEFAULT_DETAIL_PAGE_SIZE, type CashDetailState } from "@/components/analytics/cash-balance-detail"
import { CashBalanceSummary } from "@/components/analytics/cash-balance-summary"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel } from "@/lib/finance/currency"
import { defaultBalancePeriod, isIsoDay } from "@/lib/finance/dates"
import { sortBalanceRows } from "@/lib/finance/rows"
import { MOVEMENT_LABELS, type BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс кассы" (demo #/statistics/cashbox): one row per cashbox in its own
// currency — balance before the period, income / expenses / transfers inside
// it and the closing balance — with per-currency totals on top. Clicking a
// cell opens the cashbox detail (filtered by the clicked movement type).
// Data: GET /api/balances/cashbox (the shared finance ledger). The period and
// the open detail live in the URL (?fromDate&toDate&cashbox&type…), so the
// management balance links and browser back work like the demo's hash routes.

const GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.cashbox).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец периода" },
]

const cashierOf = (row: BalanceRow, t: (text: string) => string) => String(row.info.cashier || "") || t("Неизвестно")
const typeOf = (row: BalanceRow, t: (text: string) => string) => (row.info.type === "bank" ? t("Перечислением") : t("Наличными"))

type Period = { from: string; to: string }

/** Period from ?fromDate&toDate (demo menu default: 1st of the month .. today). */
function readPeriod(params: URLSearchParams): Period {
  const fallback = defaultBalancePeriod()
  const fromParam = params.get("fromDate")
  const toParam = params.get("toDate")
  const from = isIsoDay(fromParam) ? fromParam : fallback.from
  const to = isIsoDay(toParam) ? toParam : from > fallback.to ? from : fallback.to
  return from <= to ? { from, to } : { from: to, to: from }
}

function readDetail(params: URLSearchParams): CashDetailState | null {
  const key = params.get("cashbox")?.trim()
  if (!key) return null
  const type = params.get("type") ?? ""
  const page = Number(params.get("page"))
  const pageSize = Number(params.get("pageSize"))
  return {
    key,
    type: ["1", "2", "4", "5"].includes(type) ? type : "",
    category: params.get("categoryExpense") ?? "",
    client: params.get("client") ?? "",
    notAccepted: type === "1" && ["1", "true"].includes(params.get("notAcceptedTransfer") ?? ""),
    search: params.get("search") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_DETAIL_PAGE_SIZE,
  }
}

/** Pushes a new URL state (the app router keeps useSearchParams in sync with history.pushState). */
function pushState(period: Period, detail: CashDetailState | null) {
  const params = new URLSearchParams({ fromDate: period.from, toDate: period.to })
  if (detail) {
    params.set("cashbox", detail.key)
    if (detail.type) params.set("type", detail.type)
    if (detail.category) params.set("categoryExpense", detail.category)
    if (detail.client) params.set("client", detail.client)
    if (detail.notAccepted && detail.type === "1") params.set("notAcceptedTransfer", "1")
    if (detail.search) params.set("search", detail.search)
    if (detail.page > 1) params.set("page", String(detail.page))
    if (detail.pageSize !== DEFAULT_DETAIL_PAGE_SIZE) params.set("pageSize", String(detail.pageSize))
  }
  window.history.pushState(null, "", `${window.location.pathname}?${params.toString()}`)
}

export function CashBalanceView() {
  return (
    <Suspense fallback={null}>
      <CashBalanceContent />
    </Suspense>
  )
}

function CashBalanceContent() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const urlState = searchParams.toString()
  const { period, detail } = useMemo(() => {
    const params = new URLSearchParams(urlState)
    return { period: readPeriod(params), detail: readDetail(params) }
  }, [urlState])

  const [filterOpen, setFilterOpen] = useState(false)
  // Client-side multi-sort, as the demo (lodash orderBy over the loaded rows).
  const [ordering, setOrdering] = useState<string[]>([])

  const { data, loading, error, reload } = useBalanceList("cashbox", { from: period.from, to: period.to })
  const rows = useMemo(() => sortBalanceRows([...(data?.rows ?? [])], ordering), [data, ordering])

  const changeOrdering = (next: string[]) => {
    // Demo sort header: the clicked column moves to the end of the multi-sort list.
    const changed = next.find((key) => !ordering.includes(key))
    setOrdering(changed ? [...next.filter((key) => key !== changed), changed] : next)
  }

  const openDetail = (row: BalanceRow, field: string | null) =>
    pushState(period, {
      key: row.key,
      type: (field && CASH_COLUMN_TYPES[field]) || "",
      category: "",
      client: "",
      notAccepted: false,
      search: "",
      page: 1,
      pageSize: DEFAULT_DETAIL_PAGE_SIZE,
    })

  const downloadAll = () => {
    if (!data) return
    const table = balanceListExcelRows({
      rows,
      groups: GROUPS,
      currencies: data.visibleCurrencies,
      leading: [
        { label: "Кассы", value: (row) => row.name },
        { label: "Валюта", value: (row) => currencyLabel(String(row.info.currency || data.baseCurrency)) },
      ],
      trailing: [
        { label: "Кассир", value: (row) => cashierOf(row, t) },
        { label: "Тип", value: (row) => typeOf(row, t) },
      ],
      totals: data.totals,
      t,
    })
    downloadExcelTable(`cash-balance-${period.from}-${period.to}`, table)
  }

  const detailName = detail ? (data?.rows.find((row) => row.key === detail.key)?.name ?? "") : ""

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Баланс кассы")}</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <BalanceFilterButton count={countActiveFilters({ toDate: period.to })} from={period.from} to={period.to} onOpen={() => setFilterOpen(true)} />
        <div className="ml-auto">
          <BalanceDownloadMenu disabled={!data?.rows.length} items={[{ label: "Скачать все", onClick: downloadAll }]} />
        </div>
      </section>

      {!data && loading && (
        <div className="flex items-center justify-center gap-2 py-24 text-[#586174]">
          <Loader2 className="h-5 w-5 animate-spin" /> {t("Загрузка...")}
        </div>
      )}
      {error && (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-[#586174]">
          <CircleAlert className="h-10 w-10 text-[#e57373]" />
          <p>
            {t("Не удалось выполнить запрос")}: {t(error)}
          </p>
          <button type="button" onClick={reload} className="rounded-md border border-[#4f70e7] px-4 py-2 font-semibold text-[#4f70e7]">
            {t("Повторить")}
          </button>
        </div>
      )}
      {data && !rows.length && !error && (
        <div className="flex flex-col items-center gap-3 py-24 text-center text-[13px] text-[#666]">
          <SearchX className="h-12 w-12 text-[#999]" />
          {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
        </div>
      )}
      {data && rows.length > 0 && (
        <>
          <CashBalanceSummary totals={data.totals} currencies={data.visibleCurrencies} loading={loading} />
          <section className="pb-10">
            <BalanceTable
              rows={rows}
              groups={GROUPS}
              currencies={data.visibleCurrencies}
              first={{ label: "Кассы", render: (row) => row.name }}
              cellCurrency={(row) => String(row.info.currency || data.baseCurrency)}
              trailing={[
                { label: "Кассир", render: (row) => cashierOf(row, t) },
                { label: "Тип", render: (row) => typeOf(row, t) },
              ]}
              ordering={ordering}
              onOrderingChange={changeOrdering}
              sortCycle="desc-first"
              multiSort
              onCellClick={openDetail}
              headerTone="blue"
              loading={loading}
            />
          </section>
        </>
      )}

      <BalanceFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} from={period.from} to={period.to} onApply={(next) => pushState(next, null)} />

      {detail && (
        <CashBalanceDetail
          period={period}
          state={detail}
          fallbackName={detailName}
          onChange={(nextPeriod, nextState) => pushState(nextPeriod, nextState)}
          onClose={() => pushState(period, null)}
        />
      )}
    </main>
  )
}
