"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { MinusCircle, PlusCircle, Search } from "lucide-react"

import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import {
  fetchJson,
  LOYALTY_API,
  LoyaltyFilterDialog,
  LoyaltyInfoDialog,
  LoyaltyTransactionDialog,
  useClientName,
} from "@/components/analytics/loyalty-card-dialogs"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"
import type { LoyaltyCardListResult, LoyaltyCardOptions, LoyaltyCardRow } from "@/lib/loyalty-card-types"

// "Накопительная карта" (demo #/cumulative, GET sales/cash_back/): every
// client's cashback balance per currency from loyalty_card_transactions
// (manual "Добавить" / "Списать" here, payouts "Выдача денег для Кэшбек" from
// the cash page). Row click → movement history; hover buttons → manual
// приход / расход. Filter = client type, search, pagination, expanded view;
// the state lives in the URL (?search=, ?clientType=, ?client= …) like the demo.

type ViewState = {
  search: string
  clientType: string
  ordering: string
  page: number
  pageSize: number
  /** Client whose history dialog is open (demo /cumulative/:id?openInfoDialog=true). */
  client: number | null
  /** History page (demo dPage). */
  dPage: number
}

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function stateFromParams(params: URLSearchParams): ViewState {
  const client = positiveInt(params.get("client"), 0)
  return {
    search: params.get("search") ?? "",
    clientType: params.get("clientType") ?? params.get("marketType") ?? "",
    ordering: params.get("ordering") ?? "",
    page: positiveInt(params.get("page"), 1),
    pageSize: Math.min(2000, positiveInt(params.get("pageSize"), 25)),
    client: client || null,
    dPage: positiveInt(params.get("dPage"), 1),
  }
}

function stateToSearch(state: ViewState): string {
  const params = new URLSearchParams()
  params.set("pageSize", String(state.pageSize))
  if (state.page > 1) params.set("page", String(state.page))
  if (state.search) params.set("search", state.search)
  if (state.clientType) params.set("clientType", state.clientType)
  if (state.ordering) params.set("ordering", state.ordering)
  if (state.client) {
    params.set("client", String(state.client))
    if (state.dPage > 1) params.set("dPage", String(state.dPage))
  }
  return params.toString()
}

function listQuery(state: ViewState): string {
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) })
  if (state.search) params.set("search", state.search)
  if (state.clientType) params.set("clientType", state.clientType)
  if (state.ordering) params.set("ordering", state.ordering)
  return params.toString()
}

/** Demo grid colours: > 0 #92ce95, < 0 #e27676 (600); 0 plain. */
function balanceStyle(value: number) {
  if (value > 0) return { color: "#92ce95", fontWeight: 600 }
  if (value < 0) return { color: "#e27676", fontWeight: 600 }
  return undefined
}

function useLoyaltyList(url: string) {
  const [data, setData] = useState<LoyaltyCardListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetchJson<LoyaltyCardListResult>(url, { signal: controller.signal })
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

type RowDialog = { kind: "add" | "expense"; row: LoyaltyCardRow } | null

export function LoyaltyCardView() {
  const { t } = useLanguage()
  const clientName = useClientName()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ViewState>(() => stateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [dialog, setDialog] = useState<RowDialog>(null)
  const [options, setOptions] = useState<LoyaltyCardOptions | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const query = useMemo(() => listQuery(state), [state])
  const { data, loading, error, reload } = useLoyaltyList(`${LOYALTY_API}?${query}`)

  // The demo keeps the list state in the URL query.
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    fetchJson<LoyaltyCardOptions>(`${LOYALTY_API}/options`)
      .then(setOptions)
      .catch(() => setOptions(null))
    // Списать / Добавить: the POST route requires manager (or admin).
    fetchJson<{ role?: string }>("/api/auth/me")
      .then((me) => setCanEdit(me.role === "manager" || me.role === "admin"))
      .catch(() => setCanEdit(false))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [notice])

  // A page past the end (stale URL, rows gone) jumps to the last page.
  useEffect(() => {
    if (!data || loading || data.rows.length || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > lastPage) setState((current) => ({ ...current, page: lastPage }))
  }, [data, loading, state.page, state.pageSize])

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const openInfo = (row: LoyaltyCardRow) => update({ client: row.id, dPage: 1 })

  const rows = data?.rows ?? []
  const currencies = data?.currencies ?? options?.currencies ?? []
  const filterCount = state.clientType ? 1 : 0

  const actionButton = (title: string, icon: ReactNode, onClick: () => void) => (
    <button
      type="button"
      title={t(title)}
      aria-label={t(title)}
      onClick={(event) => {
        event.stopPropagation()
        onClick()
      }}
      className="flex h-[30px] w-[30px] items-center justify-center rounded-full hover:bg-white"
    >
      {icon}
    </button>
  )

  const head = "border border-[#efefef] px-5 py-2.5 text-left font-semibold"
  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Накопительная карта")}</span>
        </div>
      </header>

      <ExpandedOverlay expanded={expanded}>
        <section className="relative flex min-h-[55px] flex-wrap items-center gap-3 border-t border-[#efefef] px-6 py-2 md:px-9">
          <div className="relative">
            <BalanceFilterChip
              count={filterCount}
              onOpen={() => setFilterOpen(true)}
              onClear={() => {
                // Demo: clearing the filter resets the URL to {pageSize: 25}.
                setSearchDraft("")
                update({ clientType: "", search: "", ordering: "", page: 1, pageSize: 25 })
              }}
            />
            <LoyaltyFilterDialog
              open={filterOpen}
              clientType={state.clientType}
              options={options}
              onClose={() => setFilterOpen(false)}
              onApply={(clientType) => update({ clientType, page: 1 })}
            />
          </div>
          <form
            className="mx-auto flex min-w-[160px] flex-1 items-center justify-center gap-1"
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
              className="h-10 w-full max-w-[260px] border-b border-[#dbe0e8] bg-transparent px-1 text-[15px] outline-none focus:border-[#4f70e7]"
            />
            <button type="submit" aria-label={t("Поиск")} className="p-1.5 text-[#ccc]">
              <Search className="h-5 w-5" />
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-3">
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        {error && (
          <div className="flex items-center gap-3 px-6 py-3 text-[#e57373] md:px-9">
            <span>
              {t("Не удалось загрузить данные")}: {t(error)}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <div className={`overflow-x-auto pb-8 ${loading ? "opacity-60" : ""}`}>
          <table className="w-full min-w-[700px] border-collapse text-[14px] text-[#666]">
            <thead>
              <tr className="bg-white text-[#666]">
                <th className={`${head} sticky left-0 z-[2] w-[300px] min-w-[300px] bg-white shadow-[5px_0_8px_-3px_#ccc]`}>{t("Клиент")}</th>
                {currencies.map((currency) => (
                  <th key={currency.code} className={head}>
                    {currency.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const background = index % 2 ? "#ffffff" : "#F4F8FB"
                return (
                  <tr key={row.id} style={{ background }} className="group h-10 cursor-pointer hover:!bg-[#e9f8ff] hover:font-semibold">
                    <td
                      className="sticky left-0 z-[1] border-b border-r border-[#efefef] px-4 shadow-[5px_0_8px_-3px_#ccc]"
                      style={{ background: "inherit" }}
                      onClick={() => openInfo(row)}
                    >
                      <div className="relative flex min-h-[30px] w-[268px] items-center">
                        <span className={`truncate hover:text-[rgb(79,113,220)] ${row.exists ? "" : "italic text-[#999]"}`}>{clientName(row)}</span>
                        {canEdit && row.exists && (
                          <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 bg-gradient-to-r from-transparent to-[#F4F8FB] pl-6 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {actionButton("Списать", <MinusCircle className="h-[22px] w-[22px] text-[#ff584b]" />, () => setDialog({ kind: "expense", row }))}
                            {actionButton("Добавить", <PlusCircle className="h-[22px] w-[22px] text-[#8dc572]" />, () => setDialog({ kind: "add", row }))}
                          </div>
                        )}
                      </div>
                    </td>
                    {currencies.map((currency) => {
                      const value = row.balances[currency.code] ?? 0
                      return (
                        <td key={currency.code} className="whitespace-nowrap border-b border-r border-[#efefef] px-5" onClick={() => openInfo(row)}>
                          <span style={balanceStyle(value)}>{value ? formatMoney(value) : 0}</span>
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
              {!rows.length && (
                <tr>
                  <td colSpan={currencies.length + 1} className="border-b border-[#efefef] px-4 py-16 text-center text-[13px] text-[#666]">
                    {loading ? t("Загрузка...") : t("По вашему запросу ничего не найдено")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ExpandedOverlay>

      {state.client && (
        <LoyaltyInfoDialog
          key={state.client}
          clientId={state.client}
          page={state.dPage}
          onPage={(dPage) => update({ dPage })}
          onClose={() => update({ client: null, dPage: 1 })}
        />
      )}

      {dialog && (
        <LoyaltyTransactionDialog
          client={{ id: dialog.row.id, name: dialog.row.name }}
          kind={dialog.kind}
          balances={dialog.row.balances}
          options={options}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setNotice({ text: t("Успешно сохранено"), error: false })
            reload()
          }}
        />
      )}

      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[120] max-w-[90vw] -translate-x-1/2 rounded-md px-5 py-3 font-semibold text-white shadow-lg ${notice.error ? "bg-[#e57373]" : "bg-[#48a34b]"}`}
        >
          {notice.text}
        </div>
      )}
    </main>
  )
}
