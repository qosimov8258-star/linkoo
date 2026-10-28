"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { FileSpreadsheet, MinusCircle, PlusCircle, Search, X } from "lucide-react"

import { BalanceTable } from "@/components/analytics/balance/balance-table"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterChip, BalanceFilterDialog, FilterCardSelect, FilterVariant, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList, useLookup } from "@/components/analytics/balance/use-balance"
import { BranchDetailDialog, BranchTransactionDialog, type BranchOption } from "@/components/analytics/branch-balance-dialogs"
import { withRecordedBalances, type BranchRow, type ManualEntry } from "@/components/analytics/branch-tab-view"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { isIsoDay, monthEndIso, monthStartIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceListResult, type BalanceRow, type CurrencyBalance } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс филиалов" (demo #/branch-balance, a clone of the van-sell balance):
// per branch per currency begin balance, Передача на склад / Возврат передачи
// (internal transfers between warehouses of different branches), Оплата
// (cash transfers between cashboxes of different branches), Прочие приходы /
// расходы (this page's manual entries) and end balance, all from the shared
// ledger GET /api/balances/branch. Query state mirrors the demo URL params
// (fromDate, toDate, branch, search, page, pageSize, ordering, dynamicList,
// openAddDialog, openCreateDialog).

const DEFAULT_PAGE_SIZE = 25

const GROUPS = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  ...Object.entries(MOVEMENT_LABELS.branch).map(([field, label]) => ({ field, label })),
  { field: "end_balance", label: "Баланс на конец" },
]

const SUMMARY_BOXES: SummaryBox[] = [
  {
    metrics: [
      { label: "Баланс на начало периода", field: "begin_balance" },
      { label: "Принятие оплаты", field: "payments" },
    ],
  },
  {
    metrics: [
      { label: "Передача на склад", field: "stock_transfer_minus" },
      { label: "Возврат передачи", field: "stock_transfer_plus" },
    ],
  },
  {
    metrics: [
      { label: "Прочие приходы", field: "none_type_plus" },
      { label: "Прочие расходы", field: "none_type_minus" },
    ],
  },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

/**
 * Currency sub-columns: the demo rule (codes with a non-zero total, else the
 * first) plus every code that is non-zero on one of the given rows. Branch
 * payments and transfers between branches net to zero in the totals, so the
 * demo rule alone would hide e.g. a USD transfer between two branches.
 */
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

/** Demo default period of this page: the current calendar month (listFilterSerializer). */
function monthPeriod() {
  return { from: monthStartIso(), to: monthEndIso() }
}

type UrlState = {
  period: { from: string; to: string }
  periodApplied: boolean
  branches: string[]
  search: string
  page: number
  pageSize: number
  ordering: string[]
  detail: string | null
  create: { kind: "add" | "expense"; branchId: number } | null
}

function readUrlState(params: Pick<URLSearchParams, "get" | "getAll">): UrlState {
  const fallback = monthPeriod()
  const fromDate = params.get("fromDate")
  const toDate = params.get("toDate")
  const from = isIsoDay(fromDate) ? fromDate : null
  const to = isIsoDay(toDate) ? toDate : null
  const start = from ?? (to && to < fallback.from ? to : fallback.from)
  const end = to ?? (from && from > fallback.to ? from : fallback.to)
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  const detail = params.get("dynamicList")
  const addId = Number(params.get("openAddDialog"))
  const expenseId = Number(params.get("openCreateDialog"))
  return {
    period: start <= end ? { from: start, to: end } : { from: end, to: start },
    periodApplied: Boolean(from || to),
    branches: [
      ...new Set(
        params
          .getAll("branch")
          .flatMap((value) => value.split(/[-,]/))
          .map((value) => value.trim())
          .filter((value) => /^\d+$/.test(value)),
      ),
    ],
    search: params.get("search")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter(Boolean),
    detail: detail && /^\d+$/.test(detail) ? detail : null,
    create:
      Number.isInteger(addId) && addId > 0
        ? { kind: "add", branchId: addId }
        : Number.isInteger(expenseId) && expenseId > 0
          ? { kind: "expense", branchId: expenseId }
          : null,
  }
}

export function BranchBalanceView() {
  const { t } = useLanguage()
  const searchParams = useSearchParams()
  const [initial] = useState(() => readUrlState(searchParams))

  const [period, setPeriod] = useState(initial.period)
  const [periodApplied, setPeriodApplied] = useState(initial.periodApplied)
  const [branchIds, setBranchIds] = useState<string[]>(initial.branches)
  const [draftBranchIds, setDraftBranchIds] = useState<string[]>(initial.branches)
  const [searchInput, setSearchInput] = useState(initial.search)
  const [search, setSearch] = useState(initial.search)
  const [paging, setPaging] = useState({ page: initial.page, pageSize: initial.pageSize })
  const [ordering, setOrdering] = useState<string[]>(initial.ordering)
  const [filterOpen, setFilterOpen] = useState(false)
  const [branchListOpen, setBranchListOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<{ key: string; name: string } | null>(initial.detail ? { key: initial.detail, name: "" } : null)
  const [create, setCreate] = useState<{ kind: "add" | "expense"; branchId: number } | null>(initial.create)
  const [toast, setToast] = useState("")
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  const branchOptions = useLookup<BranchOption>("/api/branches")
  // Like the reference, the list holds only the branches that have manual balance entries, in the order of their first entry;
  // their opening / closing balances come from those entries (same rule as the dashboard tab ФИЛИАЛ).
  const [entries, setEntries] = useState<ManualEntry[] | null>(null)
  useEffect(() => {
    fetch("/api/branch-balance-transactions")
      .then((response) => (response.ok ? (response.json() as Promise<ManualEntry[]>) : []))
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])
  const entryOrder = useMemo(() => {
    if (!entries) return null
    const first = new Map<number, number>()
    for (const entry of entries) if (!first.has(entry.branchId) || entry.id < first.get(entry.branchId)!) first.set(entry.branchId, entry.id)
    return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([branchId]) => String(branchId))
  }, [entries])
  const query = useMemo(
    () => ({ from: period.from, to: period.to, search, key: branchIds.length ? branchIds : (entryOrder ?? ["0"]), ordering, page: 1, pageSize: 1000, totalsIgnoreSearch: true }),
    [period, search, branchIds, entryOrder, ordering],
  )
  const { data, loading, error, reload } = useBalanceList("branch", query)
  const processed = useMemo(() => {
    const all = data?.rows ?? []
    const listed = ordering.length || branchIds.length || !entryOrder ? all : entryOrder.map((key) => all.find((row) => row.key === key)).filter((row): row is (typeof all)[number] => !!row)
    return entries ? listed.map((row) => withRecordedBalances(row as unknown as BranchRow, entries, period.from, period.to) as unknown as (typeof all)[number]) : listed
  }, [data, entries, entryOrder, ordering, branchIds, period])
  const count = processed.length
  const rows = processed.slice((paging.page - 1) * paging.pageSize, paging.page * paging.pageSize)
  const totals = useMemo(() => {
    const sums = {} as Record<string, CurrencyBalance>
    for (const row of processed) {
      for (const [code, figures] of Object.entries(row.currencies)) {
        const target = (sums[code] ??= { begin_balance: 0, end_balance: 0 })
        for (const [field, value] of Object.entries(figures)) if (typeof value === "number") target[field] = (target[field] ?? 0) + value
      }
    }
    return sums
  }, [processed])
  const currencies = useMemo(() => (data ? shownCurrencies(data) : ["SUM"]), [data])
  const filterCount = countActiveFilters({ toDate: periodApplied ? period.to : "", branch: branchIds })

  // A page past the end (rows removed, deep link) falls back to the last page.
  const lastPage = Math.max(1, Math.ceil(count / Math.max(1, paging.pageSize)))
  if (data && !loading && paging.page > lastPage) {
    setPaging({ page: lastPage, pageSize: paging.pageSize })
  }

  // "Поиск" is applied 500 ms after the last keystroke (demo debounce).
  useEffect(() => {
    const value = searchInput.trim()
    if (value === search) return
    const timer = window.setTimeout(() => {
      setSearch(value)
      setPaging((current) => ({ ...current, page: 1 }))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [searchInput, search])

  // Mirror the state into the URL like the demo (shareable / back-navigable links).
  useEffect(() => {
    const params = new URLSearchParams()
    if (periodApplied) {
      params.set("fromDate", period.from)
      params.set("toDate", period.to)
    }
    if (branchIds.length) params.set("branch", branchIds.join("-"))
    if (search) params.set("search", search)
    if (paging.page > 1) params.set("page", String(paging.page))
    if (paging.pageSize !== DEFAULT_PAGE_SIZE) params.set("pageSize", String(paging.pageSize))
    if (ordering.length) params.set("ordering", ordering.join(","))
    if (detail) params.set("dynamicList", detail.key)
    // Demo: openAddDialog = "Добавить" (green +), openCreateDialog = "Добавить расход" (red −).
    if (create) params.set(create.kind === "add" ? "openAddDialog" : "openCreateDialog", String(create.branchId))
    const next = params.toString()
    if (next !== window.location.search.replace(/^\?/, "")) window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`)
  }, [period, periodApplied, branchIds, search, paging, ordering, detail, create])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(""), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const openFilter = () => {
    setDraftBranchIds(branchIds)
    setFilterOpen(true)
  }

  const clearFilter = () => {
    setPeriod(monthPeriod())
    setPeriodApplied(false)
    setBranchIds([])
    setPaging((current) => ({ ...current, page: 1 }))
  }

  const exportExcel = async () => {
    setExporting(true)
    setExportError("")
    try {
      const response = await fetch(`/api/balances/branch?${buildBalanceQuery({ ...query, page: undefined, pageSize: 0, totalsIgnoreSearch: false })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(
        `${t("Баланс филиалов")} ${period.from} - ${period.to}`,
        balanceListExcelRows({
          rows: body.rows,
          groups: GROUPS,
          currencies: shownCurrencies(body),
          leading: [{ label: "Филиал", value: (row: BalanceRow) => row.name }],
          totals: body.totals,
          t,
        }),
      )
    } catch (reason) {
      setExportError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setExporting(false)
    }
  }

  const toggleDraftBranch = (id: string) => setDraftBranchIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))

  return (
    <main className="ref-white min-h-screen bg-white text-[#333]">
      <header className="flex min-h-[60px] items-center pl-[30px] pr-[28px]">
        <div className="flex items-center">
          <FavoritesButton className="flex items-center gap-[5px] text-[18px] font-bold text-[#4f71dc]" />
          <span className="mx-[11px] h-[21px] w-[2px] bg-[#5d6474]" />
          <span className="text-[18px] font-bold text-[#5d6474]">{t("Баланс филиалов")}</span>
        </div>
      </header>

      {error && (
        <div className="mx-6 mt-4 flex flex-wrap items-center gap-3 rounded-md bg-[#fdecec] px-4 py-3 text-sm text-[#c94848] md:mx-9">
          <span>
            {t("Не удалось загрузить баланс филиалов")}: {t(error)}
          </span>
          <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <div className="pt-[11px]">
        <BalanceSummaryCards compact marginClass="mx-[10px]" boxes={SUMMARY_BOXES} totals={totals} currencies={currencies} digits={3} loading={loading} />
      </div>

      <ExpandedOverlay expanded={expanded}>
        <section className="relative flex flex-wrap items-center gap-5 border-t border-[#efefef] px-[10px] pb-[8px] pt-[15px]">
          <BalanceFilterChip count={filterCount} onOpen={openFilter} onClear={clearFilter} />

          <label style={{ left: "calc(50% - 90px)" }} className="absolute w-[180px] border-b border-[#e0e0e0] pb-1.5">
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full bg-transparent pr-7 text-[13px] outline-none placeholder:text-[#9aa3b6]"
            />
            <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
          </label>


          <div className="ml-auto flex items-center gap-5">
            <BalancePagination page={paging.page} pageSize={paging.pageSize} count={count} onChange={setPaging} />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
          {exportError && <span className="basis-full text-sm text-[#e57373]">{exportError}</span>}
        </section>

        <section className="bg-white pb-10">
          <BalanceTable
          fixedWidth={100}
            digits={3}
            rows={rows}
            groups={GROUPS}
            currencies={currencies}
            first={{
              label: "Филиал",
              width: 220,
              sortKey: "name",
              render: (row) => (
                <div className="flex items-center justify-between gap-2">
                  <button type="button" onClick={() => setDetail({ key: row.key, name: row.name })} className="text-left font-medium text-[#17233b] hover:text-[#4f70e7] hover:underline">
                    {row.name}
                  </button>
                  {row.id !== null && (
                    <span className="-my-[6px] flex shrink-0 items-center pr-px">
                      <button type="button" className="flex h-9 w-9 items-center justify-center" onClick={() => setCreate({ kind: "expense", branchId: row.id! })} aria-label={t("Добавить расход")} title={t("Добавить расход")}>
                        <MinusCircle className="h-6 w-6" fill="#ff584b" color="#ffffff" />
                      </button>
                      <button type="button" className="flex h-9 w-9 items-center justify-center" onClick={() => setCreate({ kind: "add", branchId: row.id! })} aria-label={t("Добавить")} title={t("Добавить")}>
                        <PlusCircle className="h-6 w-6" fill="#8dc572" color="#ffffff" />
                      </button>
                    </span>
                  )}
                </div>
              ),
            }}
            ordering={ordering}
            onOrderingChange={setOrdering}
            loading={loading}
            emptyText="Нет данных"
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
          setPeriod(next)
          setPeriodApplied(true)
          setBranchIds(draftBranchIds)
          setPaging((current) => ({ ...current, page: 1 }))
        }}
      >
        <FilterVariant
          plain={
          <div className="flex flex-col gap-1 md:col-span-2">
            <span className="flex items-center justify-between text-sm text-[#586174]">
              {t("Филиалы")}
              {draftBranchIds.length > 0 && (
                <button type="button" onClick={() => setDraftBranchIds([])} className="flex items-center gap-1 text-[#4f70e7]">
                  <X className="h-3.5 w-3.5" /> {t("Очистить")}
                </button>
              )}
            </span>
            <div className="max-h-[240px] overflow-y-auto rounded-md border border-[#dbe0e8] p-2">
              {branchOptions.map((branch) => (
                <label key={branch.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 hover:bg-[#f2f5f8]">
                  <input type="checkbox" checked={draftBranchIds.includes(String(branch.id))} onChange={() => toggleDraftBranch(String(branch.id))} className="h-4 w-4 accent-[#4f70e7]" />
                  {branch.name}
                </label>
              ))}
              {!branchOptions.length && <p className="px-2 py-1.5 text-[#9aa3b6]">{t("Нет данных")}</p>}
            </div>
          </div>
          }
          card={
            <div className="relative">
              <FilterCardSelect
                label={t("Филиалы")}
                text={branchOptions.filter((branch) => draftBranchIds.includes(String(branch.id))).map((branch) => branch.name).join(", ")}
                onClick={() => setBranchListOpen((value) => !value)}
              />
              {branchListOpen && (
                <div className="mt-1 max-h-[200px] overflow-y-auto border border-[#e0e0e0] bg-white p-1">
                  {branchOptions.map((branch) => (
                    <label key={branch.id} className="flex cursor-pointer items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-[#f2f5f8]">
                      <input type="checkbox" checked={draftBranchIds.includes(String(branch.id))} onChange={() => toggleDraftBranch(String(branch.id))} className="h-4 w-4 accent-[#4f70e7]" />
                      {branch.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          }
        />
      </BalanceFilterDialog>

      {detail && <BranchDetailDialog entityKey={detail.key} name={detail.name} onClose={() => setDetail(null)} />}

      {create && (
        <BranchTransactionDialog
          kind={create.kind}
          branchId={create.branchId}
          branches={branchOptions}
          onClose={() => setCreate(null)}
          onSaved={() => {
            setCreate(null)
            setToast(t("Успешно сохранено"))
            reload()
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[120] flex -translate-x-1/2 items-center gap-3 rounded-md bg-[#323232] px-5 py-3 text-sm font-medium text-white shadow-lg">
          {toast}
          <button type="button" onClick={() => setToast("")} aria-label={t("Закрыть")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </main>
  )
}
