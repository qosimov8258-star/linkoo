"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Loader2, Search } from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { useFinanceCurrencies } from "@/components/analytics/balance/use-balance"
import { useCashJson, useMoneyRequests } from "@/components/analytics/cash/use-cash"
import { ExpectedExpenseDetail, MONEY_REQUEST_STATUS_COLORS } from "@/components/analytics/expected-expenses-detail"
import { Snackbar, type SnackbarMessage } from "@/components/analytics/supplier-balance-dialogs"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate } from "@/lib/finance/dates"
import { MONEY_REQUEST_STATUSES, MONEY_REQUEST_STATUS_LABELS, type MoneyRequest, type MoneyRequestStatus } from "@/lib/cash/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Ожидаемые расходы" (demo #/provider-request, chunk 24): money requests
// ("Запрос средств" created on Баланс поставщиков) by status tab, with the
// supplier debt / reserve, an inline detail with the «ЗАПРОС» approve / edit /
// cancel form (PATCH /api/cash/money-requests/[id]); payment happens on the cash
// page ("Запрос средств" → "Оплатить"). Tabs: В ожидании, Подтвержденные,
// Оплаченные, Все (= no status param, the default). The URL mirrors the demo
// query (status, search, page, pageSize, ordering) plus open=<id> for the
// expanded row (demo route #/provider-request/:id).

const DEFAULT_PAGE_SIZE = 25
const DIGITS = 3

const TABS: Array<{ value: MoneyRequestStatus | ""; label: string }> = [
  { value: "pending", label: "В ожидании" },
  { value: "approved", label: "Подтвержденные" },
  { value: "given", label: "Оплаченные" },
  { value: "", label: "Все" },
]

/** Demo header array: sort key (null = not sortable), header, width %. */
const COLUMNS: Array<{ id: string; sortKey: string | null; label: string; width: number; align?: "center" }> = [
  { id: "id", sortKey: "id", label: "№", width: 7 },
  { id: "provider", sortKey: null, label: "Поставщик", width: 20 },
  { id: "date", sortKey: null, label: "Дата создания", width: 14 },
  { id: "debt", sortKey: "debt", label: "Задолженность", width: 10 },
  { id: "reserve", sortKey: null, label: "Запас", width: 12 },
  { id: "amount", sortKey: "amount", label: "Сумма оплаты", width: 10 },
  { id: "status", sortKey: null, label: "Статус", width: 12, align: "center" },
]
const TOTAL_WIDTH = COLUMNS.reduce((sum, column) => sum + column.width, 0)

type UrlState = { status: MoneyRequestStatus | ""; search: string; page: number; pageSize: number; ordering: string[]; open: number | null }

function readUrlState(params: Pick<URLSearchParams, "get">): UrlState {
  const status = params.get("status") ?? ""
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  const open = Number(params.get("open"))
  return {
    status: (MONEY_REQUEST_STATUSES as readonly string[]).includes(status) ? (status as MoneyRequestStatus) : "",
    search: params.get("search")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter((value) => COLUMNS.some((column) => column.sortKey && value.replace(/^-/, "") === column.sortKey)).slice(0, 1),
    open: Number.isInteger(open) && open > 0 ? open : null,
  }
}

export function ExpectedExpensesView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [initial] = useState(() => readUrlState(searchParams))

  const [status, setStatus] = useState<MoneyRequestStatus | "">(initial.status)
  const [searchInput, setSearchInput] = useState(initial.search)
  const [search, setSearch] = useState(initial.search)
  const [paging, setPaging] = useState({ page: initial.page, pageSize: initial.pageSize })
  const [ordering, setOrdering] = useState<string[]>(initial.ordering)
  const [openId, setOpenId] = useState<number | null>(initial.open)
  const [canManage, setCanManage] = useState(false)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const closeMessage = useCallback(() => setMessage(null), [])

  const query = useMemo(
    () => ({ status, search, ordering: ordering[0] ?? "", page: paging.page, pageSize: paging.pageSize }),
    [status, search, ordering, paging],
  )
  const { data, loading, error, reload } = useMoneyRequests(query)
  const detail = useCashJson<MoneyRequest>(openId ? `/api/cash/money-requests/${openId}` : null)
  const { data: currencyData } = useFinanceCurrencies()
  const currencies = currencyData?.currencies.map((currency) => currency.code) ?? []
  const rows = data?.rows ?? []

  // Approve / edit / cancel need the manager role (demo can_approve_money_request / can_delete_money_request).
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string }>) : null))
      .then((user) => setCanManage(user?.role === "manager" || user?.role === "admin"))
      .catch(() => setCanManage(false))
  }, [])

  // A page past the end (status changed, rows moved to another tab) falls back to the last page.
  const lastPage = data ? Math.max(1, Math.ceil(data.count / Math.max(1, data.pageSize || 1))) : 1
  if (data && !loading && data.page === paging.page && data.pageSize === paging.pageSize && paging.page > lastPage) {
    setPaging({ page: lastPage, pageSize: paging.pageSize })
  }

  // "Поиск" is applied 500 ms after the last keystroke.
  useEffect(() => {
    const value = searchInput.trim()
    if (value === search) return
    const timer = window.setTimeout(() => {
      setSearch(value)
      setPaging((current) => ({ ...current, page: 1 }))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])

  // Mirror the state into the URL like the demo.
  useEffect(() => {
    const params = new URLSearchParams()
    params.set("pageSize", String(paging.pageSize))
    if (status) params.set("status", status)
    if (search) params.set("search", search)
    if (paging.page > 1) params.set("page", String(paging.page))
    if (ordering.length) params.set("ordering", ordering.join(","))
    if (openId) params.set("open", String(openId))
    const next = params.toString()
    if (next !== window.location.search.replace(/^\?/, "")) window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`)
  }, [status, search, paging, ordering, openId])

  const changeTab = (value: MoneyRequestStatus | "") => {
    if (value === status) return
    // Demo: getParams({status}) keeps the other params (the page too; clamped above).
    setStatus(value)
    setOpenId(null)
  }

  const toggleRow = (id: number) => setOpenId((current) => (current === id ? null : id))

  const onSaved = (next: "approved" | "cancelled") => {
    setMessage({ text: next === "approved" ? "Успешно подтверждено !" : "Успешно отменено !", tone: "success" })
    reload()
    detail.reload()
  }

  const statusLabel = (value: MoneyRequestStatus) => (
    <span className="font-medium" style={{ color: MONEY_REQUEST_STATUS_COLORS[value] }}>
      {t(MONEY_REQUEST_STATUS_LABELS[value])}
    </span>
  )

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-4 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-2 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Ожидаемые расходы")}</span>
        </div>
      </header>

      <nav className="flex overflow-x-auto border-b border-[#e1e5eb] bg-white text-center" role="tablist">
        {TABS.map((tab) => {
          const active = tab.value === status
          return (
            <button
              key={tab.value || "all"}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => changeTab(tab.value)}
              className={`min-w-fit flex-1 whitespace-nowrap border-b-2 px-3 py-3 text-[13px] font-medium uppercase md:py-4 md:text-[14px] ${active ? "text-[#17233b]" : "border-transparent text-[#586174] hover:text-[#17233b]"}`}
              style={active ? { borderColor: "rgb(79, 113, 220)" } : undefined}
            >
              {t(tab.label)}
            </button>
          )
        })}
      </nav>

      {error && (
        <div className="mx-4 mt-4 flex flex-wrap items-center gap-3 rounded-md bg-[#fdecec] px-4 py-3 text-sm text-[#c94848] md:mx-9">
          <span>
            {t("Не удалось загрузить данные")}: {t(error)}
          </span>
          <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <section className="flex flex-wrap items-center gap-3 border-b border-[#e1e5eb] bg-white px-4 py-3 md:gap-5 md:px-9">
        <label className="relative min-w-[180px] flex-1 border-b border-[#dbe0e8] pb-1.5">
          <input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder={t("Поиск")}
            className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
          />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>
        <BalancePagination page={paging.page} pageSize={paging.pageSize} count={data?.count ?? 0} onChange={setPaging} />
      </section>

      <section className="overflow-x-auto bg-[#f6f9fc] pb-10">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-[14px]">
          <colgroup>
            {COLUMNS.map((column) => (
              <col key={column.id} style={{ width: `${(column.width / TOTAL_WIDTH) * 100}%` }} />
            ))}
          </colgroup>
          <thead className="bg-[#626b7e] text-white">
            <tr>
              {COLUMNS.map((column) => {
                const key = column.sortKey
                const sorted = key && ordering.includes(key) ? "asc" : key && ordering.includes(`-${key}`) ? "desc" : null
                return (
                  <th
                    key={column.id}
                    className={`px-4 py-4 font-semibold ${column.align === "center" ? "text-center" : "text-left"}`}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                  >
                    {key ? (
                      <button
                        type="button"
                        onClick={() => {
                          setOrdering(nextOrdering(ordering, key))
                          setPaging((current) => ({ ...current, page: 1 }))
                        }}
                        className="inline-flex items-center gap-1.5 text-left hover:text-[#dfe4ff]"
                      >
                        {t(column.label)}
                        {sorted === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : sorted === "desc" ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />}
                      </button>
                    ) : (
                      t(column.label)
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length ? (
              <tr>
                <td colSpan={COLUMNS.length} className="bg-white px-4 py-16 text-center text-[#9aa3b6]">
                  <div className="sticky left-0 w-[min(100vw,100%)]">
                    <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                    {t("Загрузка...")}
                  </div>
                </td>
              </tr>
            ) : !rows.length ? (
              <tr>
                <td colSpan={COLUMNS.length} className="bg-white px-4 py-16 text-center text-[#9aa3b6]">
                  <div className="sticky left-0 w-[min(100vw,100%)]">{error ? t("Не удалось загрузить данные") : t("По вашему запросу ничего не найдено")}</div>
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <Fragment key={row.id}>
                  {openId === row.id ? (
                    <tr>
                      <td colSpan={COLUMNS.length} className="p-0 md:px-3 md:py-3">
                        {/* Sticky + viewport-wide on phones: the table scrolls sideways, the detail stays readable. */}
                        <div className="sticky left-0 max-w-[100vw] overflow-hidden shadow-[0_1px_6px_rgba(0,0,0,0.12),0_1px_4px_rgba(0,0,0,0.12)] md:max-w-none md:rounded">
                          <ExpectedExpenseDetail
                            request={detail.data && detail.data.id === row.id ? detail.data : null}
                            loading={detail.loading}
                            error={detail.error}
                            canManage={canManage}
                            currencies={currencies}
                            onClose={() => setOpenId(null)}
                            onSaved={onSaved}
                            onError={(text) => setMessage({ text, tone: "error" })}
                          />
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr
                      onClick={() => toggleRow(row.id)}
                      className={`cursor-pointer border-b border-dashed border-slate-200 transition-colors hover:bg-[#eef2ff] ${index % 2 ? "bg-[#f6f9fc]" : "bg-white"} ${loading ? "opacity-60" : ""}`}
                    >
                      <td className="px-4 py-4">{row.id}</td>
                      <td className="truncate px-4 py-4 font-medium">{row.supplier.name || t("Не указано")}</td>
                      <td className="whitespace-nowrap px-4 py-4">{row.createdAt ? formatStatementDate(row.createdAt, language, false) : ""}</td>
                      <td className="whitespace-nowrap px-4 py-4">{formatMoney(row.balances.balance, DIGITS)}</td>
                      <td className="whitespace-nowrap px-4 py-4">{formatMoney(row.balances.reserve, DIGITS)}</td>
                      <td className="whitespace-nowrap px-4 py-4">
                        {formatMoney(row.amount, DIGITS)} {currencyLabel(row.currency)}
                      </td>
                      <td className="px-4 py-4 text-center">{statusLabel(row.status)}</td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </section>

      <Snackbar message={message} onClose={closeMessage} />
    </main>
  )
}
