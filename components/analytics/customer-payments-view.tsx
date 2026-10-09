"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Banknote,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  CreditCard,
  Download,
  Info,
  Pencil,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Square,
  Trash2,
  Wallet,
  X,
  XCircle,
} from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, cashMutate, useCashJson } from "@/components/analytics/cash/use-cash"
import { AcceptCashboxDialog, BulkUpdateDialog, ConfirmDialog, EditPaymentDialog } from "@/components/analytics/customer-payments-dialogs"
import {
  countCustomerPaymentFilters,
  CustomerPaymentsFilterPanel,
  customerPaymentsListQuery,
  customerPaymentsTotalsQuery,
  emptyCustomerPaymentFilters,
  formatRuDate,
  stateFromParams,
  stateToSearch,
  type CustomerPaymentsFilters,
  type CustomerPaymentsState,
} from "@/components/analytics/customer-payments-filters"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import { CLIENT_CONFIRMATION_ICON_LABELS, type CustomerPaymentOptions, type CustomerPaymentRow, type CustomerPaymentsResult, type CustomerPaymentTab, type CustomerPaymentTotalsResult } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// "Оплаты от клиентов" (demo #/client-transaction?showCheckboxes=true, chunk 75
// module 4130): live customer payments with server paging / sorting / search,
// 18 filters kept in the URL, tabs (Не принятые / Принятые / Все), totals per
// currency (green with the selected sum), bulk "Принять на кассу" (cash core
// POST /api/cash/accept-cash), bulk invoice date, edit, soft delete, resend
// of the confirmation request and Excel exports.

const LIST_URL = "/api/cash/customer-payments"
const TABLE_KEY = "clientTransactionTable"

const TABS: Array<{ tab: CustomerPaymentTab; label: string }> = [
  { tab: "not_accepted", label: "Не принятые" },
  { tab: "accepted", label: "Принятые" },
  { tab: "all", label: "Все" },
]

type ColumnId = "id" | "client" | "user" | "created_date" | "accepted_time" | "responsible_agent" | "division" | "amount" | "real_amount" | "cashbox" | "comment"

const COLUMNS: Array<{ id: ColumnId; label: string; sortable: boolean; align?: "right" }> = [
  { id: "id", label: "№", sortable: true },
  { id: "client", label: "Клиент", sortable: true },
  { id: "user", label: "Создал", sortable: true },
  { id: "created_date", label: "Дата оплаты", sortable: true },
  { id: "accepted_time", label: "Дата приемки", sortable: true },
  { id: "responsible_agent", label: "Ответственный агент", sortable: false },
  { id: "division", label: "Организация", sortable: true },
  { id: "amount", label: "Сумма", sortable: true },
  { id: "real_amount", label: "Сумма в кассе", sortable: false },
  { id: "cashbox", label: "Касса", sortable: true },
  { id: "comment", label: "Комментарий", sortable: false, align: "right" },
]

const money = (value: number, currency: string) => `${formatMoney(value, 3)} ${currencyLabel(currency)}`
const dateTime = (iso: string, language: string) => (iso ? formatRuDate(iso, true, language) : "")

function amountColor(value: number): string | undefined {
  if (value > 0) return "#3aa76d"
  if (value < 0) return "#e5484d"
  return undefined
}

/** Σ per currency of the given rows ("150 000 SUM , 20 USD"). */
function sumByCurrency(rows: CustomerPaymentRow[]): Array<{ currency: string; total: number }> {
  const map = new Map<string, number>()
  for (const row of rows) map.set(row.currency, (map.get(row.currency) ?? 0) + row.amount)
  return [...map.entries()].map(([currency, total]) => ({ currency, total }))
}

function Tip({ text, children }: { text: string; children: ReactNode }) {
  return (
    <span title={text} className="inline-flex items-center">
      {children}
    </span>
  )
}

function PaymentTypeIcon({ type }: { type: "cash" | "bank" }) {
  const { t } = useLanguage()
  return type === "bank" ? (
    <Tip text={t("банковский счет")}>
      <CreditCard className="h-4 w-4 text-[#8e5ad8]" />
    </Tip>
  ) : (
    <Tip text={t("наличные")}>
      <Banknote className="h-4 w-4 text-[#4f70e7]" />
    </Tip>
  )
}

function ConfirmationIcon({ status }: { status: CustomerPaymentRow["clientConfirmation"] }) {
  const { t } = useLanguage()
  if (!status) return null
  const label = t(CLIENT_CONFIRMATION_ICON_LABELS[status])
  const icon =
    status === "confirmed" ? (
      <Check className="h-4 w-4 text-[#3aa76d]" />
    ) : status === "rejected" ? (
      <XCircle className="h-4 w-4 text-[#e5484d]" />
    ) : status === "requested" ? (
      <Clock className="h-4 w-4 text-[#f0a030]" />
    ) : (
      <CheckCheck className="h-4 w-4 text-[#4f70e7]" />
    )
  return (
    <span title={label} aria-label={label} className="inline-flex">
      {icon}
    </span>
  )
}

function useRole(): boolean {
  const [canWrite, setCanWrite] = useState(false)
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((user: { role?: string } | null) => setCanWrite(user?.role === "manager" || user?.role === "admin"))
      .catch(() => setCanWrite(false))
  }, [])
  return canWrite
}

function ColumnSettings({ hidden, onChange }: { hidden: ColumnId[]; onChange: (next: ColumnId[]) => void }) {
  const { t } = useLanguage()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} title={t("Настройки таблицы")} aria-label={t("Настройки таблицы")} className="p-1 text-[#586174] hover:text-[#4f70e7]">
        <Settings2 className="h-5 w-5" />
      </button>
      {open && (
        <div className="absolute right-0 z-[60] mt-1 w-64 rounded-md border border-[#e1e5eb] bg-white py-2 shadow-lg">
          {COLUMNS.map((column) => (
            <label key={column.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[#17233b] hover:bg-[#f2f5f8]">
              <input
                type="checkbox"
                checked={!hidden.includes(column.id)}
                onChange={() => onChange(hidden.includes(column.id) ? hidden.filter((id) => id !== column.id) : [...hidden, column.id])}
                className="h-4 w-4 accent-[#4f70e7]"
              />
              {t(column.label)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}

function IconButton({ label, onClick, disabled = false, children, className = "" }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`p-1 text-[#586174] hover:text-[#4f70e7] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
      {children}
    </button>
  )
}

type Pending = { kind: "delete" | "resend"; row: CustomerPaymentRow } | null

export function CustomerPaymentsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<CustomerPaymentsState>(() => stateFromParams(searchParams))
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<CustomerPaymentsFilters>(state.filters)
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [hidden, setHidden] = useState<ColumnId[]>([])
  const [selectedCache, setSelectedCache] = useState<Record<number, CustomerPaymentRow>>({})
  const [dialog, setDialog] = useState<"accept" | "bulk" | null>(null)
  const [editing, setEditing] = useState<CustomerPaymentRow | null>(null)
  const [pending, setPending] = useState<Pending>(null)
  const [pendingBusy, setPendingBusy] = useState(false)
  const [pendingError, setPendingError] = useState("")
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)
  const [exporting, setExporting] = useState(false)
  const canWrite = useRole()

  const listUrl = `${LIST_URL}?${buildCashQuery(customerPaymentsListQuery(state))}`
  const totalsUrl = `${LIST_URL}/total?${buildCashQuery(customerPaymentsTotalsQuery(state))}`
  const list = useCashJson<CustomerPaymentsResult>(listUrl)
  const totals = useCashJson<CustomerPaymentTotalsResult>(totalsUrl)
  const optionsState = useCashJson<CustomerPaymentOptions>(`${LIST_URL}/options`)
  const options = optionsState.data
  const rows = useMemo(() => list.data?.rows ?? [], [list.data])
  const baseCurrency = list.data?.baseCurrency ?? options?.baseCurrency ?? "SUM"

  // URL ⇄ state (demo keeps everything in the query).
  useEffect(() => {
    const search = stateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(TABLE_KEY) ?? "[]") as unknown
      if (Array.isArray(saved)) setHidden(saved.filter((id): id is ColumnId => COLUMNS.some((column) => column.id === id)))
    } catch {
      setHidden([])
    }
  }, [])
  const changeHidden = (next: ColumnId[]) => {
    setHidden(next)
    try {
      window.localStorage.setItem(TABLE_KEY, JSON.stringify(next))
    } catch {
      // storage unavailable: keep the in-memory choice
    }
  }

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  // Search: applied 400 ms after typing stops.
  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  // A page past the end (rows removed, stale URL) jumps to the last page.
  useEffect(() => {
    const data = list.data
    if (!data || list.loading || data.rows.length || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [list.data, list.loading, state.page, state.pageSize])

  const update = (patch: Partial<CustomerPaymentsState>) => setState((current) => ({ ...current, ...patch }))
  const reloadAll = () => {
    list.reload()
    totals.reload()
  }
  const say = (text: string, error = false) => setNotice({ text: t(text), error })

  const selected = useMemo(() => new Set(state.select), [state.select])
  const selectedRows = useMemo(
    () => state.select.map((id) => rows.find((row) => row.id === id) ?? selectedCache[id]).filter((row): row is CustomerPaymentRow => Boolean(row)),
    [rows, selectedCache, state.select],
  )
  const setSelection = (ids: number[], seen: CustomerPaymentRow[] = []) => {
    if (seen.length) setSelectedCache((current) => ({ ...current, ...Object.fromEntries(seen.map((row) => [row.id, row])) }))
    update({ select: ids })
  }
  const toggleRow = (row: CustomerPaymentRow) =>
    setSelection(selected.has(row.id) ? state.select.filter((id) => id !== row.id) : [...state.select, row.id], [row])
  const pageIds = rows.map((row) => row.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggleAll = () =>
    allOnPage ? setSelection(state.select.filter((id) => !pageIds.includes(id))) : setSelection([...new Set([...state.select, ...pageIds])], rows)

  const applyFilters = () => {
    update({ filters: draft, page: 1 })
    setFilterOpen(false)
  }
  const clearFilters = () => {
    const empty = emptyCustomerPaymentFilters()
    setDraft(empty)
    setSearchDraft("")
    update({ filters: empty, search: "", tab: "all", page: 1 })
  }

  const sort = (id: ColumnId) => update({ ordering: nextOrdering(state.ordering ? [state.ordering] : [], id, "asc-first")[0] ?? "", page: 1 })

  // --- excel --------------------------------------------------------------------------
  const sheet = (data: CustomerPaymentRow[]) => [
    ["№", "Клиент", "Создал", "Дата оплаты", "Дата приемки", "Ответственный агент", "Организация", "Сумма", "Валюта", "Сумма в кассе", "Валюта", "Касса", "Комментарий", "ИНН", "Тип оплаты"].map((label) =>
      label === "№" ? label : t(label),
    ),
    ...data.map((row) => [
      row.id,
      row.client.name,
      row.createdBy || t("Неизвестно"),
      dateTime(row.date, language),
      row.acceptedAt ? dateTime(row.acceptedAt, language) : "-",
      row.responsibleAgent,
      row.organization,
      row.amount,
      currencyLabel(row.currency),
      row.realAmount,
      currencyLabel(row.realCurrency),
      row.accepted && row.cashbox ? row.cashbox.name : t("Не принято"),
      row.comment || t("Не указано"),
      row.client.inn,
      t(row.paymentType === "bank" ? "банковский счет" : "наличные"),
    ]),
  ]
  const exportPage = () => downloadExcelTable(t("Оплаты от клиентов"), sheet(rows))
  const exportAll = async () => {
    setExporting(true)
    try {
      const response = await fetch(`${LIST_URL}?${buildCashQuery({ ...customerPaymentsListQuery(state), page: undefined, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (CustomerPaymentsResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      downloadExcelTable(t("Оплаты от клиентов"), sheet(body.rows))
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? t(reason.message) : t("Сервер недоступен, попробуйте ещё раз"), error: true })
    } finally {
      setExporting(false)
    }
  }

  // --- row actions ----------------------------------------------------------------------
  const runPending = async () => {
    if (!pending) return
    setPendingBusy(true)
    setPendingError("")
    const result =
      pending.kind === "delete"
        ? await cashMutate("DELETE", `${LIST_URL}/${pending.row.id}`)
        : await cashMutate("POST", `${LIST_URL}/${pending.row.id}/resend`)
    setPendingBusy(false)
    if (!result.ok) {
      if (pending.kind === "resend") say("Ошибка при отправке запроса", true)
      setPendingError(result.error)
      return
    }
    if (pending.kind === "delete") {
      setSelection(state.select.filter((id) => id !== pending.row.id))
      reloadAll()
      say("Транзакция успешно удалена")
    } else {
      list.reload()
      say("Транзакция переотправлена")
    }
    setPending(null)
  }
  const openPending = (kind: "delete" | "resend", row: CustomerPaymentRow) => {
    setPendingError("")
    setPending({ kind, row })
  }

  // --- summary bar ----------------------------------------------------------------------
  const selectedSums = sumByCurrency(selectedRows)
  const hasSelection = state.select.length > 0
  const summary = hasSelection
    ? selectedSums.map((item) => money(item.total, item.currency)).join(" , ")
    : (totals.data?.totals ?? []).map((item) => money(item.total, item.currency)).join(" , ")

  const visibleColumns = COLUMNS.filter((column) => !hidden.includes(column.id))
  const columnCount = visibleColumns.length + (state.showCheckboxes ? 1 : 0) + 1
  const filterCount = countCustomerPaymentFilters(state.filters)

  const cell = (row: CustomerPaymentRow, id: ColumnId): ReactNode => {
    switch (id) {
      case "id":
        return row.id
      case "client":
        return (
          <>
            <div className="min-w-[140px]">{row.client.name}</div>
            {row.client.inn && <div className="text-[13px] font-medium text-[#4f70e7]">{row.client.inn}</div>}
          </>
        )
      case "user":
        return row.createdBy || t("Неизвестно")
      case "created_date":
        return <span className="whitespace-nowrap">{dateTime(row.date, language)}</span>
      case "accepted_time":
        return (
          <>
            <div className="whitespace-nowrap">{row.acceptedAt ? dateTime(row.acceptedAt, language) : "-"}</div>
            {row.invoiceDate && (
              <div title={t("Дата счет фактура")} className="whitespace-nowrap text-[13px] text-[#4f70e7]">
                {formatRuDate(row.invoiceDate, false, language)}
              </div>
            )}
          </>
        )
      case "responsible_agent":
        return row.responsibleAgent
      case "division":
        return row.organization
      case "amount":
        return (
          <>
            <div className="flex items-center gap-1.5 whitespace-nowrap font-semibold" style={{ color: amountColor(row.amount) }}>
              {money(row.amount, row.currency)}
              <PaymentTypeIcon type={row.paymentType} />
              {row.currency !== baseCurrency && (
                <Tip text={`${t("Курс")}: ${row.debtRate ? formatMoney(row.debtRate, 5) : "—"}`}>
                  <Info className="h-3.5 w-3.5 text-[#9aa3b6]" />
                </Tip>
              )}
            </div>
            {row.currency !== baseCurrency && row.baseAmount !== null && (
              <div className="whitespace-nowrap text-[11px] text-[#9aa3b6]">{money(row.baseAmount, baseCurrency)}</div>
            )}
          </>
        )
      case "real_amount":
        return (
          <>
            <div className="flex items-center gap-1.5 whitespace-nowrap">
              {money(row.realAmount, row.realCurrency)}
              {row.realCurrency !== baseCurrency && (
                <Tip text={`${t("Курс")}: ${row.cashRate ? formatMoney(row.cashRate, 5) : "—"}`}>
                  <Info className="h-3.5 w-3.5 text-[#9aa3b6]" />
                </Tip>
              )}
            </div>
            {row.realCurrency !== baseCurrency && row.cashRate && (
              <div className="whitespace-nowrap text-[11px] text-[#9aa3b6]">{money(row.realAmount * row.cashRate, baseCurrency)}</div>
            )}
          </>
        )
      case "cashbox":
        return (
          <>
            {row.accepted && row.cashbox ? (
              row.cashDocNo ? (
                <a
                  href={`/analytics/cash-management?search=${row.cashDocNo}`}
                  target="_blank"
                  rel="noreferrer"
                  className="whitespace-nowrap font-medium text-[#4f70e7] hover:underline"
                >
                  {row.cashbox.name}
                </a>
              ) : (
                <span className="whitespace-nowrap">{row.cashbox.name}</span>
              )
            ) : (
              <span className="whitespace-nowrap">{t("Не принято")}</span>
            )}
            {!row.accepted && row.cashbox && <div className="whitespace-nowrap text-[11px] text-[#9aa3b6]">{row.cashbox.name}</div>}
            {row.agentCashbox && (
              <div title={t("Касса агента")} className="whitespace-nowrap text-[11px] text-[#9aa3b6]">
                {row.agentCashbox.name}
              </div>
            )}
          </>
        )
      case "comment":
        return row.comment || t("Не указано")
    }
  }

  const actions = (row: CustomerPaymentRow) => {
    const warn = t("Изменить транзакцию, деньги уже приняты в кассу. При изменении изменится баланс кассы тоже.")
    const canResend = row.clientConfirmation === "" || row.clientConfirmation === "requested" || row.clientConfirmation === "rejected"
    return (
      <div className="flex items-center justify-end gap-2">
        <ConfirmationIcon status={row.clientConfirmation} />
        {canResend && (
          <IconButton label={t("Переотправить запрос")} disabled={!canWrite} onClick={() => openPending("resend", row)}>
            <Send className="h-4 w-4" />
          </IconButton>
        )}
        {row.acceptance ? (
          canWrite ? (
            <a href={`/analytics/cash-management?search=${row.acceptance.docNo}`} target="_blank" rel="noreferrer" title={warn} aria-label={warn} className="p-1 text-[#e5484d]">
              <Pencil className="h-4 w-4" />
            </a>
          ) : (
            <IconButton label={warn} disabled onClick={() => undefined} className="text-[#e5484d]">
              <Pencil className="h-4 w-4" />
            </IconButton>
          )
        ) : (
          <IconButton
            label={row.accepted ? warn : t("Изменить")}
            disabled={!canWrite}
            onClick={() => setEditing(row)}
            className={row.accepted ? "text-[#e5484d] hover:text-[#c53238]" : ""}
          >
            <Pencil className="h-4 w-4" />
          </IconButton>
        )}
        <IconButton label={t("Удалить транзакцию")} disabled={!canWrite} onClick={() => openPending("delete", row)} className="text-[#e5484d] hover:text-[#c53238]">
          <Trash2 className="h-4 w-4" />
        </IconButton>
      </div>
    )
  }

  const sortIcon = (id: ColumnId) =>
    state.ordering === id ? <ArrowUp className="h-3.5 w-3.5" /> : state.ordering === `-${id}` ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Оплаты от клиентов")}</h1>
        </div>
        <button
          type="button"
          onClick={() => void exportAll()}
          disabled={exporting || !list.data}
          className="flex h-11 items-center gap-2 rounded-md bg-[#4caf72] px-5 font-semibold text-white disabled:opacity-60"
        >
          <Download className="h-5 w-5" /> {exporting ? t("Загрузка...") : t("Скачать Excel")}
        </button>
      </header>

      <div
        className={`relative px-4 py-3 text-[13px] font-bold text-white md:px-9 ${hasSelection ? "bg-[#09890f]" : "bg-[#5869f0]"}`}
        aria-live="polite"
      >
        {t("Оплаты от клиентов")}: {summary || "0"}
        {totals.loading && !hasSelection && <RefreshCw className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
      </div>

      <nav className="grid grid-cols-3 bg-white text-center">
        {TABS.map((item) => (
          <button
            key={item.tab}
            type="button"
            onClick={() => update({ tab: item.tab, page: 1 })}
            className={`border-b-2 px-1 py-3 text-[14px] font-medium md:text-[16px] ${state.tab === item.tab ? "border-[#4f5fd9] text-[#17233b]" : "border-transparent text-[#586174]"}`}
          >
            {t(item.label)}
          </button>
        ))}
      </nav>

      <section className="flex flex-wrap items-center gap-3 border-y border-[#e1e5eb] bg-white px-4 py-3 md:px-9">
        <BalanceFilterChip
          count={filterCount}
          onOpen={() => {
            setDraft(state.filters)
            setFilterOpen((value) => !value)
          }}
          onClear={clearFilters}
        />
        <label className="relative min-w-[160px] flex-1 border-b border-[#dbe0e8] pb-1.5 md:max-w-[320px]">
          <input
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={t("Поиск")}
            aria-label={t("Поиск")}
            className="w-full bg-transparent pr-7 text-[15px] outline-none placeholder:text-[#9aa3b6]"
          />
          <Search className="pointer-events-none absolute right-0 top-0.5 h-5 w-5 text-[#9aa3b6]" />
        </label>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {hasSelection && (
            <span className="flex items-center gap-2 font-semibold text-[#17233b]">
              {t("Выбрано")}: {state.select.length}
              <IconButton label={t("Снять выделение")} onClick={() => setSelection([])}>
                <X className="h-4 w-4" />
              </IconButton>
            </span>
          )}
          <BalancePagination page={state.page} pageSize={state.pageSize} count={list.data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
          <IconButton
            label={t(state.showCheckboxes ? "Спрятать флажки" : "Выбрать из списка")}
            onClick={() => update({ showCheckboxes: !state.showCheckboxes, select: [] })}
          >
            {state.showCheckboxes ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
          </IconButton>
          <IconButton label={t("Скачать")} onClick={exportPage} disabled={!rows.length}>
            <Download className="h-5 w-5" />
          </IconButton>
          <ColumnSettings hidden={hidden} onChange={changeHidden} />
          <IconButton label={t("Обновить список")} onClick={reloadAll}>
            <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
          </IconButton>
          <IconButton
            label={hasSelection ? t("Изменить выбранные оплаты") : t("Выберите хотя бы одного")}
            disabled={!hasSelection || !canWrite}
            onClick={() => setDialog("bulk")}
          >
            <Pencil className="h-5 w-5" />
          </IconButton>
          <button
            type="button"
            disabled={!hasSelection || !canWrite}
            title={hasSelection ? undefined : t("Выберите хотя бы одного")}
            onClick={() => setDialog("accept")}
            className="flex h-10 items-center gap-2 rounded-md bg-[#4f71dc] px-4 font-semibold text-white disabled:opacity-50"
          >
            <Wallet className="h-5 w-5" /> {t("Принять на кассу")}
          </button>
        </div>
      </section>

      {filterOpen && <CustomerPaymentsFilterPanel draft={draft} onChange={setDraft} options={options} onApply={applyFilters} />}

      {list.error && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[#e57373] md:px-9">
          <span>
            {t("Не удалось загрузить данные")}: {t(list.error)}
          </span>
          <button type="button" onClick={reloadAll} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <section className={`overflow-x-auto pb-10 ${list.loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[1200px] border-collapse text-[14px]">
          <thead>
            <tr className="bg-[#edf2f7] text-[#253653]">
              {state.showCheckboxes && (
                <th className="w-10 border-b border-[#e1e5eb] px-2 py-3">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-4 w-4 accent-[#4f70e7]" />
                </th>
              )}
              {visibleColumns.map((column) => (
                <th key={column.id} className={`border-b border-[#e1e5eb] px-3 py-3 font-semibold whitespace-nowrap ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.sortable ? (
                    <button type="button" onClick={() => sort(column.id)} className="inline-flex items-center gap-1">
                      {column.id === "id" ? column.label : t(column.label)}
                      {sortIcon(column.id)}
                    </button>
                  ) : (
                    t(column.label)
                  )}
                </th>
              ))}
              <th className="sticky right-0 border-b border-[#e1e5eb] bg-[#edf2f7] px-2 py-3" aria-label={t("Действия")} />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const background = selected.has(row.id) ? "#eaf0fd" : index % 2 ? "#F4F8FB" : "#ffffff"
              return (
                <tr key={row.id} className="group border-b border-dashed border-[#e1e5eb]" style={{ background }}>
                  {state.showCheckboxes && (
                    <td className="px-2 py-3 text-center align-top">
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleRow(row)}
                        aria-label={`№ ${row.id}`}
                        className="h-4 w-4 accent-[#4f70e7]"
                      />
                    </td>
                  )}
                  {visibleColumns.map((column) => (
                    <td key={column.id} className={`px-3 py-3 align-top ${column.align === "right" ? "text-right" : ""}`}>
                      {cell(row, column.id)}
                    </td>
                  ))}
                  <td className="sticky right-0 px-2 py-3 align-top transition-opacity md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100" style={{ background }}>
                    {actions(row)}
                  </td>
                </tr>
              )
            })}
            {!rows.length && (
              <tr>
                <td colSpan={columnCount} className="px-4 py-16 text-center text-[#9aa3b6]">
                  {list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {dialog === "accept" && (
        <AcceptCashboxDialog
          ids={state.select}
          cashboxes={options?.cashboxes ?? []}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            setSelection([])
            reloadAll()
            optionsState.reload()
            say("Успешно сохранено")
          }}
        />
      )}
      {dialog === "bulk" && (
        <BulkUpdateDialog
          ids={state.select}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            reloadAll()
            say("Успешно сохранено")
          }}
        />
      )}
      {editing && (
        <EditPaymentDialog
          key={editing.id}
          row={editing}
          options={options}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null)
            reloadAll()
            say("Успешно сохранено")
          }}
        />
      )}
      {pending && (
        <ConfirmDialog
          title={pending.kind === "delete" ? "Подтверждение удаления" : "Подтверждение запроса"}
          question={pending.kind === "delete" ? "Вы уверены что хотите удалить эти данные?" : undefined}
          message={`${t("Транзакция")} №${pending.row.id}`}
          confirmLabel={pending.kind === "delete" ? "Удалить" : "Выполнить"}
          danger={pending.kind === "delete"}
          busy={pendingBusy}
          error={pendingError}
          onConfirm={() => void runPending()}
          onClose={() => setPending(null)}
        />
      )}

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
