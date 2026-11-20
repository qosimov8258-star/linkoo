"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, MoreVertical, Search } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterChip, BalanceFilterDialog, FilterCardOptionSelect, FilterVariant } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList, useFinanceCurrencies, useLookup, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { EmployeeActDialog } from "@/components/analytics/employee-balance-act"
import {
  EmployeeOptionDialog,
  EmployeeSnackbar,
  EmployeeUsersSelect,
  EMPLOYEE_OPTION_LABELS,
  type EmployeeOptionType,
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
// Штрафы, Коректировки (manual fines and corrections) and the balance at the
// end, from the shared finance ledger (GET /api/balances/employee). Positive =
// the company owes the employee, negative = advance. Manual movements:
// POST /api/employee-balance-transactions. State lives in the URL like the
// demo: fromDate, toDate, users (1-2-3), search, page, pageSize, ordering,
// dynamicList (open act), employeeBalanceDialogOpen + optionType (Linko's ⋮
// «Создать штраф» = penalty / «Создать корректировку» = none_type for an
// employee id); the menu's toggle/withProfit leftovers are ignored.

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
  /** Filter dialog selects (reference order: Пользователи, Должность, Права доступа, Организация). */
  job: string
  accessRight: string
  organizationId: string
  search: string
  page: number
  pageSize: number
  ordering: string[]
  /** Open act (employee key). */
  detail: string | null
  /** Open «Штраф» (penalty) / «Корректировка» (none_type) dialog. */
  movement: { type: EmployeeOptionType; employeeId: number } | null
}

const INITIAL_STATE: ViewState = { period: null, users: [], job: "", accessRight: "", organizationId: "", search: "", page: 1, pageSize: DEFAULT_PAGE_SIZE, ordering: [], detail: null, movement: null }

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
  const optionId = positiveId(params.get("employeeBalanceDialogOpen"))
  const optionType = params.get("optionType")
  return {
    period: from && to ? (from <= to ? { from, to } : { from: to, to: from }) : null,
    users: (params.get("users") ?? "").split("-").filter((id) => /^\d+$/.test(id)),
    job: params.get("position") ?? "",
    accessRight: params.get("accessRight") ?? "",
    organizationId: /^\d+$/.test(params.get("organization") ?? "") ? (params.get("organization") as string) : "",
    search: params.get("search") ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: Number.isInteger(pageSize) && pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter(Boolean),
    detail: /^\d+$/.test(detail) && detail !== "0" ? detail : null,
    movement: optionId && (optionType === "penalty" || optionType === "none_type") ? { type: optionType, employeeId: optionId } : null,
  }
}

function writeUrlState(state: ViewState) {
  const params = new URLSearchParams(window.location.search)
  const set = (name: string, value: string) => (value ? params.set(name, value) : params.delete(name))
  set("fromDate", state.period?.from ?? "")
  set("toDate", state.period?.to ?? "")
  set("users", state.users.join("-"))
  set("position", state.job)
  set("accessRight", state.accessRight)
  set("organization", state.organizationId)
  set("search", state.search)
  set("page", state.page > 1 ? String(state.page) : "")
  set("pageSize", String(state.pageSize))
  set("ordering", state.ordering.join(","))
  set("dynamicList", state.detail ?? "")
  set("employeeBalanceDialogOpen", state.movement ? String(state.movement.employeeId) : "")
  set("optionType", state.movement?.type ?? "")
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

type RowMenu = { employeeId: number; rowKey: string; top: number; left: number }

// Linko's menu icons (Material money-off, exposure, compare-arrows).
const MONEY_OFF_ICON =
  "M12.5 6.9c1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-.53.12-1.03.3-1.48.54l1.47 1.47c.41-.17.91-.27 1.51-.27zM5.33 4.06L4.06 5.33 7.5 8.77c0 2.08 1.56 3.21 3.91 3.91l3.51 3.51c-.34.48-1.05.91-2.42.91-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c.96-.18 1.82-.55 2.45-1.12l2.22 2.22 1.27-1.27L5.33 4.06z"
const CORRECTION_ICON = "M15 17v2h2v-2h2v-2h-2v-2h-2v2h-2v2h2zm5-15H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM5 5h6v2H5V5zm15 15H4L20 4v16z"
const ACT_ICON = "M9.01 14H2v2h7.01v3L13 15l-3.99-4v3zm5.98-1v-3H22V8h-7.01V5L11 9l3.99 4z"

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
  const employees = useLookup<EmployeeOption & { job?: string; accessRight?: string; organizationIds?: number[] }>("/api/employees")
  const organizations = useLookup<{ id: number; name: string }>("/api/organizations")
  // Должность / Права доступа / Организация narrow the rows to the matching employees (with the chosen users, if any).
  const attributeFilter = Boolean(state.job || state.accessRight || state.organizationId)
  const filteredKeys = useMemo(() => {
    if (!attributeFilter) return state.users
    const chosen = new Set(state.users)
    const keys = employees
      .filter((item) => (!state.job || item.job === state.job) && (!state.accessRight || item.accessRight === state.accessRight))
      .filter((item) => !state.organizationId || (item.organizationIds ?? []).includes(Number(state.organizationId)))
      .map((item) => String(item.id))
      .filter((id) => !chosen.size || chosen.has(id))
    return keys.length ? keys : ["0"]
  }, [attributeFilter, employees, state.users, state.job, state.accessRight, state.organizationId])
  const query: BalanceQuery = {
    from: period.from,
    to: period.to,
    search: state.search,
    key: filteredKeys,
    ordering: state.ordering,
    page: state.page,
    pageSize: state.pageSize,
    // Demo: the totals (cards) ignore search and the users filter.
    totalsIgnoreSearch: true,
  }
  const list = useBalanceList("employee", query)
  const currencies = useFinanceCurrencies()
  const [draftJob, setDraftJob] = useState("")
  const [draftRight, setDraftRight] = useState("")
  const [draftOrg, setDraftOrg] = useState("")
  const canEdit = useCanEdit()

  const data = list.data
  const rows = useMemo(() => data?.rows ?? [], [data])
  const visible = useMemo(() => (data ? shownCurrencies(data) : []), [data])
  const currencyList = currencies.data?.currencies ?? data?.currencies ?? []
  const filterCount = (state.period ? 1 : 0) + (state.users.length ? 1 : 0) + (state.job ? 1 : 0) + (state.accessRight ? 1 : 0) + (state.organizationId ? 1 : 0)

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
      {row.id !== null && (
        <button
          type="button"
          data-employee-menu
          aria-label={t("Действия")}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            // Linko's menu opens over the row, its left edge just before the ⋮.
            setMenu((current) => (current?.employeeId === row.id ? null : { employeeId: row.id!, rowKey: row.key, top: rect.top - 13, left: rect.left - 30 }))
          }}
          className="mr-[13px] shrink-0 rounded-full p-0.5 text-[#333] hover:bg-[#f2f5f8]"
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
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#1E4A9A]" />
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
                <button type="button" onClick={list.reload} className="font-semibold text-[#1E4A9A] underline">
                  {t("Повторить")}
                </button>
              </>
            ) : (
              <Loader2 className="h-7 w-7 animate-spin text-[#1E4A9A]" />
            )}
          </div>
        )}
      </div>

      <ExpandedOverlay expanded={expanded}>
        <section className="relative flex flex-wrap items-center gap-x-5 gap-y-3 border-t border-[#efefef] px-[10px] mt-[7px] py-0">
          <BalanceFilterChip
            count={filterCount}
            variant="button"
            onOpen={() => {
              setDraftUsers(state.users)
              setDraftJob(state.job)
              setDraftRight(state.accessRight)
              setDraftOrg(state.organizationId)
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
              {downloading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                // Linko's filled «file_download» icon.
                <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#666]" aria-hidden>
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" />
                </svg>
              )}
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
            rowPad={9}
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
        <div data-employee-menu role="menu" className="fixed z-[95] w-[280px] rounded-[2px] bg-white py-[8px] shadow-[0_3px_10px_rgba(0,0,0,0.16),0_3px_10px_rgba(0,0,0,0.23)]" style={{ top: menu.top, left: menu.left }}>
          {[
            ...(canEdit
              ? (Object.keys(EMPLOYEE_OPTION_LABELS) as EmployeeOptionType[]).map((type) => ({
                  key: type,
                  label: type === "penalty" ? "Создать штраф" : "Создать корректировку",
                  icon: type === "penalty" ? MONEY_OFF_ICON : CORRECTION_ICON,
                  run: () => update({ movement: { type, employeeId: menu.employeeId } }),
                }))
              : []),
            { key: "act", label: "Показать акт сверки", icon: ACT_ICON, run: () => update({ detail: menu.rowKey }) },
          ].map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                item.run()
                setMenu(null)
              }}
              className="flex h-[48px] w-full items-center gap-[21px] pl-[20px] pr-[16px] text-left text-[13px] text-[#333] hover:bg-[#f5f5f5]"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="h-[24px] w-[24px] shrink-0 fill-[#757575]"><path d={item.icon} /></svg>
              {t(item.label)}
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
          update({ period: unchanged ? null : next, users: draftUsers, job: draftJob, accessRight: draftRight, organizationId: draftOrg, page: 1 })
        }}
      >
        <EmployeeUsersSelect options={draftJob ? employees.filter((item) => item.job === draftJob) : employees} value={draftUsers} onChange={setDraftUsers} />
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
        <FilterCardOptionSelect
          label={t("Права доступа")}
          value={draftRight}
          onChange={setDraftRight}
          options={[...new Set(employees.map((item) => item.accessRight).filter((right): right is string => !!right))].sort((a, b) => a.localeCompare(b, "ru")).map((right) => ({ value: right, label: right }))}
        />
        <FilterCardOptionSelect label={t("Организация")} value={draftOrg} onChange={setDraftOrg} options={organizations.map((item) => ({ value: String(item.id), label: item.name }))} />
      </BalanceFilterDialog>

      {state.detail && (
        <EmployeeActDialog key={state.detail} entityKey={state.detail} name={detailName} from={period.from} to={period.to} onClose={() => update({ detail: null })} />
      )}

      {state.movement && canEdit && (
        <EmployeeOptionDialog
          key={`${state.movement.type}:${state.movement.employeeId}`}
          type={state.movement.type}
          employeeId={state.movement.employeeId}
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
