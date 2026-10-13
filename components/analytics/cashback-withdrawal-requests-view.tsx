"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, CheckCircle2, MinusCircle, Search } from "lucide-react"

import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import {
  CASHBACK_REQUESTS_API,
  CashbackRequestDecisionDialog,
  CashbackRequestsFilterPopup,
  fetchJson,
  requestAmount,
  type CashbackRequestFilters,
} from "@/components/analytics/cashback-requests-dialogs"
import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { cashbackRequestStatusLabel, type CashbackRequestListResult, type CashbackRequestRow } from "@/lib/cashback-requests-types"
import { currencyLabel } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// "Запросы на снятие кэшбэка" (demo #/cashback-requests, GET telegram/cashback_request/):
// clients' cashback payout requests from the Telegram bot. № | Клиент | Сумма |
// Валюта | Статус; a pending request gets "Подтвердить" (choose a cashbox → the
// cashback is paid out through the cash core: op 22 + loyalty withdraw) and
// "Отклонить". Filter = Валюта + Статус, search, № sort, pagination; the state
// lives in the URL like the demo (?status=&currency=&id=&confirmModalOpen=true …).

type ViewState = {
  search: string
  status: string
  currency: string
  ordering: string
  page: number
  pageSize: number
  /** Request whose dialog is open (demo /cashback-requests/:id). */
  dialogId: number | null
  dialog: "confirm" | "reject" | null
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  const dialogId = positiveInt(params.get("id"), 0) || null
  const dialog = params.get("confirmModalOpen") === "true" ? "confirm" : params.get("rejectModalOpen") === "true" ? "reject" : null
  const ordering = params.get("ordering") ?? ""
  return {
    search: params.get("search") ?? "",
    status: params.get("status") ?? "",
    currency: params.get("currency") ?? "",
    ordering: ordering === "id" || ordering === "-id" ? ordering : "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
    dialogId: dialog ? dialogId : null,
    dialog: dialogId ? dialog : null,
  }
}

function stateToSearch(state: ViewState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.status) params.set("status", state.status)
  if (state.currency) params.set("currency", state.currency)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.dialogId && state.dialog) {
    params.set("id", String(state.dialogId))
    params.set(state.dialog === "confirm" ? "confirmModalOpen" : "rejectModalOpen", "true")
  }
  return params.toString()
}

function listQuery(state: ViewState): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.status) params.set("status", state.status)
  if (state.currency) params.set("currency", state.currency)
  if (state.ordering) params.set("ordering", state.ordering)
  return params.toString()
}

function useRequestList(url: string) {
  const [data, setData] = useState<CashbackRequestListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetchJson<CashbackRequestListResult>(url, { signal: controller.signal })
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload }
}

export function CashbackWithdrawalRequestsView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [canEdit, setCanEdit] = useState(false)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)

  const query = useMemo(() => listQuery(state), [state])
  const { data, loading, error, reload } = useRequestList(`${CASHBACK_REQUESTS_API}?${query}`)

  // The demo keeps the list state (and the open dialog) in the URL.
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    // Подтвердить / Отклонить: the PUT route requires manager (or admin).
    fetchJson<{ role?: string }>("/api/auth/me")
      .then((me) => setCanEdit(me.role === "manager" || me.role === "admin"))
      .catch(() => setCanEdit(false))
  }, [])

  // A page past the end (stale URL, rows gone) jumps to the last page.
  useEffect(() => {
    if (!data || loading || data.rows.length || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > lastPage) setState((current) => ({ ...current, page: lastPage }))
  }, [data, loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const closeSnackbar = useCallback(() => setMessage(null), [])
  const closeDialog = useCallback(() => setState((current) => ({ ...current, dialogId: null, dialog: null })), [])

  const rows = data?.rows ?? []
  const filterCount = (state.status ? 1 : 0) + (state.currency ? 1 : 0)
  const filters: CashbackRequestFilters = { status: state.status, currency: state.currency }

  const statusCell = (row: CashbackRequestRow) => (
    <>
      <div>{t(cashbackRequestStatusLabel(row.status))}</div>
      {row.payout && (
        <Link
          href={`/analytics/cash-management?search=${row.payout.docNo ?? ""}`}
          className="mt-0.5 block text-[12px] text-[#999] hover:text-[rgb(79,113,220)] hover:underline"
          title={t("Выдача денег для кэшбека")}
        >
          {row.payout.cashbox}
          {row.payout.docNo ? ` · № ${row.payout.docNo}` : ""}
        </Link>
      )}
      {row.cancelledPayoutDocNo !== null && (
        <div className="mt-0.5 text-[12px] text-[#c27c0e]">
          {t("Выплата удалена")}
          {row.cancelledPayoutDocNo ? ` (№ ${row.cancelledPayoutDocNo})` : ""}
        </div>
      )}
    </>
  )

  const iconButton = (title: string, onClick: () => void, icon: ReactNode) => (
    <button
      type="button"
      title={t(title)}
      aria-label={t(title)}
      onClick={onClick}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full hover:bg-black/5"
    >
      {icon}
    </button>
  )

  const th = "px-4 py-[18px] text-left font-semibold"
  const td = "px-4 py-3 align-middle"
  return (
    <main className="min-h-screen bg-[#f1f4f8] text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Запросы на снятие кэшбэка")}</span>
        </div>
      </header>

      <section className="mx-4 mb-10 mt-4 rounded-sm bg-white shadow-sm md:mx-6">
        <div className="relative flex min-h-[55px] flex-wrap items-center gap-x-5 gap-y-3 border-b border-[#efefef] px-4 py-2 md:px-6">
          <div className="relative">
            <BalanceFilterChip
              count={filterCount}
              onOpen={() => setFilterOpen(true)}
              onClear={() => update({ status: "", currency: "", page: 1 })}
            />
            <CashbackRequestsFilterPopup
              open={filterOpen}
              filters={filters}
              currencies={data?.currencies ?? []}
              onClose={() => setFilterOpen(false)}
              onApply={(next) => update({ ...next, page: 1 })}
            />
          </div>
          <form
            className="flex min-w-[160px] flex-1 items-center gap-1 md:max-w-[340px]"
            onSubmit={(event) => {
              event.preventDefault()
              update({ search: searchDraft.trim(), page: 1 })
            }}
          >
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              aria-label={t("Поиск")}
              className="h-10 w-full border-b border-[#dbe0e8] bg-transparent px-1 text-[15px] outline-none placeholder:text-[#9aa3b6] focus:border-[#4f70e7]"
            />
            <button type="submit" aria-label={t("Поиск")} className="p-1.5 text-[#9aa3b6]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
          </div>
        </div>

        {error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(error)}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto pb-2 ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[720px] table-fixed border-collapse text-[14px] text-[#333]">
            <thead>
              <tr className="border-b border-[#efefef]">
                <th className={`${th} w-[8.33%] pl-6`}>
                  <button
                    type="button"
                    onClick={() => update({ ordering: state.ordering === "-id" || !state.ordering ? "id" : "-id", page: 1 })}
                    className="inline-flex items-center gap-1 font-semibold"
                  >
                    {t("№")}
                    {state.ordering === "id" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className={`h-3.5 w-3.5 ${state.ordering ? "" : "opacity-40"}`} />}
                  </button>
                </th>
                <th className={`${th} w-[25%]`}>{t("Клиент")}</th>
                <th className={`${th} w-[25%]`}>{t("Сумма")}</th>
                <th className={`${th} w-[16.67%]`}>{t("Валюта")}</th>
                <th className={`${th} w-[16.67%]`}>{t("Статус")}</th>
                <th className={`${th} w-[8.33%]`} aria-label={t("Действия")} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-dashed border-[#e1e5eb] last:border-b-0">
                  <td className={`${td} pl-6`}>{row.id}</td>
                  <td className={`${td} truncate`} title={row.comment || undefined}>
                    {row.client.exists ? row.client.name : <span className="italic text-[#999]">{row.client.name || t("Не указано")}</span>}
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{requestAmount(row.amount)}</td>
                  <td className={td}>{currencyLabel(row.currency)}</td>
                  <td className={td}>{statusCell(row)}</td>
                  <td className={td}>
                    {row.status === "pending" && canEdit && (
                      <div className="flex items-center justify-around">
                        {iconButton("Подтвердить", () => update({ dialogId: row.id, dialog: "confirm" }), <CheckCircle2 className="h-[22px] w-[22px] fill-[#6FC988] text-white" />)}
                        {iconButton("Отклонить", () => update({ dialogId: row.id, dialog: "reject" }), <MinusCircle className="h-[22px] w-[22px] fill-[#ff584b] text-white" />)}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="px-4 py-16 text-center text-[13px] text-[#666]">
                    {loading ? t("Загрузка...") : error ? "" : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {state.dialogId && state.dialog && (
        <CashbackRequestDecisionDialog
          key={`${state.dialog}-${state.dialogId}`}
          requestId={state.dialogId}
          mode={state.dialog}
          onClose={closeDialog}
          onDone={() => {
            closeDialog()
            reload()
            setMessage({ text: "Успешно", tone: "success" })
          }}
        />
      )}

      <CashSnackbar message={message} onClose={closeSnackbar} />
    </main>
  )
}
