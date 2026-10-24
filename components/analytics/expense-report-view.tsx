"use client"

import { Suspense, useCallback, useState, type FormEvent } from "react"
import Image from "next/image"
import { usePathname, useSearchParams } from "next/navigation"
import { CircleAlert, Loader2, Search, TriangleAlert } from "lucide-react"

import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { BalanceFilterButton, BalanceFilterDialog, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { useLookup } from "@/components/analytics/balance/use-balance"
import { buildCashQuery, useCashJson, type CashQuery } from "@/components/analytics/cash/use-cash"
import { MultiSelect } from "@/components/analytics/client-balance-filters"
import { DEFAULT_DETAIL_PAGE_SIZE, DETAIL_PAGE_SIZES, ExpenseDrilldownDialog } from "@/components/analytics/expense-drilldown-dialog"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import type { ExpenseReportItem, ExpenseReportList } from "@/lib/cash/reports"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney, roundMoney } from "@/lib/finance/currency"
import { formatDotDate, isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// Shared page of "Расходы по категориям" (demo #/statistics/outcome-category)
// and "Расходы на персонал" (demo #/statistics/expenditure-on-staff): filter
// header ("Фильтр / N", period, scope, "Скачать" → "Список" / "Скачать все"),
// search + pagination, then one flat row per category / employee with the
// share bar and the base-currency sum. A row opens the drill-down dialog.
// Data: /api/cash/reports/{expenses-by-category|staff-expenses}/{list,detail}.
// Everything lives in the URL with the demo keys (fromDate, toDate, branch,
// division, expenseCategory, search, page, pageSize, openTransactionDialog,
// dPage, dPageSize); the period defaults to the whole current month.

export type ExpenseReportConfig = {
  /** Page title (Russian i18n key). */
  title: string
  /** First column ("Категория" / "Сотрудник"). */
  nameLabel: string
  /** Shown for rows without a name ("Не указано" / "Не указан"). */
  emptyName: string
  /** /api/cash/reports/<report> (…/list and …/detail). */
  endpoint: string
  /** Query param of the drill-down: the row key or the employee id. */
  detailParam: "key" | "employee"
  /** "Категория расходов" filter (staff report). */
  categoryFilter?: boolean
  /** Excel file title. */
  excelTitle: string
  /** Drill-down rows open the cash page (staff report). */
  rowLinks?: boolean
}

const PAGE_SIZES = [10, 25, 50, 100, 200, 500] as const

type Named = { id: number; name: string }
type CategoryOption = { id: number; name: string; parentId: number | null }
type UrlValue = string | number | Array<string | number> | null | undefined

/** URL query state (demo hashHistory.push): pushState keeps Next's useSearchParams in sync without a server round trip. */
function useUrlState() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const update = useCallback(
    (changes: Record<string, UrlValue>) => {
      const params = new URLSearchParams(window.location.search)
      for (const [name, value] of Object.entries(changes)) {
        params.delete(name)
        if (Array.isArray(value)) value.filter((item) => item !== "").forEach((item) => params.append(name, String(item)))
        else if (value !== null && value !== undefined && value !== "") params.set(name, String(value))
      }
      const query = params.toString()
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [pathname],
  )
  return { searchParams, update }
}

function positiveInt(value: string, fallback: number): number {
  const parsed = Math.floor(Number(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function sizeOf(value: string, sizes: readonly number[], fallback: number): number {
  return sizes.includes(Number(value)) ? Number(value) : fallback
}

/** Repeated params and the demo "1-2-3" form. */
function idList(values: string[]): number[] {
  return [...new Set(values.flatMap((value) => value.split(/[,-]/)).map((value) => Number(value.trim())))].filter((value) => Number.isInteger(value) && value > 0)
}

function withSelected(names: string[], selected: string[]) {
  return [...new Set([...selected, ...names])].map((name) => ({ value: name, label: name }))
}

export function ExpenseReportView({ config }: { config: ExpenseReportConfig }) {
  return (
    <Suspense fallback={null}>
      <ExpenseReportContent config={config} />
    </Suspense>
  )
}

function ExpenseReportContent({ config }: { config: ExpenseReportConfig }) {
  const { t } = useLanguage()
  const { searchParams, update } = useUrlState()
  const get = (name: string) => searchParams.get(name) ?? ""

  // --- URL state ------------------------------------------------------------------
  const today = todayIso()
  const urlFrom = isIsoDay(get("fromDate")) ? get("fromDate") : ""
  const urlTo = isIsoDay(get("toDate")) ? get("toDate") : ""
  // Demo default period: the whole current month.
  const periodFrom = urlFrom || monthStartIso(today)
  const periodTo = urlTo || monthEndIso(today)
  const [from, to] = periodFrom <= periodTo ? [periodFrom, periodTo] : [periodTo, periodFrom]
  const branches = searchParams.getAll("branch").filter(Boolean)
  const divisions = searchParams.getAll("division").filter(Boolean)
  const categoryIds = config.categoryFilter ? idList(searchParams.getAll("expenseCategory")) : []
  const search = get("search").trim()
  const page = positiveInt(get("page"), 1)
  const pageSize = sizeOf(get("pageSize"), PAGE_SIZES, 25)
  const openKey = get("openTransactionDialog").trim()
  const dialogKey = openKey && openKey !== "false" ? openKey : ""
  const dPage = positiveInt(get("dPage"), 1)
  const dPageSize = sizeOf(get("dPageSize"), DETAIL_PAGE_SIZES, DEFAULT_DETAIL_PAGE_SIZE)

  // --- data -----------------------------------------------------------------------
  const filters: CashQuery = { from, to, branch: branches, organization: divisions, expenseCategory: categoryIds }
  const listQuery: CashQuery = { ...filters, search, page, pageSize }
  const list = useCashJson<ExpenseReportList>(`${config.endpoint}/list?${buildCashQuery(listQuery)}`)
  const detailUrl = dialogKey
    ? `${config.endpoint}/detail?${buildCashQuery({ ...filters, [config.detailParam]: dialogKey, page: dPage, pageSize: dPageSize })}`
    : null
  const data = list.data
  const rows = data?.results ?? []
  const base = data?.baseCurrency ?? ""

  // Filter lookups load the first time the filter dialog opens.
  const [lookupsWanted, setLookupsWanted] = useState(false)
  const branchOptions = useLookup<Named>(lookupsWanted ? "/api/branches" : null)
  const organizationOptions = useLookup<Named>(lookupsWanted ? "/api/organizations" : null)
  const categoryResponse = useCashJson<{ categories: CategoryOption[] }>(lookupsWanted && config.categoryFilter ? "/api/cash/categories?kind=expense" : null)
  const categories = categoryResponse.data?.categories ?? []
  const categoryOptions = categories
    .map((category) => {
      const parent = category.parentId ? categories.find((item) => item.id === category.parentId) : undefined
      return { value: String(category.id), label: parent ? `${parent.name} / ${category.name}` : category.name }
    })
    .sort((a, b) => a.label.localeCompare(b.label, "ru"))

  // --- local UI state -------------------------------------------------------------
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<{ branches: string[]; divisions: string[]; categories: string[] }>({ branches: [], divisions: [], categories: [] })
  const [searchDraft, setSearchDraft] = useState(search)
  const [lastSearch, setLastSearch] = useState(search)
  if (search !== lastSearch) {
    // Back/forward navigation changed ?search.
    setLastSearch(search)
    setSearchDraft(search)
  }
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState("")

  // Demo counter: filter keys set in the URL except fromDate and search.
  const filterCount = countActiveFilters({ toDate: urlTo, branch: branches, division: divisions, expenseCategory: categoryIds })
  const scope = [...divisions, ...branches]

  // --- actions --------------------------------------------------------------------
  const openFilter = () => {
    setDraft({ branches, divisions, categories: categoryIds.map(String) })
    setLookupsWanted(true)
    setFilterOpen(true)
  }
  // Demo "Применить": the query is replaced by the filter values (page 1, search dropped).
  const applyFilter = (period: { from: string; to: string }) =>
    update({
      fromDate: period.from,
      toDate: period.to,
      branch: draft.branches,
      division: draft.divisions,
      expenseCategory: config.categoryFilter ? draft.categories : null,
      search: null,
      page: null,
      openTransactionDialog: null,
      dPage: null,
      dPageSize: null,
    })
  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    update({ search: searchDraft.trim(), page: null })
  }
  const openRow = (row: ExpenseReportItem) => update({ openTransactionDialog: row.key, dPage: null, dPageSize: null })
  const closeDialog = useCallback(() => update({ openTransactionDialog: null, dPage: null, dPageSize: null }), [update])

  const excelTable = (items: ExpenseReportItem[], currency: string) => [
    [t(config.nameLabel), `${t("Процентное соотношение")} %`, t("Сумма"), t("Валюта")],
    ...items.map((row) => [row.name || t(config.emptyName), row.percent, roundMoney(row.amount), currencyLabel(currency)]),
  ]
  const fileName = `${t(config.excelTitle)} ${formatDotDate(from)} - ${formatDotDate(to)}`
  const downloadPage = () => {
    if (data) downloadExcelTable(fileName, excelTable(data.results, data.baseCurrency))
  }
  const downloadAll = async () => {
    setDownloading(true)
    setDownloadError("")
    try {
      const response = await fetch(`${config.endpoint}/list?${buildCashQuery({ ...listQuery, page: undefined, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (ExpenseReportList & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(fileName, excelTable(body.results, body.baseCurrency))
    } catch (reason) {
      setDownloadError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  const dialogRow = rows.find((row) => row.key === dialogKey)

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] items-center px-[28px]">
        <div className="flex min-w-0 flex-wrap items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t(config.title)}</span>
        </div>
      </header>
      <div className="h-[36px] border-b border-[#e1e5eb]" />

      <section className="flex flex-wrap items-center gap-4 px-[30px] pb-[10px] pt-[20px]">
        <BalanceFilterButton count={filterCount} from={from} to={to} scope={scope} onOpen={openFilter} hidePeriod />
        <div className="ml-auto">
          <BalanceDownloadMenu
            disabled={downloading || !data}
            items={[
              { label: "Список", onClick: downloadPage },
              { label: "Скачать все", onClick: () => void downloadAll() },
            ]}
          />
        </div>
      </section>
      {downloadError && (
        <p className="px-[30px] pb-2 text-sm text-[#e57373]">
          {t("Не удалось выполнить запрос")}: {t(downloadError)}
        </p>
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e1e5eb] px-[30px] py-3">
        <form onSubmit={submitSearch} className="relative w-full max-w-[350px] border-b border-[#dbe0e8] pb-1.5 focus-within:border-[#4f70e7]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="w-full bg-transparent pr-8 text-[13px] font-bold outline-none placeholder:font-bold placeholder:text-[#17233b]"
          />
          <button type="submit" aria-label={t("Поиск")} className="absolute right-0 top-0 text-[#9aa3b6] hover:text-[#4f70e7]">
            <Search className="h-5 w-5" />
          </button>
        </form>
        <BalancePagination page={page} pageSize={pageSize} count={data?.count ?? 0} sizes={PAGE_SIZES} onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize })} />
      </section>

      {data && data.missingRates.length > 0 && (
        <p className="flex items-center gap-2 border-t border-[#e1e5eb] px-4 py-2 text-[13px] text-[#b7791f] sm:px-6 md:px-9">
          <TriangleAlert className="h-4 w-4 shrink-0" />
          {t("Курс валюты не задан")}: {data.missingRates.map(currencyLabel).join(", ")}
        </p>
      )}

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
      {data && !list.error && !rows.length && (
        <div className="flex flex-col items-center justify-center border-t border-[#e1e5eb] py-24">
          {list.loading ? (
            <Loader2 className="h-8 w-8 animate-spin text-[#586174]" />
          ) : (
            <>
              <Image src="/robot-empty.png" alt="" width={120} height={120} priority className="h-28 w-28 object-contain" />
              <p className="mt-4 text-center text-[#9aa3b6]">{t("По вашему запросу ничего не найдено")}</p>
            </>
          )}
        </div>
      )}
      {data && !list.error && rows.length > 0 && (
        <section className={`border-t border-[#e1e5eb] pb-10 transition-opacity ${list.loading ? "opacity-60" : ""}`}>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b border-[#efefef] px-4 py-3 text-[14px] font-semibold text-[#666] sm:px-6 md:grid-cols-12 md:px-9">
            <span className="md:col-span-3">{t(config.nameLabel)}</span>
            <span className="hidden md:col-span-6 md:block">{t("Процентное соотношение")}</span>
            <span className="text-right md:col-span-3">
              {t("Сумма")} ({currencyLabel(base)})
            </span>
          </div>
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => openRow(row)}
              className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-dotted border-[#dbe0e8] px-4 py-3 text-left text-[14px] hover:bg-[#f2f5f8] sm:px-6 md:min-h-[50px] md:grid-cols-12 md:px-9 md:py-2"
            >
              <span className="min-w-0 break-words md:col-span-3">{row.name || t(config.emptyName)}</span>
              <span className="col-span-2 row-start-2 md:col-span-6 md:row-start-auto">
                <ShareBar percent={row.percent} />
              </span>
              <span className="whitespace-nowrap text-right md:col-span-3">
                {formatMoney(row.amount)} {currencyLabel(base)}
              </span>
            </button>
          ))}
        </section>
      )}

      <BalanceFilterDialog open={filterOpen} onClose={() => setFilterOpen(false)} from={from} to={to} onApply={applyFilter}>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-black">{t("Филиалы")}</span>
          <MultiSelect
            value={draft.branches}
            options={withSelected(
              branchOptions.map((item) => item.name),
              draft.branches,
            )}
            onChange={(next) => setDraft((value) => ({ ...value, branches: next }))}
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[13px] font-semibold text-black">{t("Организация")}</span>
          <MultiSelect
            value={draft.divisions}
            options={withSelected(
              organizationOptions.map((item) => item.name),
              draft.divisions,
            )}
            onChange={(next) => setDraft((value) => ({ ...value, divisions: next }))}
          />
        </div>
        {config.categoryFilter && (
          <div className="flex flex-col gap-1 md:col-span-2">
            <span className="text-[13px] font-semibold text-black">{t("Категория расходов")}</span>
            <MultiSelect value={draft.categories} options={categoryOptions} onChange={(next) => setDraft((value) => ({ ...value, categories: next }))} />
          </div>
        )}
      </BalanceFilterDialog>

      <ExpenseDrilldownDialog
        url={detailUrl}
        requestKey={dialogKey}
        fallbackName={dialogRow ? dialogRow.name || t(config.emptyName) : ""}
        emptyName={t(config.emptyName)}
        page={dPage}
        pageSize={dPageSize}
        onPageChange={(next) => update({ dPage: next.page > 1 ? next.page : null, dPageSize: next.pageSize === DEFAULT_DETAIL_PAGE_SIZE ? null : next.pageSize })}
        onClose={closeDialog}
        rowLinks={config.rowLinks}
      />
    </main>
  )
}

/** Demo LinearProgress: 10px #efefef track, #58bed9 fill at the share (0–100). */
function ShareBar({ percent }: { percent: number }) {
  const value = Math.min(100, Math.max(0, percent))
  const label = `${formatMoney(percent, 1)} %`
  return (
    <span role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label} title={label} className="block h-2.5 w-full overflow-hidden bg-[#efefef]">
      <span className="block h-full bg-[#58bed9]" style={{ width: `${value}%` }} />
    </span>
  )
}
