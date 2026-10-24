"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, MinusCircle } from "lucide-react"

import {
  CASHBACK_REQUESTS_API,
  CashbackRequestDecisionDialog,
  CashbackRequestsFilterPopup,
  fetchJson,
  requestAmount,
  type CashbackRequestFilters,
} from "@/components/analytics/cashback-requests-dialogs"
import { CashSnackbar, type SnackbarMessage } from "@/components/analytics/cash-management-shared"
import { ListBTable } from "@/components/analytics/list-b-table"
import { RefCard, RefHeader, RefPage, RefToolbar } from "@/components/ref/list-kit"
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

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

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

  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / Math.max(1, state.pageSize)))
  const from = data && data.count > 0 ? (state.page - 1) * state.pageSize + 1 : 0
  const to = data ? Math.min(data.count, state.page * state.pageSize) : 0
  const idHead = (
    <button type="button" onClick={() => update({ ordering: state.ordering === "-id" || !state.ordering ? "id" : "-id", page: 1 })} className="text-left font-semibold hover:opacity-80">
      {t("№")}
      {state.ordering === "id" ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === "-id" ? <span className="ml-1 text-[10px]">▼</span> : null}
    </button>
  )
  const withActions = canEdit && rows.some((row) => row.status === "pending")
  return (
    <RefPage>
      <RefHeader title={t("Запросы на снятие кэшбэка")} />

      <RefCard className="bg-white">
        <RefToolbar
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((open) => !open)}
          leftSlot={
            filterCount === 0 ? (
              <button type="button" onClick={() => setFilterOpen((open) => !open)} className="text-[13px] text-[#4f71dc]">
                {filterOpen ? t("Скрыть фильтр") : t("Показать фильтр")} ⌄
              </button>
            ) : (
              <span className="ml-[5px] inline-flex h-[30px] items-center gap-2 rounded-md bg-[#efefef] px-4 text-[#666]">
                {t("Фильтр")}: {filterCount} {t("элемента")}
                <button type="button" onClick={() => setFilterOpen(true)} aria-label={t("Изменить")} className="border-l border-white pl-2 text-[#8f8f8f]">✎</button>
                <button type="button" onClick={() => update({ status: "", currency: "", page: 1 })} aria-label={t("Очистить")} className="border-l border-white pl-2 text-[#8f8f8f]">×</button>
              </span>
            )
          }
          filterPanel={
            <CashbackRequestsFilterPopup
              open={filterOpen}
              filters={filters}
              currencies={data?.currencies ?? []}
              onClose={() => setFilterOpen(false)}
              onApply={(next) => update({ ...next, page: 1 })}
            />
          }
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(pageSize) => update({ pageSize, page: 1 })}
          from={from}
          to={to}
          total={data?.count ?? 0}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page })}
        />

        {error && (
          <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(error)}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f71dc] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={loading ? "opacity-60" : undefined}>
          <ListBTable
            cols={withActions ? "123px 346px 346px 231px 1fr 110px" : "123px 346px 346px 231px 1fr"}
            minWidth={900}
            inset={30}
            cellPad={0}
            heads={withActions ? [idHead, t("Клиент"), t("Сумма"), t("Валюта"), t("Статус"), ""] : [idHead, t("Клиент"), t("Сумма"), t("Валюта"), t("Статус")]}
            rows={rows}
            rowKey={(row) => row.id}
            empty={loading ? t("Загрузка...") : error ? "" : t("По вашему запросу ничего не найдено")}
            render={(row) => {
              const base = [
                <span key="id" className="block pl-2">{row.id}</span>,
                <span key="client" className="block truncate" title={row.comment || undefined}>
                  {row.client.exists ? row.client.name : <span className="italic text-[#999]">{row.client.name || t("Не указано")}</span>}
                </span>,
                <span key="amount" className="whitespace-nowrap">{requestAmount(row.amount)}</span>,
                currencyLabel(row.currency),
                statusCell(row),
              ]
              if (!withActions) return base
              return [
                ...base,
                row.status === "pending" && canEdit ? (
                  <div key="actions" className="flex items-center justify-end gap-3">
                    {iconButton("Подтвердить", () => update({ dialogId: row.id, dialog: "confirm" }), <CheckCircle2 className="h-[22px] w-[22px] fill-[#6FC988] text-white" />)}
                    {iconButton("Отклонить", () => update({ dialogId: row.id, dialog: "reject" }), <MinusCircle className="h-[22px] w-[22px] fill-[#ff584b] text-white" />)}
                  </div>
                ) : null,
              ]
            }}
          />
        </div>
      </RefCard>

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
    </RefPage>
  )
}
