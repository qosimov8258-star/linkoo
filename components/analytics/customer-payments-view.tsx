"use client"

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  Banknote,
  Check,
  CheckCheck,
  CheckSquare,
  Clock,
  CreditCard,
  Download,
  Info,
  RefreshCw,
  Search,
  Square,
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
import { RI, RefButton, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefTabs, RefToolbar } from "@/components/ref/list-kit"
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
      <button type="button" onClick={() => setOpen((value) => !value)} title={t("Вкл/Выкл колонки")} aria-label={t("Вкл/Выкл колонки")} className="flex h-12 w-12 items-center justify-center">
        <svg viewBox="0 0 24 24" className="h-6 w-6 fill-[#333]" aria-hidden>
          <path d="M7 15v2h10v-2H7zm-4 6h18v-2H3v2zm0-8h18v-2H3v2zm4-6v2h10V7H7zM3 3v2h18V3H3z" />
        </svg>
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

const MATERIAL_PATHS = {
  reply: "M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z",
  edit: "M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
} as const

function MaterialIcon({ name }: { name: keyof typeof MATERIAL_PATHS }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-current" aria-hidden>
      <path d={MATERIAL_PATHS[name]} />
    </svg>
  )
}

function IconButton({ label, onClick, disabled = false, children, className = "" }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; className?: string }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`p-0.5 text-[#5d6474] hover:text-[#4f70e7] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}>
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
            <MaterialIcon name="reply" />
          </IconButton>
        )}
        {row.acceptance ? (
          canWrite ? (
            <a href={`/analytics/cash-management?search=${row.acceptance.docNo}`} target="_blank" rel="noreferrer" title={warn} aria-label={warn} className="p-1 text-[#e5484d]">
              <MaterialIcon name="edit" />
            </a>
          ) : (
            <IconButton label={warn} disabled onClick={() => undefined} className="text-[#e5484d]">
              <MaterialIcon name="edit" />
            </IconButton>
          )
        ) : (
          <IconButton
            label={row.accepted ? warn : t("Изменить")}
            disabled={!canWrite}
            onClick={() => setEditing(row)}
            className={row.accepted ? "text-[#e5484d] hover:text-[#c53238]" : ""}
          >
            <MaterialIcon name="edit" />
          </IconButton>
        )}
        <IconButton label={t("Удалить транзакцию")} disabled={!canWrite} onClick={() => openPending("delete", row)} className="!text-[#e57373] hover:!text-[#e5484d]">
          <MaterialIcon name="trash" />
        </IconButton>
      </div>
    )
  }

  const sortIcon = (id: ColumnId) =>
    state.ordering === id ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${id}` ? <span className="ml-1 text-[10px]">▼</span> : null

  const WEIGHTS: Record<ColumnId, number> = { id: 42, client: 166, user: 138, created_date: 138, accepted_time: 139, responsible_agent: 138, division: 139, amount: 138, real_amount: 138, cashbox: 69, comment: 139 }
  const pageCount = Math.max(1, Math.ceil((list.data?.count ?? 0) / state.pageSize))
  const heads = [
    ...(state.showCheckboxes ? [<input key="all" type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-4 w-4 accent-[#4f71dc]" />] : []),
    ...visibleColumns.map((column) => {
      const label = (
        <span className={column.align === "right" ? "-mr-[22px] block text-right" : undefined}>
          {column.id === "id" ? column.label : t(column.label)}
          {sortIcon(column.id)}
        </span>
      )
      return column.sortable ? (
        <button key={column.id} type="button" onClick={() => sort(column.id)} className="block w-full text-left font-semibold hover:opacity-80">
          {label}
        </button>
      ) : (
        <span key={column.id}>{label}</span>
      )
    }),
  ]

  return (
    <RefPage>
      <RefHeader title={t("Оплаты от клиентов")}>
        <RefButton green icon={RI.download} label={exporting ? t("Загрузка...") : t("Скачать Excel")} onClick={() => void exportAll()} disabled={exporting || !list.data} />
      </RefHeader>

      <div className={`relative px-[5px] py-[5px] text-[13px] font-semibold leading-4 text-white ${hasSelection ? "bg-[#09890f]" : "bg-[#5869f0]"}`} aria-live="polite">
        {t("Оплаты от клиентов")}: {summary || "0"}
        {totals.loading && !hasSelection && <RefreshCw className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
      </div>

      <RefCard>
        <div className="bg-white pb-[2px]"><RefTabs labels={TABS.map((item) => item.label)} value={TABS.find((item) => item.tab === state.tab)?.label ?? TABS[0].label} onChange={(label) => update({ tab: TABS.find((item) => item.label === label)?.tab ?? "all", page: 1 })} /></div>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => {
            setDraft(state.filters)
            setFilterOpen((value) => !value)
          }}
          filterPanel={<CustomerPaymentsFilterPanel draft={draft} onChange={setDraft} options={options} onApply={applyFilters} onClose={() => setFilterOpen(false)} />}
          query={searchDraft}
          onQuery={setSearchDraft}
          pageSize={state.pageSize}
          onPageSize={(size) => update({ page: 1, pageSize: size })}
          from={list.data?.count ? (state.page - 1) * state.pageSize + 1 : 0}
          to={Math.min(state.page * state.pageSize, list.data?.count ?? 0)}
          total={list.data?.count ?? 0}
          page={state.page}
          pageCount={pageCount}
          onPage={(page) => update({ page })}
          icons={
            <>
              {hasSelection && (
                <span className="mr-2 flex items-center gap-1 whitespace-nowrap font-semibold text-[#333]">
                  {t("Выбрано")}: {state.select.length}
                  <IconButton label={t("Снять выделение")} onClick={() => setSelection([])}>
                    <X className="h-4 w-4" />
                  </IconButton>
                </span>
              )}
              <RefIconButton path={state.showCheckboxes ? RI.eyeOff : RI.checklist} label={t(state.showCheckboxes ? "Спрятать флажки" : "Выбрать из списка")} onClick={() => update({ showCheckboxes: !state.showCheckboxes, select: [] })} color="#5d6474" />
              <RefIconButton path={RI.download} label={t("Скачать Excel")} onClick={() => rows.length && exportPage()} color="#333" />
              <ColumnSettings hidden={hidden} onChange={changeHidden} />
              <RefIconButton path={RI.sync} label={t("Обновить список")} onClick={reloadAll} color="#5d6474" />
              <RefIconButton path={RI.edit} label={hasSelection ? t("Изменить выбранные оплаты") : t("Выберите хотя бы одного")} onClick={() => hasSelection && canWrite && setDialog("bulk")} color={hasSelection ? "#333" : "#bdbdbd"} />
            </>
          }
          extra={<span className="mr-2 flex"><RefButton icon={RI.card} label={t("Принять на кассу")} onClick={() => hasSelection && canWrite && setDialog("accept")} disabled={!hasSelection || !canWrite} /></span>}
        />

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 bg-white px-5 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={reloadAll} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <RefTable
          cols={`${state.showCheckboxes ? "40px " : ""}${visibleColumns.map((column) => `minmax(0,${WEIGHTS[column.id]}fr)`).join(" ")}`}
          heads={heads}
          rows={rows}
          headPad={30}
          rowKey={(row) => row.id}
          rowClass={(row) => (selected.has(row.id) ? "!bg-[#eaf0fd]" : "")}
          empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
          render={(row) => [
            ...(state.showCheckboxes ? [<input key="check" type="checkbox" checked={selected.has(row.id)} onChange={() => toggleRow(row)} aria-label={`№ ${row.id}`} className="h-4 w-4 accent-[#4f71dc]" />] : []),
            ...visibleColumns.map((column) =>
              column.id === "comment" ? (
                <div key={column.id} className="relative text-right">
                  {cell(row, column.id)}
                  <div className="absolute inset-y-0 right-0 flex items-center bg-[#f2f5f8] opacity-0 group-hover:opacity-100 focus-within:opacity-100">{actions(row)}</div>
                </div>
              ) : (
                cell(row, column.id)
              ),
            ),
          ]}
        />
      </RefCard>

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
          title={pending.kind === "delete" ? "Подтверждение удаления" : "Выполнить"}
          question={pending.kind === "delete" ? "Вы уверены что хотите удалить эти данные?" : "Подтверждение запроса"}
          message={`${t("Транзакция")} №${pending.row.id}`}
          confirmLabel={pending.kind === "delete" ? "Удалить" : "Да"}
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
    </RefPage>
  )
}
