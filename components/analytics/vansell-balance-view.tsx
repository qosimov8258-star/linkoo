"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Info, Loader2, Minus, Pencil, Plus, Search } from "lucide-react"

import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { BalanceFilterChip, BalanceFilterDialog } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { useBalanceList, useFinanceCurrencies, useLookup } from "@/components/analytics/balance/use-balance"
import { VansellDetailDialog } from "@/components/analytics/vansell-balance-detail"
import {
  VansellLimitDialog,
  VansellMovementDialog,
  VansellSnackbar,
  VansellUsersSelect,
  paymentHintLines,
  type VansellEmployeeOption,
} from "@/components/analytics/vansell-balance-dialogs"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { currencyLabel } from "@/lib/finance/currency"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс вансел" (demo #/ven-sell): per van-sell agent and currency the
// balance at the start of the period, goods handed over / returned, money
// accepted (cash / bank), "Отход", other incomes / expenses and the balance
// at the end, from the shared finance ledger (GET /api/balances/vansell).
// Manual movements and debt limits: /api/vansell-transactions/**.
// State lives in the URL like the demo: fromDate, toDate, users (1-2-3),
// search, page, pageSize, ordering, dynamicList (open detail).

const GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.vansell).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

/** Demo ROUND_AMOUNT_FOR_CURRENCY. */
const DIGITS = 3
const DEFAULT_PAGE_SIZE = 25

/** Demo serializer default: the whole current calendar month. */
function defaultPeriod() {
  const today = todayIso()
  return { from: monthStartIso(today), to: monthEndIso(today) }
}

type ViewState = {
  /** null = default period (not counted as an active filter). */
  period: { from: string; to: string } | null
  users: string[]
  search: string
  page: number
  pageSize: number
  ordering: string[]
  /** Open detail dialog (employee key). */
  detail: string | null
}

const INITIAL_STATE: ViewState = { period: null, users: [], search: "", page: 1, pageSize: DEFAULT_PAGE_SIZE, ordering: [], detail: null }

function readUrlState(): ViewState {
  const params = new URLSearchParams(window.location.search)
  const fromDate = params.get("fromDate") ?? ""
  const toDate = params.get("toDate") ?? ""
  const fallback = defaultPeriod()
  const from = isIsoDay(fromDate) ? fromDate : isIsoDay(toDate) ? monthStartIso(toDate) : ""
  const to = isIsoDay(toDate) ? toDate : from ? (from > fallback.to ? monthEndIso(from) : fallback.to) : ""
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  const detail = params.get("dynamicList") ?? ""
  return {
    period: from && to ? (from <= to ? { from, to } : { from: to, to: from }) : null,
    users: (params.get("users") ?? "").split("-").filter((id) => /^\d+$/.test(id)),
    search: params.get("search") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter(Boolean),
    detail: /^\d+$/.test(detail) && detail !== "0" ? detail : null,
  }
}

function writeUrlState(state: ViewState) {
  const params = new URLSearchParams(window.location.search)
  const set = (name: string, value: string) => (value ? params.set(name, value) : params.delete(name))
  set("fromDate", state.period?.from ?? "")
  set("toDate", state.period?.to ?? "")
  set("users", state.users.join("-"))
  set("search", state.search)
  set("page", state.page > 1 ? String(state.page) : "")
  set("pageSize", String(state.pageSize))
  set("ordering", state.ordering.join(","))
  set("dynamicList", state.detail ?? "")
  const query = params.toString()
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next)
}

type LimitsResponse = { canUpdate: boolean; limits: Array<{ employeeId: number; limit: number }> }

/** GET /api/vansell-transactions/limits (+ whether the user may write). */
function useVansellLimits() {
  const [data, setData] = useState<LimitsResponse | null>(null)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/vansell-transactions/limits", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<LimitsResponse>) : null))
      .then((body) => {
        if (body) setData(body)
      })
      .catch(() => {})
    return () => controller.abort()
  }, [version])
  const reload = useCallback(() => setVersion((value) => value + 1), [])
  return { data, reload }
}

export function VansellBalanceView() {
  const { t } = useLanguage()
  const [state, setState] = useState<ViewState>(INITIAL_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [selected, setSelected] = useState<Map<string, string>>(new Map())
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftUsers, setDraftUsers] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [movement, setMovement] = useState<{ kind: "add" | "expense"; employeeId: number } | null>(null)
  const [limitOpen, setLimitOpen] = useState(false)
  const [notice, setNotice] = useState("")
  const hideNotice = useCallback(() => setNotice(""), [])

  // URL → state once on mount (after hydration), then state → URL.
  useEffect(() => {
    const initial = readUrlState()
    setState(initial)
    setSearchInput(initial.search)
    setHydrated(true)
  }, [])
  useEffect(() => {
    if (hydrated) writeUrlState(state)
  }, [hydrated, state])

  // Demo search box: debounced 500 ms, server-side.
  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => {
      setState((current) => (current.search === searchInput.trim() ? current : { ...current, search: searchInput.trim(), page: 1 }))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [hydrated, searchInput])

  const period = state.period ?? defaultPeriod()
  const list = useBalanceList("vansell", {
    from: period.from,
    to: period.to,
    search: state.search,
    key: state.users,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
    totalsIgnoreSearch: true,
  })
  const limits = useVansellLimits()
  const currencies = useFinanceCurrencies()
  const employees = useLookup<VansellEmployeeOption>("/api/employees")

  const data = list.data
  const rows = useMemo(() => data?.rows ?? [], [data])
  const visible = data?.visibleCurrencies ?? []
  const canEdit = Boolean(limits.data?.canUpdate)
  const limitMap = useMemo(() => new Map((limits.data?.limits ?? []).map((item) => [item.employeeId, item.limit])), [limits.data])
  const currencyList = currencies.data?.currencies ?? data?.currencies ?? []
  const filterCount = (state.period ? 1 : 0) + (state.users.length ? 1 : 0)

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))
  const reloadAll = () => {
    list.reload()
    limits.reload()
  }
  const saved = (message = "Успешно сохранено") => {
    setNotice(message)
    reloadAll()
  }
  const detailRow = state.detail ? rows.find((row) => row.key === state.detail) : undefined

  const boxes: SummaryBox[] = [
    {
      metrics: [
        { label: "Передача на склад", field: "stock_transfer_minus" },
        { label: "Возврат передачи", field: "stock_transfer_plus" },
      ],
    },
    {
      metrics: [
        {
          label: "Принятие оплаты",
          field: "payment_accepted",
          value: (balance) => (balance.cash_transfer_plus ?? 0) + (balance.bank_transfer_plus ?? 0),
          hint: (
            <span className="group relative inline-flex">
              <Info className="h-4 w-4 cursor-help text-[#9aa3b6]" aria-label={`${t("Перечисление")} / ${t("Наличные")}`} />
              <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden -translate-x-1/2 whitespace-nowrap rounded bg-[#323232] px-3 py-2 text-[12px] font-normal leading-5 text-white shadow-lg group-hover:block">
                {paymentHintLines(data?.totals ?? {}, visible, currencyLabel, t).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </span>
            </span>
          ),
        },
        { label: "Отход", field: "order_return_plus" },
      ],
    },
    {
      metrics: [
        { label: "Прочие приходы", field: "none_type_plus" },
        { label: "Прочие расходы", field: "none_type_minus" },
      ],
    },
    {
      align: "right",
      metrics: [
        { label: "Баланс на начало периода", field: "begin_balance" },
        { label: "Баланс на конец периода", field: "end_balance" },
      ],
    },
  ]

  const nameCell = (row: BalanceRow) => (
    <div className="flex items-center justify-between gap-3">
      <button type="button" onClick={() => update({ detail: row.key })} className="text-left text-[#333] hover:underline">
        {row.name || t("Не указано")}
      </button>
      {canEdit && row.id !== null && (
        <span className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            title={t("Добавить расход")}
            aria-label={t("Добавить расход")}
            onClick={() => setMovement({ kind: "expense", employeeId: row.id! })}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[#ff584b] text-white hover:opacity-85"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            title={t("Добавить")}
            aria-label={t("Добавить")}
            onClick={() => setMovement({ kind: "add", employeeId: row.id! })}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-[#8dc572] text-white hover:opacity-85"
          >
            <Plus className="h-4 w-4" />
          </button>
        </span>
      )}
    </div>
  )

  const onSelectionChange = (next: Set<string>) => {
    setSelected((current) => {
      const map = new Map<string, string>()
      for (const key of next) map.set(key, rows.find((row) => row.key === key)?.name ?? current.get(key) ?? key)
      return map
    })
  }

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] items-center px-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t("Баланс вансел")}</span>
        </div>
      </header>

      <div className="pt-[10px]">
        {data ? (
          <BalanceSummaryCards marginClass="mx-[10px]" boxes={boxes} totals={data.totals} currencies={visible} digits={DIGITS} loading={list.loading} />
        ) : (
          <div className="flex h-[150px] items-center justify-center pb-6">
            {list.error ? <span className="text-[#e57373]">{t(list.error)}</span> : <Loader2 className="h-7 w-7 animate-spin text-[#4f70e7]" />}
          </div>
        )}
      </div>

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#efefef] px-[10px] py-[10px]">
          <BalanceFilterChip
            count={filterCount}
            onOpen={() => {
              setDraftUsers(state.users)
              setFilterOpen(true)
            }}
            onClear={() => update({ period: null, users: [], page: 1 })}
          />
          <label className="relative min-w-[200px] flex-1 border-b border-[#dbe0e8] pb-1.5">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[13px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-5">
            {canEdit && (
              <button type="button" onClick={() => setLimitOpen(true)} className="flex h-[30px] items-center gap-2 rounded-[3px] bg-[#4f71dc] pl-2 pr-4 text-[13px] font-semibold text-white">
                <Pencil className="h-4 w-4" /> {t("Изменить лимит")}
                {selected.size > 0 && <span className="rounded-full bg-white/25 px-2 text-[12px]">{selected.size}</span>}
              </button>
            )}
            <BalancePagination page={state.page} pageSize={state.pageSize} count={data?.count ?? 0} onChange={(next) => update(next)} />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        {list.error && data && (
          <div className="flex items-center justify-between gap-4 bg-[#fdecec] px-6 py-2 text-[14px] text-[#c62828] md:px-9">
            <span>{t(list.error)}</span>
            <button type="button" onClick={list.reload} className="font-semibold underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <section className="bg-white pb-10">
          <BalanceTable
          fixedWidth={100}
              selectionAfterFirst
            rows={rows}
            groups={GROUPS}
            currencies={visible}
            first={{ label: "Вансел", width: 220, sortKey: "name", render: nameCell }}
            selection={{ selected: new Set(selected.keys()), onChange: onSelectionChange }}
            ordering={state.ordering}
            onOrderingChange={(ordering) => update({ ordering, page: 1 })}
            sortCycle="asc-first"
            digits={DIGITS}
            loading={list.loading}
          />
        </section>
      </ExpandedOverlay>

      <BalanceFilterDialog
        variant="card"
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={period.from}
        to={period.to}
        dateLabel="Период создания"
        onApply={(next) => {
          // An untouched default period stays "not set" (the demo counts only a chosen period).
          const unchanged = !state.period && next.from === period.from && next.to === period.to
          update({ period: unchanged ? null : next, users: draftUsers, page: 1 })
        }}
      >
        <VansellUsersSelect options={employees} value={draftUsers} onChange={setDraftUsers} />
      </BalanceFilterDialog>

      {state.detail && (
        <VansellDetailDialog
          key={state.detail}
          entityKey={state.detail}
          name={detailRow?.name ?? ""}
          currencies={currencyList}
          canEdit={canEdit}
          onClose={() => update({ detail: null })}
          onChanged={saved}
        />
      )}

      {movement && (
        <VansellMovementDialog
          kind={movement.kind}
          employeeId={movement.employeeId}
          employees={employees}
          currencies={currencyList}
          onClose={() => setMovement(null)}
          onSaved={() => {
            setMovement(null)
            saved()
          }}
        />
      )}

      {limitOpen && (
        <VansellLimitDialog
          rows={[...selected.entries()].map(([key, name]) => ({ id: Number(key), name }))}
          limits={limitMap}
          onClose={() => setLimitOpen(false)}
          onSaved={() => {
            setLimitOpen(false)
            setSelected(new Map())
            saved()
          }}
        />
      )}

      <VansellSnackbar text={notice} onHide={hideNotice} />
    </main>
  )
}
