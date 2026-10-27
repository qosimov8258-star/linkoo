"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Download, Loader2, MoreVertical, Search } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterChip, BalanceFilterDialog, FilterVariant } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList, useFinanceCurrencies, useLookup, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { EmployeeActDialog } from "@/components/analytics/employee-balance-act"
import {
  EmployeeMovementDialog,
  EmployeeSnackbar,
  EmployeeUsersSelect,
  MOVEMENT_ACTION_LABELS,
  type EmployeeMovementAction,
  type EmployeeOption,
} from "@/components/analytics/employee-balance-dialogs"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceListResult, type BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс сотрудников" (demo #/statistics/employee-balance, a fork of the
// van-sell page): per employee and currency the balance at the start of the
// period, Зарплата / Зачислено KPI (credited salary plans), Введено с кассы,
// Штрафы, Коректировки (manual "Зачислить" / "Списать") and the balance at the
// end, from the shared finance ledger (GET /api/balances/employee). Positive =
// the company owes the employee, negative = advance. Manual movements:
// POST /api/employee-balance-transactions. State lives in the URL like the
// demo: fromDate, toDate, users (1-2-3), search, page, pageSize, ordering,
// dynamicList (open act), openAddDialog / openCreateDialog (open "Зачислить" /
// "Списать" for an employee id, the van-sell dialog keys); the menu's
// toggle/withProfit leftovers are ignored.

const GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.employee).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец периода" },
]

const BOXES: SummaryBox[] = [
  {
    metrics: [
      { label: "Баланс на начало периода", field: "begin_balance" },
      { label: "Зарплата", field: "monthly" },
    ],
  },
  {
    metrics: [
      { label: "Зачислено KPI", field: "performance_bonus" },
      { label: "Введено с кассы", field: "payment" },
    ],
  },
  {
    metrics: [
      { label: "Штрафы", field: "penalty" },
      { label: "Коректировки", field: "none_type" },
    ],
  },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

/** Demo ROUND_AMOUNT_FOR_CURRENCY. */
const DIGITS = 3
const DEFAULT_PAGE_SIZE = 25

/** Currency sub-columns: the demo rule (visibleCurrencies: non-zero totals,
 * else the first) plus every currency that is non-zero on a returned row —
 * otherwise opposite balances of two employees (+20 USD / −20 USD) that cancel
 * out in the totals would be hidden. Ordered like the currency list. */
function shownCurrencies(result: Pick<BalanceListResult, "currencies" | "visibleCurrencies" | "rows">): string[] {
  const shown = new Set(result.visibleCurrencies)
  for (const row of result.rows) {
    for (const [code, balance] of Object.entries(row.currencies)) {
      if (Object.values(balance).some((value) => typeof value === "number" && value !== 0)) shown.add(code)
    }
  }
  const ordered = result.currencies.map((currency) => currency.code).filter((code) => shown.has(code))
  return [...ordered, ...[...shown].filter((code) => !ordered.includes(code))]
}

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
  /** Open act (employee key). */
  detail: string | null
  /** Open "Зачислить" (add) / "Списать" (expense) dialog. */
  movement: { action: EmployeeMovementAction; employeeId: number } | null
}

const INITIAL_STATE: ViewState = { period: null, users: [], search: "", page: 1, pageSize: DEFAULT_PAGE_SIZE, ordering: [], detail: null, movement: null }

function positiveId(value: string | null): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}

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
  const addId = positiveId(params.get("openAddDialog"))
  const expenseId = positiveId(params.get("openCreateDialog"))
  return {
    period: from && to ? (from <= to ? { from, to } : { from: to, to: from }) : null,
    users: (params.get("users") ?? "").split("-").filter((id) => /^\d+$/.test(id)),
    search: params.get("search") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter(Boolean),
    detail: /^\d+$/.test(detail) && detail !== "0" ? detail : null,
    movement: addId ? { action: "add", employeeId: addId } : expenseId ? { action: "expense", employeeId: expenseId } : null,
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
  set("openAddDialog", state.movement?.action === "add" ? String(state.movement.employeeId) : "")
  set("openCreateDialog", state.movement?.action === "expense" ? String(state.movement.employeeId) : "")
  const query = params.toString()
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next)
}

/** Whether the signed-in user may write (manager+), from /api/auth/me. */
function useCanEdit(): boolean {
  const [canEdit, setCanEdit] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/auth/me", { signal: controller.signal, cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<{ role?: string }>) : null))
      .then((user) => setCanEdit(user?.role === "manager" || user?.role === "admin"))
      .catch(() => {})
    return () => controller.abort()
  }, [])
  return canEdit
}

type RowMenu = { employeeId: number; top: number; left: number }

export function EmployeeBalanceView() {
  const { t } = useLanguage()
  const [state, setState] = useState<ViewState>(INITIAL_STATE)
  const [hydrated, setHydrated] = useState(false)
  const [searchInput, setSearchInput] = useState("")
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftUsers, setDraftUsers] = useState<string[]>([])
  const [expanded, setExpanded] = useState(false)
  const [menu, setMenu] = useState<RowMenu | null>(null)
  const [downloading, setDownloading] = useState(false)
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

  // The row menu is a fixed popover: close it on outside click, scroll or resize.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onDown = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest?.("[data-employee-menu]")) close()
    }
    document.addEventListener("mousedown", onDown)
    window.addEventListener("scroll", close, true)
    window.addEventListener("resize", close)
    return () => {
      document.removeEventListener("mousedown", onDown)
      window.removeEventListener("scroll", close, true)
      window.removeEventListener("resize", close)
    }
  }, [menu])

  const period = state.period ?? defaultPeriod()
  const query: BalanceQuery = {
    from: period.from,
    to: period.to,
    search: state.search,
    key: state.users,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
    // Demo: the totals (cards) ignore search and the users filter.
    totalsIgnoreSearch: true,
  }
  const list = useBalanceList("employee", query)
  const currencies = useFinanceCurrencies()
  const employees = useLookup<EmployeeOption & { job?: string }>("/api/employees")
  const [draftJob, setDraftJob] = useState("")
  const canEdit = useCanEdit()

  const data = list.data
  const rows = useMemo(() => data?.rows ?? [], [data])
  const visible = useMemo(() => (data ? shownCurrencies(data) : []), [data])
  const currencyList = currencies.data?.currencies ?? data?.currencies ?? []
  const filterCount = (state.period ? 1 : 0) + (state.users.length ? 1 : 0)

  const update = (patch: Partial<ViewState>) => setState((current) => ({ ...current, ...patch }))

  // A page past the end (rows removed, deep link ?page=99) falls back to the last page.
  const lastPage = data && data.pageSize > 0 ? Math.max(1, Math.ceil(data.count / data.pageSize)) : 1
  if (data && !list.loading && data.page === state.page && data.pageSize === state.pageSize && state.page > lastPage) {
    setState({ ...state, page: lastPage })
  }
  const detailName = state.detail ? (rows.find((row) => row.key === state.detail)?.name ?? employees.find((item) => String(item.id) === state.detail)?.name ?? "") : ""

  const downloadAll = async () => {
    setDownloading(true)
    try {
      const response = await fetch(`/api/balances/employee?${buildBalanceQuery({ ...query, page: undefined, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(
        `${t("Баланс сотрудников")} ${period.from}_${period.to}`,
        balanceListExcelRows({
          rows: body.rows,
          groups: GROUPS,
          currencies: shownCurrencies(body),
          leading: [{ label: "Пользователь", value: (row) => row.name }],
          t,
        }),
      )
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setDownloading(false)
    }
  }

  const nameCell = (row: BalanceRow) => (
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => update({ detail: row.key })} className="text-left text-[#333] hover:underline">
        {row.name || t("Не указано")}
      </button>
      {canEdit && row.id !== null && (
        <button
          type="button"
          data-employee-menu
          aria-label={t("Действия")}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu((current) => (current?.employeeId === row.id ? null : { employeeId: row.id!, top: rect.bottom + 4, left: rect.left }))
          }}
          className="shrink-0 rounded-full p-0.5 text-[#333] hover:bg-[#f2f5f8]"
        >
          <MoreVertical className="h-5 w-5" />
        </button>
      )}
    </div>
  )

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] items-center pl-[30px] pr-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t("Баланс сотрудников")}</span>
        </div>
      </header>

      <div className="pt-[10px]">
        {data ? (
          <BalanceSummaryCards compact marginClass="mx-[10px]" boxes={BOXES} totals={data.totals} currencies={visible} digits={DIGITS} loading={list.loading} />
        ) : (
          <div className="flex h-[150px] items-center justify-center gap-3 pb-6">
            {list.error ? (
              <>
                <span className="text-[#e57373]">{t(list.error)}</span>
                <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] underline">
                  {t("Повторить")}
                </button>
              </>
            ) : (
              <Loader2 className="h-7 w-7 animate-spin text-[#4f70e7]" />
            )}
          </div>
        )}
      </div>

      <ExpandedOverlay expanded={expanded}>
        <section className="relative flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#efefef] px-[10px] pb-[8px] pt-[15px]">
          <BalanceFilterChip
            count={filterCount}
            onOpen={() => {
              setDraftUsers(state.users)
              setFilterOpen(true)
            }}
            onClear={() => update({ period: null, users: [], page: 1 })}
          />
          <label style={{ left: "calc(50% - 182px)" }} className="absolute w-[182px] border-b border-[#e0e0e0] pb-1.5">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>
          <div className="ml-auto flex flex-wrap items-center gap-5">
            <button
              type="button"
              onClick={downloadAll}
              disabled={!data || downloading}
              title={t("Скачать Excel")}
              aria-label={t("Скачать Excel")}
              className="text-[#586174] hover:text-[#17233b] disabled:opacity-40"
            >
              {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
            </button>
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
            rows={rows}
            groups={GROUPS}
            currencies={visible}
            first={{ label: "Пользователь", width: 220, sortKey: "name", render: nameCell }}
            ordering={state.ordering}
            onOrderingChange={(ordering) => update({ ordering, page: 1 })}
            sortCycle="asc-first"
            digits={DIGITS}
            loading={list.loading}
          />
        </section>
      </ExpandedOverlay>

      {menu && (
        <div data-employee-menu className="fixed z-[95] w-48 rounded-sm bg-white py-1 shadow-xl" style={{ top: menu.top, left: menu.left }}>
          {(Object.keys(MOVEMENT_ACTION_LABELS) as EmployeeMovementAction[]).map((action) => (
            <button
              key={action}
              type="button"
              onClick={() => {
                update({ movement: { action, employeeId: menu.employeeId } })
                setMenu(null)
              }}
              className={`block w-full px-4 py-2.5 text-left text-[14px] hover:bg-slate-50 ${action === "add" ? "text-[#48a34b]" : "text-[#E27676]"}`}
            >
              {t(MOVEMENT_ACTION_LABELS[action])}
            </button>
          ))}
        </div>
      )}

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
        <FilterVariant
          plain={
          <label className="flex flex-col gap-1 md:col-span-2">
            <span className="text-sm text-[#586174]">{t("Должность")}</span>
            <select
              value={draftJob}
              onChange={(event) => {
                setDraftJob(event.target.value)
                setDraftUsers([])
              }}
              className="h-10 rounded-md border border-[#dbe0e8] bg-white px-3 text-[#17233b]"
            >
              <option value="">{t("Выберите...")}</option>
              {[...new Set(employees.map((item) => item.job).filter((job): job is string => !!job))].sort((a, b) => a.localeCompare(b, "ru")).map((job) => (
                <option key={job} value={job}>{job}</option>
              ))}
            </select>
          </label>
          }
          card={
            <label className="relative block h-[40px] border-b border-[#d5dae1]">
              <span className={`pointer-events-none absolute left-0 ${draftJob ? "top-0 text-[10px] font-semibold leading-3" : "top-[18px] text-[13px] font-bold leading-4"}`}>{t("Должность")}</span>
              <select
                value={draftJob}
                onChange={(event) => {
                  setDraftJob(event.target.value)
                  setDraftUsers([])
                }}
                className="absolute inset-x-0 bottom-0 h-[26px] w-full appearance-none bg-transparent text-[13px] outline-none"
              >
                <option value=""></option>
                {[...new Set(employees.map((item) => item.job).filter((job): job is string => !!job))].sort((a, b) => a.localeCompare(b, "ru")).map((job) => (
                  <option key={job} value={job}>{job}</option>
                ))}
              </select>
              <svg viewBox="0 0 10 5" className="pointer-events-none absolute bottom-[10px] right-[2px] h-[5px] w-[10px] fill-[#757575]" aria-hidden><path d="M0 0h10L5 5z" /></svg>
            </label>
          }
        />
        <EmployeeUsersSelect options={draftJob ? employees.filter((item) => item.job === draftJob) : employees} value={draftUsers} onChange={setDraftUsers} />
      </BalanceFilterDialog>

      {state.detail && (
        <EmployeeActDialog key={state.detail} entityKey={state.detail} name={detailName} from={period.from} to={period.to} onClose={() => update({ detail: null })} />
      )}

      {state.movement && canEdit && (
        <EmployeeMovementDialog
          key={`${state.movement.action}:${state.movement.employeeId}`}
          action={state.movement.action}
          employeeId={state.movement.employeeId}
          employees={employees}
          currencies={currencyList}
          onClose={() => update({ movement: null })}
          onSaved={() => {
            update({ movement: null })
            setNotice("Успешно сохранено")
            list.reload()
          }}
        />
      )}

      <EmployeeSnackbar text={notice} onHide={hideNotice} />
    </main>
  )
}
