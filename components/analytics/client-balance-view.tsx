"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ChevronDown, CreditCard, List } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { ClientActDialog } from "@/components/analytics/balance/client-act-dialog"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { balanceListExcelRows, type ExcelColumn } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { GroupPaymentDialog } from "@/components/analytics/balance/group-payment-dialog"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery } from "@/components/analytics/balance/use-balance"
import {
  ClientBalanceFilterButton,
  ClientBalanceFilterFields,
  ClientBalancePeriodToggle,
  clientBalanceQuery,
  stateFromParams,
  stateToSearch,
  type ClientBalanceFilters,
  type ClientBalanceMode,
  type ClientBalanceState,
} from "@/components/analytics/client-balance-filters"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceListResult, type BalanceRow } from "@/lib/finance/types"
import { NO_CLIENT_TYPE, type ClientBalanceOptions } from "@/lib/finance-client-balance-types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс клиентов" (demo #/statistics/market): per client and currency the
// balance at the start of the period, sales, returns, payments, other
// income/expense and the closing balance, from the shared finance ledger
// (GET /api/balances/client-balance). Two period bases (creation /
// realization), a client-type mode with drill-down, the demo filter popup,
// the client act modal, "Групповая оплата" and Excel exports.

const LIST_URL = "/api/balances/client-balance"

const GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.client).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

const SUMMARY: SummaryBox[] = [
  { metrics: [{ label: "Баланс на начало периода", field: "begin_balance" }, { label: "Продажи", field: "order" }] },
  { metrics: [{ label: "Возврат", field: "order_return" }, { label: "Оплачено", field: "payment" }] },
  { metrics: [{ label: "Прочие приходы", field: "none_type_plus" }, { label: "Прочие расходы", field: "none_type_minus" }] },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

/** Demo group-payment dialog shows the end balance in SUM and USD. */
const GROUP_PAYMENT_CURRENCIES = ["SUM", "USD"]

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" })
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null
  if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
  return body
}

function useClientBalanceList(url: string) {
  const [data, setData] = useState<BalanceListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError("")
    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
        if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
        setData(body)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [url, version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, loading, error, reload, version }
}

export function ClientBalanceView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ClientBalanceState>(() => stateFromParams(searchParams))
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<ClientBalanceFilters>(state.filters)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [drilledType, setDrilledType] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [groupOpen, setGroupOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [options, setOptions] = useState<ClientBalanceOptions | null>(null)
  const [canGroupPay, setCanGroupPay] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [more, setMore] = useState<{ key: string; rows: BalanceRow[]; pages: number }>({ key: "", rows: [], pages: 0 })
  const [moreLoading, setMoreLoading] = useState(false)

  const isTypes = state.toggle === "types"
  const query = useMemo(() => clientBalanceQuery(state), [state])
  const queryString = buildBalanceQuery(query)
  const { data, loading, error, reload, version } = useClientBalanceList(`${LIST_URL}?${queryString}`)

  // Keep the URL in sync with the page state (demo keeps everything in the query).
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    fetchJson<ClientBalanceOptions>(`${LIST_URL}/options`)
      .then(setOptions)
      .catch(() => setOptions(null))
    // "Групповая оплата" needs the demo permission can_see_group_payment = manager or admin here (POST requires manager).
    fetchJson<{ role?: string }>("/api/auth/me")
      .then((user) => setCanGroupPay(user.role === "manager" || user.role === "admin"))
      .catch(() => setCanGroupPay(false))
  }, [])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const update = (patch: Partial<ClientBalanceState>) => setState((current) => ({ ...current, ...patch }))

  // "Показать еще": next pages appended below the current one (reset when the list changes).
  const moreKey = `${queryString}#${version}`
  const extraPages = more.key === moreKey ? more.pages : 0
  const rows = useMemo(() => (data ? [...data.rows, ...(more.key === moreKey ? more.rows : [])] : []), [data, more, moreKey])
  const canLoadMore = Boolean(data && !loading && data.pageSize && (data.page + extraPages) * data.pageSize < data.count)
  const loadMore = async () => {
    if (!data) return
    setMoreLoading(true)
    try {
      const next = await fetchJson<BalanceListResult>(`${LIST_URL}?${buildBalanceQuery({ ...query, page: data.page + extraPages + 1 })}`)
      if (!next.rows.length) throw new Error("empty")
      setMore((current) => ({ key: moreKey, rows: [...(current.key === moreKey ? current.rows : []), ...next.rows], pages: extraPages + 1 }))
    } catch {
      setNotice({ text: t("Вы уже загрузили весь лист"), error: true })
    } finally {
      setMoreLoading(false)
    }
  }

  const changeMode = (mode: ClientBalanceMode) => {
    if (mode !== state.mode) update({ mode, page: 1 })
  }

  const openFilter = () => {
    setDraft(state.filters)
    setFilterOpen(true)
  }
  const applyFilter = (period: { from: string; to: string }) => {
    const filters = { ...draft, ...period }
    update({ filters, search: searchDraft.trim(), page: 1 })
  }

  const showClients = () => {
    setDrilledType(null)
    if (isTypes) update({ toggle: "clients", page: 1 })
  }
  const showTypes = () => {
    setDrilledType(null)
    update({ toggle: "types", page: 1, filters: { ...state.filters, clientType: [], subType: [] } })
  }
  const drillIntoType = (row: BalanceRow) => {
    setDrilledType(row.name)
    update({ toggle: "clients", page: 1, filters: { ...state.filters, clientType: [row.name || NO_CLIENT_TYPE], subType: [] } })
  }

  // The "Отфильтровано по" banner stays only while the drilled type is the whole type filter.
  const drilledValue = drilledType === null ? null : drilledType || NO_CLIENT_TYPE
  const showDrilled = !isTypes && drilledValue !== null && state.filters.clientType.length === 1 && state.filters.clientType[0] === drilledValue

  // A page number past the end (stale URL, rows removed) jumps to the last page.
  useEffect(() => {
    if (!data || loading || data.rows.length || state.page <= 1) return
    const lastPage = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > lastPage) setState((current) => ({ ...current, page: lastPage }))
  }, [data, loading, state.page, state.pageSize])

  // Like the demo, the selection survives paging but the dialog lists only the selected rows that are loaded.
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.key)), [rows, selected])

  const groupCurrencies = data ? GROUP_PAYMENT_CURRENCIES.filter((code) => data.currencies.some((currency) => currency.code === code)) : GROUP_PAYMENT_CURRENCIES
  const visible = data?.visibleCurrencies ?? []
  const period = `${formatDotDate(state.filters.from)} - ${formatDotDate(state.filters.to)}`

  const download = async (simple: boolean) => {
    try {
      const all = await fetchJson<BalanceListResult>(`${LIST_URL}?${buildBalanceQuery({ ...query, page: undefined, pageSize: 0 })}`)
      const leading: ExcelColumn<BalanceRow>[] = isTypes
        ? [{ label: "Тип клиента", value: (row) => row.name || t("Не указано") }]
        : [
            { label: "№", value: (row) => row.id },
            { label: "Клиент", value: (row) => row.name },
          ]
      const groups = simple ? [{ field: "end_balance", label: "Баланс на конец" }] : GROUPS
      const sheet = balanceListExcelRows({ rows: all.rows, groups, currencies: all.visibleCurrencies, leading, totals: all.totals, t })
      downloadExcelTable(`${t("Баланс клиентов")}${simple ? ` (${t("упрощенный")})` : ""} ${period}`, sheet)
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : t("Сервер недоступен, попробуйте ещё раз"), error: true })
    }
  }

  const firstColumn = isTypes
    ? {
        label: "Клиент",
        width: 220,
        sortKey: "name",
        render: (row: BalanceRow) => (
          <button type="button" onClick={() => drillIntoType(row)} className="flex w-full items-center justify-between gap-2 text-left text-[#333] hover:font-semibold hover:text-[#4f71dc]">
            <span>{row.name || t("Не указано")}</span>
            <List className="h-4 w-4 shrink-0 text-[#4f71dc]" />
          </button>
        ),
      }
    : {
        label: "Клиент",
        width: 220,
        sortKey: "name",
        render: (row: BalanceRow) => (
          <button
            type="button"
            onClick={() => update({ openClient: { key: row.key, name: row.name } })}
            className="text-left text-[#333] hover:font-semibold hover:text-[#4f71dc]"
          >
            {row.name || "No"}
          </button>
        ),
      }

  const footer = canLoadMore ? (
    <tr>
      <td colSpan={2 + GROUPS.length * Math.max(1, visible.length)} className="px-4 py-3">
        <div className="flex justify-center">
          <button
            type="button"
            disabled={moreLoading}
            onClick={loadMore}
            className="flex h-[30px] items-center gap-1.5 rounded-full bg-[#f0f4f8] px-8 text-[#5869f0] disabled:opacity-60"
          >
            {moreLoading ? t("Загрузка...") : t("Показать еще")}
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  ) : undefined

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] flex-wrap items-center justify-between gap-4 px-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t("Баланс клиентов")}</span>
        </div>
        <ClientBalancePeriodToggle mode={state.mode} onChange={changeMode} />
      </header>

      <section className="flex flex-wrap items-center justify-between gap-4 px-[30px] pt-5">
        <ClientBalanceFilterButton state={state} onOpen={openFilter} />
        <div className="flex items-center gap-3">
          {!isTypes && canGroupPay && (
            <button type="button" onClick={() => setGroupOpen(true)} className="flex h-[34px] items-center gap-2 rounded-[3px] bg-[#4f71dc] pl-2 pr-4 text-[13px] font-semibold text-white">
              <CreditCard className="h-5 w-5" /> {t("Групповая оплата")}
            </button>
          )}
          <BalanceDownloadMenu
            disabled={!data}
            items={[
              { label: "Скачать все", onClick: () => void download(false) },
              ...(isTypes ? [] : [{ label: "Скачать упрощенным", onClick: () => void download(true) }]),
            ]}
          />
        </div>
      </section>

      <BalanceSummaryCards boxes={SUMMARY} totals={data?.totals ?? {}} currencies={visible} loading={loading} />

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-3 border-t border-[#efefef] px-[30px] py-[10px]">
          {showDrilled && (
            <div className="whitespace-nowrap text-[14px]">
              {t("Отфильтровано по")}: <strong>{drilledType || t("Не указано")}</strong>
              <button type="button" onClick={showTypes} className="block font-semibold text-[#4f71dc] hover:underline">
                {t("Сбросить фильтр")}
              </button>
            </div>
          )}
          <div className="flex overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]">
            {(
              [
                ["clients", "Разбить по валютам", showClients],
                ["types", "Показать по типам клиентов", showTypes],
              ] as const
            ).map(([toggle, label, onClick]) => (
              <button
                key={toggle}
                type="button"
                onClick={onClick}
                className={`h-8 px-4 text-[13px] font-semibold uppercase tracking-wide ${state.toggle === toggle ? "bg-[#4f71dc] text-white shadow" : "bg-white text-[#17233b]"}`}
              >
                {t(label)}
              </button>
            ))}
          </div>

          <form
            className="mx-auto flex min-w-[160px] flex-1 justify-center"
            onSubmit={(event) => {
              event.preventDefault()
              update({ search: searchDraft.trim(), page: 1 })
            }}
          >
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={isTypes ? t("Тип клиента") : t("Клиент")}
              aria-label={isTypes ? t("Тип клиента") : t("Клиент")}
              className="h-10 w-full max-w-[256px] border-b border-[#dbe0e8] bg-transparent text-[13px] font-bold outline-none placeholder:font-bold placeholder:text-[#17233b] focus:border-[#4f70e7]"
            />
          </form>

          <BalancePagination
            page={state.page}
            pageSize={state.pageSize}
            count={data?.count ?? 0}
            onChange={({ page, pageSize }) => update({ page, pageSize })}
          />
          <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
        </section>

        {error && (
          <div className="flex items-center gap-3 px-6 py-3 text-[#e57373] md:px-9">
            <span>
              {t("Не удалось загрузить данные")}: {error}
            </span>
            <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <BalanceTable
          fixedWidth={100}
          selectionAfterFirst
          rows={rows}
          groups={GROUPS}
          currencies={visible}
          first={firstColumn}
          selection={isTypes ? undefined : { selected, onChange: setSelected }}
          ordering={state.ordering}
          onOrderingChange={(ordering) => update({ ordering, page: 1 })}
          sortCycle="asc-first"
          loading={loading}
          footer={footer}
        />
      </ExpandedOverlay>

      <BalanceFilterDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={state.filters.from}
        to={state.filters.to}
        onApply={applyFilter}
        dateLabel={state.mode === "realization" ? "Период реализации" : "Период создания транзакции"}
      >
        <ClientBalanceFilterFields draft={draft} onChange={setDraft} options={options} />
      </BalanceFilterDialog>

      {state.openClient && (
        <ClientActDialog
          key={state.openClient.key}
          kind="client"
          entityKey={state.openClient.key}
          name={state.openClient.name || rows.find((row) => row.key === state.openClient?.key)?.name || ""}
          from={state.filters.from}
          to={state.filters.to}
          mode={state.mode}
          onClose={() => update({ openClient: null })}
        />
      )}

      <GroupPaymentDialog
        open={groupOpen}
        rows={selectedRows}
        currencies={groupCurrencies}
        onClose={() => setGroupOpen(false)}
        onSaved={() => {
          reload()
          setNotice({ text: t("Успешно сохранено"), error: false })
        }}
      />

      {notice && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-[120] -translate-x-1/2 rounded-md px-5 py-3 font-semibold text-white shadow-lg ${notice.error ? "bg-[#e57373]" : "bg-[#48a34b]"}`}
        >
          {notice.text}
        </div>
      )}
    </main>
  )
}
