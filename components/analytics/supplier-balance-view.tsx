"use client"

import { useCallback, useEffect, useState, type MouseEvent, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { CircleMinus, CirclePlus, Filter, HandCoins, Search } from "lucide-react"

import { BalanceTable, type BalanceColumnGroup } from "@/components/analytics/balance/balance-table"
import { BalanceDownloadMenu } from "@/components/analytics/balance/download-menu"
import { balanceListExcelRows } from "@/components/analytics/balance/excel"
import { ExpandedOverlay, ExpandedViewButton } from "@/components/analytics/balance/expanded-view"
import { BalanceFilterDialog, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { BalanceSummaryCards, type SummaryBox } from "@/components/analytics/balance/summary-cards"
import { buildBalanceQuery, useBalanceList, useBalanceStatement, useFinanceCurrencies, useLookup, type BalanceQuery } from "@/components/analytics/balance/use-balance"
import { SupplierActDialog } from "@/components/analytics/supplier-balance-act"
import {
  MultiSelectField,
  Snackbar,
  SUPPLIER_PAYMENT_TYPES,
  SupplierDeleteDialog,
  SupplierRequestDialog,
  SupplierTransactionDialog,
  SupplierTransactionEditDialog,
  type SnackbarMessage,
} from "@/components/analytics/supplier-balance-dialogs"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { formatDotDate, isIsoDay, monthEndIso, monthStartIso, todayIso } from "@/lib/finance/dates"
import { MOVEMENT_LABELS, type BalanceListResult, type BalanceRow } from "@/lib/finance/types"
import { useLanguage } from "@/lib/i18n/language-context"

// "Баланс поставщиков" (demo #/statistics/providers, StatProviderList):
// filter popup (Диапазон дат / Организация / Тип оплаты) + "Скачать все",
// 4 summary boxes, toggle "Баланс поставщиков" | "Запрос средств", server-side
// search / sort / paging, the act modal (?openProvider) and the manual
// приход / расход / запрос средств dialogs. Balances come from the shared
// ledger (GET /api/balances/supplier[/statement]); manual entries are written
// through /api/supplier-balance-transactions. As in the demo, every piece of
// state lives in the URL query.

type Toggle = "balance" | "request"
type Named = { id: number; name: string }
type FilterOptions = { organizations: string[]; branches: string[] }

const TOGGLES: Array<{ id: Toggle; name: string }> = [
  { id: "balance", name: "Баланс поставщиков" },
  { id: "request", name: "Запрос средств" },
]

// supply_expense ("Расходы") is returned by the ledger but, as in the demo, not shown.
const BALANCE_GROUPS: BalanceColumnGroup[] = [
  { field: "begin_balance", label: "Баланс на начало периода" },
  { field: "supply", label: MOVEMENT_LABELS.supplier.supply },
  { field: "supply_return", label: MOVEMENT_LABELS.supplier.supply_return },
  { field: "payment", label: MOVEMENT_LABELS.supplier.payment },
  { field: "none_type_plus", label: MOVEMENT_LABELS.supplier.none_type_plus },
  { field: "none_type_minus", label: MOVEMENT_LABELS.supplier.none_type_minus },
  { field: "end_balance", label: "Баланс на конец" },
]

const REQUEST_GROUPS: BalanceColumnGroup[] = [
  { field: "end_balance", label: "Баланс на конец периода" },
  { field: "reserve", label: "Запас" },
  { field: "remain", label: "Остаток" },
  { field: "money_request", label: "Запросы в ожидании" },
]

const SUMMARY_BOXES: SummaryBox[] = [
  {
    metrics: [
      { label: "Баланс на начало периода", field: "begin_balance" },
      { label: MOVEMENT_LABELS.supplier.supply, field: "supply" },
    ],
  },
  {
    metrics: [
      { label: MOVEMENT_LABELS.supplier.supply_return, field: "supply_return" },
      { label: MOVEMENT_LABELS.supplier.payment, field: "payment" },
    ],
  },
  {
    metrics: [
      { label: MOVEMENT_LABELS.supplier.none_type_plus, field: "none_type_plus" },
      { label: MOVEMENT_LABELS.supplier.none_type_minus, field: "none_type_minus" },
    ],
  },
  { align: "right", metrics: [{ label: "Баланс на конец периода", field: "end_balance" }] },
]

const BALANCE_TYPES = ["debtor", "creditor", "debtor_for_begin", "creditor_for_begin"]

type UrlValue = string | number | string[] | null | undefined

/** URL query state (demo hashHistory.push): pushState keeps Next's useSearchParams in sync without a server round trip. */
function useUrlState() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const update = useCallback(
    (changes: Record<string, UrlValue>) => {
      const params = new URLSearchParams(window.location.search)
      for (const [name, value] of Object.entries(changes)) {
        params.delete(name)
        if (Array.isArray(value)) value.filter(Boolean).forEach((item) => params.append(name, item))
        else if (value !== null && value !== undefined && value !== "") params.set(name, String(value))
      }
      const query = params.toString()
      window.history.pushState(null, "", query ? `${pathname}?${query}` : pathname)
    },
    [pathname],
  )
  return { searchParams, update }
}

function useJsonObject<T>(url: string): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: T | null) => {
        if (!cancelled) setData(body)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [url])
  return data
}

const stop = (handler: () => void) => (event: MouseEvent) => {
  event.stopPropagation()
  handler()
}

export function SupplierBalanceView() {
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
  const toggle: Toggle = get("toggle") === "request" ? "request" : "balance"
  const search = get("search").trim()
  const paymentType = get("paymentType") === "cash" || get("paymentType") === "bank" ? (get("paymentType") as "cash" | "bank") : ""
  const balanceType = BALANCE_TYPES.includes(get("balanceType")) ? get("balanceType") : ""
  const divisions = searchParams.getAll("division").filter(Boolean)
  const branches = searchParams.getAll("branch").filter(Boolean)
  const ordering = searchParams.getAll("ordering").filter(Boolean)
  const page = Math.max(1, Math.floor(Number(get("page"))) || 1)
  const pageSize = (BALANCE_PAGE_SIZES as readonly number[]).includes(Number(get("pageSize"))) ? Number(get("pageSize")) : 25

  const openProvider = get("openProvider")
  const actFrom = isIsoDay(get("fromProviderDate")) ? get("fromProviderDate") : from
  const actTo = isIsoDay(get("toProviderDate")) ? get("toProviderDate") : to
  const dialogSupplierId = Number(get("provider")) || null
  const createMode = get("openAddDialog") === "true" ? "add" : get("openCreateDialog") === "true" ? "expense" : null
  const requestOpen = get("openRequestCreateDialog") === "true"
  const editId = Number(get("openBalanceUpdateDialog")) || null
  const deleteId = Number(get("transId")) || null

  // --- data -----------------------------------------------------------------------
  const listQuery: BalanceQuery = {
    from,
    to,
    search,
    organization: divisions,
    paymentType,
    branch: branches,
    balanceType,
    ordering,
    page,
    pageSize,
    // Demo: the summary ignores search and paging.
    totalsIgnoreSearch: true,
  }
  const list = useBalanceList("supplier", listQuery)
  const statement = useBalanceStatement("supplier", openProvider || null, { from: actFrom, to: actTo })
  const { data: currencyInfo } = useFinanceCurrencies()
  const suppliers = useLookup<Named>("/api/suppliers")
  const options = useJsonObject<FilterOptions>("/api/balances/supplier-balance/options")
  const me = useJsonObject<{ role?: string }>("/api/auth/me")
  const canEdit = me?.role === "manager" || me?.role === "admin"

  const rows = list.data?.rows ?? []
  const visible = list.data?.visibleCurrencies ?? []
  const currencies = currencyInfo?.currencies ?? list.data?.currencies ?? []
  const baseCurrency = list.data?.baseCurrency ?? currencyInfo?.base ?? "SUM"
  const groups = toggle === "balance" ? BALANCE_GROUPS : REQUEST_GROUPS

  // --- local UI state -------------------------------------------------------------
  const [expanded, setExpanded] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [draftDivisions, setDraftDivisions] = useState<string[]>([])
  const [draftPaymentType, setDraftPaymentType] = useState("")
  const [searchDraft, setSearchDraft] = useState(search)
  const [lastSearch, setLastSearch] = useState(search)
  if (search !== lastSearch) {
    // Back/forward navigation changed ?search.
    setLastSearch(search)
    setSearchDraft(search)
  }
  const [downloading, setDownloading] = useState(false)
  const [message, setMessage] = useState<SnackbarMessage | null>(null)
  const hideMessage = useCallback(() => setMessage(null), [setMessage])

  // Demo counter: set filter keys except fromDate and search.
  const filterCount = countActiveFilters({ toDate: urlTo, division: divisions, paymentType, balanceType, branch: branches, zone: get("zone") })
  const scope = [...divisions, ...branches]

  // --- actions --------------------------------------------------------------------
  const openFilter = () => {
    setDraftDivisions(divisions)
    setDraftPaymentType(paymentType)
    setFilterOpen(true)
  }
  const openAct = (row: BalanceRow) =>
    update({ openProvider: row.key, providerName: toggle === "balance" ? row.name : null, fromProviderDate: null, toProviderDate: null })
  const closeAct = () => update({ openProvider: null, providerName: null, fromProviderDate: null, toProviderDate: null })
  const closeDialogs = () => update({ openAddDialog: null, openCreateDialog: null, openRequestCreateDialog: null, provider: null })
  const refresh = () => {
    list.reload()
    statement.reload()
  }
  const saved = (changes: Record<string, UrlValue>) => {
    update(changes)
    setMessage({ text: "Успешно сохранено", tone: "success" })
    refresh()
  }

  const downloadAll = async () => {
    setDownloading(true)
    try {
      const response = await fetch(`/api/balances/supplier?${buildBalanceQuery({ ...listQuery, page: undefined, pageSize: 0, totalsIgnoreSearch: false })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (BalanceListResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const codes = visible.length ? visible : body.visibleCurrencies
      downloadExcelTable(
        `${t(toggle === "balance" ? "Баланс поставщиков" : "Запрос средств")} ${formatDotDate(from)} - ${formatDotDate(to)}`,
        balanceListExcelRows({ rows: body.rows, groups, currencies: codes, leading: [{ label: "Поставщик", value: (row) => row.name }], totals: body.totals, t }),
      )
    } catch (reason) {
      setMessage({ text: reason instanceof Error ? reason.message : String(reason), tone: "error" })
    } finally {
      setDownloading(false)
    }
  }

  // --- cells ----------------------------------------------------------------------
  const nameCell = (row: BalanceRow, actions: ReactNode) => (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-[#17233b] hover:text-[#4f70e7] hover:underline">{row.name}</span>
      {actions && <span className="flex shrink-0 items-center gap-1">{actions}</span>}
    </div>
  )
  const renderName = (row: BalanceRow) => {
    const editable = canEdit && row.id !== null
    if (toggle === "request") {
      return nameCell(
        row,
        editable && (
          <button
            type="button"
            title={t("Запрос средств")}
            aria-label={t("Запрос средств")}
            onClick={stop(() => update({ openRequestCreateDialog: "true", provider: row.id }))}
            className="text-[#8dc572] hover:brightness-90"
          >
            <HandCoins className="h-5 w-5" />
          </button>
        ),
      )
    }
    return nameCell(
      row,
      editable && (
        <>
          <button
            type="button"
            title={t("Добавить расход поставщику")}
            aria-label={t("Добавить расход поставщику")}
            onClick={stop(() => update({ openCreateDialog: "true", provider: row.id }))}
          >
            <CircleMinus className="h-6 w-6 fill-[#ff584b] text-white" />
          </button>
          <button
            type="button"
            title={t("Добавить приход поставщику")}
            aria-label={t("Добавить приход поставщику")}
            onClick={stop(() => update({ openAddDialog: "true", provider: row.id }))}
          >
            <CirclePlus className="h-6 w-6 fill-[#8dc572] text-white" />
          </button>
        </>
      ),
    )
  }

  const dialogRow = dialogSupplierId ? rows.find((row) => row.id === dialogSupplierId) : undefined
  const dialogSupplier: Named | undefined = dialogSupplierId
    ? (suppliers.find((item) => item.id === dialogSupplierId) ?? (dialogRow ? { id: dialogSupplierId, name: dialogRow.name } : undefined))
    : undefined

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] items-center border-b border-[#d8dee7] bg-[#f2f5f8] px-6 md:px-9">
        <div className="flex items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <span className="text-2xl font-bold text-[#586174]">{t("Баланс поставщиков")}</span>
        </div>
      </header>

      <section className="flex flex-wrap items-center gap-4 px-6 py-4 md:px-9">
        <button type="button" onClick={openFilter} className="flex h-11 items-center gap-2 rounded-md bg-[#4f70e7] px-5 font-semibold text-white">
          <Filter className="h-4 w-4" /> {t("Фильтр")}
          {filterCount > 0 ? ` / ${filterCount}` : ""}
        </button>
        {urlFrom && (
          <span className="font-semibold text-[#4f70e7]">
            {formatDotDate(from)} - {formatDotDate(to)}
          </span>
        )}
        <span className="text-[#4f70e7]">{scope.length ? scope.join(" ") : t("Во всей организации")}</span>
        <div className="ml-auto">
          <BalanceDownloadMenu disabled={downloading} items={[{ label: "Скачать все", onClick: downloadAll }]} />
        </div>
      </section>

      {list.error && <p className="px-6 pb-4 text-[#e57373] md:px-9">{t(list.error)}</p>}

      <BalanceSummaryCards boxes={SUMMARY_BOXES} totals={list.data?.totals ?? {}} currencies={visible} loading={list.loading} />

      <ExpandedOverlay expanded={expanded}>
        <section className="flex flex-wrap items-center gap-3 border-t border-[#e1e5eb] px-6 py-4 md:px-9">
          <div className="flex overflow-hidden rounded-sm">
            {TOGGLES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => item.id !== toggle && update({ toggle: item.id === "balance" ? null : item.id, ordering: null, page: null })}
                className={`px-5 py-2.5 text-[13px] font-bold uppercase tracking-wide ${
                  toggle === item.id ? "bg-[#4f71dc] text-white" : "border border-[#4f71dc] bg-white text-[#4f71dc]"
                }`}
              >
                {t(item.name)}
              </button>
            ))}
          </div>

          <form
            className="relative mx-auto flex min-w-[220px] items-center border-b border-[#dbe0e8] pb-1.5"
            onSubmit={(event) => {
              event.preventDefault()
              update({ search: searchDraft.trim(), page: null })
            }}
          >
            <input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={t("Поиск")}
              className="w-full bg-transparent text-center text-[15px] font-medium outline-none placeholder:text-[#17233b]"
            />
            <button type="submit" aria-label={t("Поиск")} className="text-[#9aa3b6] hover:text-[#4f70e7]">
              <Search className="h-4 w-4" />
            </button>
          </form>

          <div className="flex items-center gap-4">
            <BalancePagination
              page={page}
              pageSize={pageSize}
              count={list.data?.count ?? 0}
              onChange={(next) => update({ page: next.page > 1 ? next.page : null, pageSize: next.pageSize })}
            />
            <ExpandedViewButton expanded={expanded} onToggle={() => setExpanded((value) => !value)} />
          </div>
        </section>

        <div className="pb-10">
          <BalanceTable
            rows={rows}
            groups={groups}
            currencies={visible}
            first={{ label: "Поставщик", width: 220, sortKey: "name", render: renderName }}
            headerTone="blue"
            ordering={ordering}
            onOrderingChange={(next) => update({ ordering: next })}
            sortCycle="asc-first"
            onCellClick={(row) => openAct(row)}
            loading={list.loading}
          />
        </div>
      </ExpandedOverlay>

      <BalanceFilterDialog
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        from={from}
        to={to}
        onApply={(period) => update({ fromDate: period.from, toDate: period.to, division: draftDivisions, paymentType: draftPaymentType, page: null })}
      >
        <MultiSelectField label={t("Организация")} options={options?.organizations ?? []} value={draftDivisions} onChange={setDraftDivisions} />
        <label className="flex flex-col gap-1">
          <span className="text-sm text-[#586174]">{t("Тип оплаты")}</span>
          <select value={draftPaymentType} onChange={(event) => setDraftPaymentType(event.target.value)} className="h-10 rounded-md border border-[#dbe0e8] px-3 text-[#17233b]">
            <option value="">{t("Все")}</option>
            {SUPPLIER_PAYMENT_TYPES.map((item) => (
              <option key={item.value} value={item.value}>
                {t(item.label)}
              </option>
            ))}
          </select>
        </label>
      </BalanceFilterDialog>

      {openProvider && (
        <SupplierActDialog
          name={get("providerName")}
          statement={statement.data && statement.data.key === openProvider ? statement.data : null}
          loading={statement.loading}
          error={statement.error}
          from={actFrom}
          to={actTo}
          customPeriod={Boolean(get("fromProviderDate") || get("toProviderDate"))}
          canEdit={canEdit}
          onPeriodChange={(period) => update({ fromProviderDate: period.from, toProviderDate: period.to })}
          onPeriodReset={() => update({ fromProviderDate: null, toProviderDate: null })}
          onEdit={(row) => update({ openBalanceUpdateDialog: row.sourceId })}
          onDelete={(row) => update({ transId: row.sourceId })}
          onClose={closeAct}
        />
      )}

      {createMode && dialogSupplier && (
        <SupplierTransactionDialog
          key={`${createMode}-${dialogSupplier.id}`}
          mode={createMode}
          supplier={dialogSupplier}
          currencies={currencies}
          baseCurrency={baseCurrency}
          organizations={options?.organizations ?? []}
          branches={options?.branches ?? []}
          onClose={closeDialogs}
          onSaved={() => saved({ openAddDialog: null, openCreateDialog: null, provider: null })}
        />
      )}

      {requestOpen && (
        <SupplierRequestDialog
          key={dialogSupplierId ?? "new"}
          supplierId={dialogSupplierId}
          suppliers={suppliers}
          currencies={currencies}
          baseCurrency={baseCurrency}
          onClose={closeDialogs}
          onSaved={() => saved({ openRequestCreateDialog: null, provider: null })}
        />
      )}

      {editId && (
        <SupplierTransactionEditDialog
          key={editId}
          id={editId}
          currencies={currencies}
          organizations={options?.organizations ?? []}
          onClose={() => update({ openBalanceUpdateDialog: null })}
          onSaved={() => saved({ openBalanceUpdateDialog: null })}
        />
      )}

      {deleteId && (
        <SupplierDeleteDialog
          id={deleteId}
          onClose={() => update({ transId: null })}
          onDeleted={() => {
            update({ transId: null })
            setMessage({ text: "Успешно удалено", tone: "success" })
            refresh()
          }}
          onFailed={(error) => {
            update({ transId: null })
            setMessage({ text: error && !error.startsWith("HTTP ") ? error : "Удаление невозможно из-за связи с другими данными", tone: "error" })
          }}
        />
      )}

      <Snackbar message={message} onClose={hideMessage} />
    </main>
  )
}
