"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, Clock, FileSpreadsheet, Info, Landmark, Loader2, Search } from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { BalanceFilterChip, countActiveFilters } from "@/components/analytics/balance/filter-bar"
import { BALANCE_PAGE_SIZES, BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import {
  ColumnChooser,
  EMPTY_SUPPLIER_PAYMENTS_FILTER,
  SupplierPaymentsFilterPanel,
  type SupplierPaymentsFilterValues,
} from "@/components/analytics/supplier-payments-filter"
import type { SupplierPaymentItem, SupplierPaymentsOptions, SupplierPaymentsResult } from "@/components/analytics/supplier-payments-data"
import { RI, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
import { downloadExcelTable } from "@/lib/excel-export"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { formatStatementDate, isIsoDay } from "@/lib/finance/dates"
import { useLanguage } from "@/lib/i18n/language-context"

// "Оплаты поставщикам" (demo #/provider-transaction, chunk 76): read-only list
// of supplier payments made from the cash page (expense with a provider / supply
// category, paid money requests), GET /api/cash/supplier-payments. Blue totals
// strip per currency, filter paper (Период, Организация, Филиалы, Поставщик,
// Валюта), search, paging, "Скачать Excel", "Вкл/Выкл колонки". The URL mirrors
// the demo query (fromDate, toDate, division, branch, provider, currency,
// search, page, pageSize, ordering, openFilterDialog).

const DEFAULT_PAGE_SIZE = 25
const COLUMNS_STORAGE_KEY = "providerTransactionTable"
const NUMBER_DIGITS = 3

type ColumnId = "id" | "client" | "user" | "created_date" | "division" | "amount" | "real_amount" | "cashbox" | "comment"

/** Demo PROVIDER_TRANSACTION_NAMES: id, header, sort key (null = not sortable), relative width. */
const COLUMNS: Array<{ id: ColumnId; label: string; sortable: boolean; width: number; align?: "right" }> = [
  { id: "id", label: "№", sortable: true, width: 5 },
  { id: "client", label: "Поставщик", sortable: true, width: 15 },
  { id: "user", label: "Создал", sortable: true, width: 10 },
  { id: "created_date", label: "Дата оплаты", sortable: true, width: 10 },
  { id: "division", label: "Организация", sortable: true, width: 15 },
  { id: "amount", label: "Сумма", sortable: true, width: 15 },
  { id: "real_amount", label: "Сумма в кассе", sortable: false, width: 10 },
  { id: "cashbox", label: "Касса", sortable: true, width: 10 },
  { id: "comment", label: "Комментарий", sortable: false, width: 10, align: "right" },
]

type UrlState = { filter: SupplierPaymentsFilterValues; search: string; page: number; pageSize: number; ordering: string[]; filterOpen: boolean }

function readUrlState(params: Pick<URLSearchParams, "get" | "getAll">): UrlState {
  const fromDate = params.get("fromDate")
  const toDate = params.get("toDate")
  const pageSize = Number(params.get("pageSize"))
  const page = Number(params.get("page"))
  const list = (name: string) => [...new Set(params.getAll(name).map((value) => value.trim()).filter(Boolean))]
  return {
    filter: {
      from: isIsoDay(fromDate) ? fromDate : "",
      to: isIsoDay(toDate) ? toDate : "",
      organizations: list("division"),
      branches: list("branch"),
      suppliers: [
        ...new Set(
          params
            .getAll("provider")
            .flatMap((value) => value.split(/[-,]/))
            .map((value) => value.trim())
            .filter((value) => /^\d+$/.test(value)),
        ),
      ],
      currency: params.get("currency")?.trim().toUpperCase() ?? "",
    },
    search: params.get("search")?.trim() ?? "",
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: (BALANCE_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
    ordering: (params.get("ordering") ?? "").split(",").filter((value) => COLUMNS.some((column) => column.sortable && value.replace(/^-/, "") === column.id)).slice(0, 1),
    filterOpen: params.get("openFilterDialog") === "true",
  }
}

function readHiddenColumns(): ColumnId[] {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COLUMNS_STORAGE_KEY) ?? "[]")
    return Array.isArray(stored) ? stored.filter((id): id is ColumnId => COLUMNS.some((column) => column.id === id)) : []
  } catch {
    return []
  }
}

function money(value: number, currency?: string) {
  return `${formatMoney(value, NUMBER_DIGITS)}${currency ? ` ${currencyLabel(currency)}` : ""}`
}

function RateHint({ rate, label }: { rate: number | null; label: string }) {
  if (!rate) return null
  const text = `${label}: ${formatMoney(rate, 5)}`
  return (
    <span title={text} aria-label={text} className="inline-flex cursor-help text-[#9aa3b6]">
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

export function SupplierPaymentsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [initial] = useState(() => readUrlState(searchParams))

  const [filter, setFilter] = useState(initial.filter)
  const [searchInput, setSearchInput] = useState(initial.search)
  const [search, setSearch] = useState(initial.search)
  const [paging, setPaging] = useState({ page: initial.page, pageSize: initial.pageSize })
  const [ordering, setOrdering] = useState<string[]>(initial.ordering)
  const [filterOpen, setFilterOpen] = useState(initial.filterOpen)
  const [hidden, setHidden] = useState<ColumnId[]>([])
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState("")

  // Column choice is per browser (demo tables.list → providerTransactionTable).
  useEffect(() => {
    setHidden(readHiddenColumns())
  }, [])
  const changeHidden = (next: string[]) => {
    const ids = next.filter((id): id is ColumnId => COLUMNS.some((column) => column.id === id))
    setHidden(ids)
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(ids))
    } catch {
      // Storage unavailable (private mode): keep the choice for this visit only.
    }
  }

  const query = useMemo(
    () => ({
      from: filter.from,
      to: filter.to,
      organization: filter.organizations,
      branch: filter.branches,
      supplier: filter.suppliers,
      currency: filter.currency,
      search,
      ordering: ordering[0] ?? "",
      page: paging.page,
      pageSize: paging.pageSize,
    }),
    [filter, search, ordering, paging],
  )
  const { data, loading, error, reload } = useCashJson<SupplierPaymentsResult>(`/api/cash/supplier-payments?${buildCashQuery(query)}`)
  const { data: options } = useCashJson<SupplierPaymentsOptions>("/api/cash/supplier-payments/options")
  const rows = data?.rows ?? []
  const base = data?.baseCurrency ?? options?.baseCurrency ?? "SUM"
  const visibleColumns = COLUMNS.filter((column) => !hidden.includes(column.id))
  const totalWidth = visibleColumns.reduce((sum, column) => sum + column.width, 0) || 1

  // Demo counter: every active filter key except fromDate.
  const filterCount = countActiveFilters({
    toDate: filter.from || filter.to ? filter.to || filter.from : "",
    division: filter.organizations,
    branch: filter.branches,
    provider: filter.suppliers,
    currency: filter.currency,
  })

  // A page past the end (rows removed, deep link) falls back to the last page.
  const lastPage = data ? Math.max(1, Math.ceil(data.count / Math.max(1, data.pageSize || 1))) : 1
  if (data && !loading && data.page === paging.page && data.pageSize === paging.pageSize && paging.page > lastPage) {
    setPaging({ page: lastPage, pageSize: paging.pageSize })
  }

  // "Поиск" is applied 500 ms after the last keystroke.
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
    if (filter.from) params.set("fromDate", filter.from)
    if (filter.to) params.set("toDate", filter.to)
    filter.organizations.forEach((name) => params.append("division", name))
    filter.branches.forEach((name) => params.append("branch", name))
    if (filter.suppliers.length) params.set("provider", filter.suppliers.join("-"))
    if (filter.currency) params.set("currency", filter.currency)
    if (search) params.set("search", search)
    if (paging.page > 1) params.set("page", String(paging.page))
    params.set("pageSize", String(paging.pageSize))
    if (ordering.length) params.set("ordering", ordering.join(","))
    if (filterOpen) params.set("openFilterDialog", "true")
    const next = params.toString()
    if (next !== window.location.search.replace(/^\?/, "")) window.history.replaceState(null, "", `${window.location.pathname}${next ? `?${next}` : ""}`)
  }, [filter, search, paging, ordering, filterOpen])

  const applyFilter = (next: SupplierPaymentsFilterValues) => {
    setFilter(next)
    setFilterOpen(false)
    setPaging((current) => ({ ...current, page: 1 }))
  }

  // Demo "×": navigates to an empty query.
  const clearFilter = () => {
    setFilter(EMPTY_SUPPLIER_PAYMENTS_FILTER)
    setSearchInput("")
    setSearch("")
    setPaging((current) => ({ ...current, page: 1 }))
  }

  const dateText = (iso: string) => (iso ? formatStatementDate(iso, language, true) : "")

  const exportExcel = async () => {
    setExporting(true)
    setExportError("")
    try {
      const response = await fetch(`/api/cash/supplier-payments?${buildCashQuery({ ...query, page: undefined, pageSize: 0 })}`, { cache: "no-store" })
      const body = (await response.json().catch(() => null)) as (SupplierPaymentsResult & { error?: string }) | null
      if (!response.ok || !body) throw new Error(body?.error || `HTTP ${response.status}`)
      const header = [
        t("№"),
        t("Поставщик"),
        t("Создал"),
        t("Дата оплаты"),
        t("Организация"),
        t("Сумма"),
        t("Валюта"),
        t("Сумма в кассе"),
        `${t("Валюта")} (${t("Касса")})`,
        t("Касса"),
        t("Комментарий"),
      ]
      const lines = body.rows.map((row) => [
        row.id,
        row.supplier.name,
        row.createdBy || t("Неизвестно"),
        dateText(row.date),
        row.organization,
        row.amount,
        currencyLabel(row.currency),
        row.cash?.amount ?? 0,
        row.cash ? currencyLabel(row.cash.currency) : "",
        row.cashbox?.name ?? t("Не указано"),
        row.comment || t("Не указано"),
      ])
      downloadExcelTable(t("Оплаты поставщикам"), [header, ...lines])
    } catch (reason) {
      setExportError(reason instanceof Error ? t(reason.message) : String(reason))
    } finally {
      setExporting(false)
    }
  }

  const renderCell = (row: SupplierPaymentItem, id: ColumnId): ReactNode => {
    switch (id) {
      case "id":
        return (
          <span className="inline-flex items-center gap-1.5">
            {row.id}
            {!row.isVerified && (
              <span title={t("Не подтверждён")} aria-label={t("Не подтверждён")} className="inline-flex text-[#f0ad4e]">
                <Clock className="h-3.5 w-3.5" />
              </span>
            )}
          </span>
        )
      case "client":
        return <span className="font-medium">{row.supplier.name || t("Не указано")}</span>
      case "user":
        return row.createdBy || t("Неизвестно")
      case "created_date":
        return <span className="whitespace-nowrap">{dateText(row.date)}</span>
      case "division":
        return row.organization
      case "amount": {
        const payment = row.paymentType === "bank" ? t("банковский счет") : t("наличные")
        return (
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="whitespace-nowrap font-semibold" style={{ color: row.amount > 0 ? "#81c784" : row.amount < 0 ? "#e57373" : undefined }}>
                {money(row.amount, row.currency)}
              </span>
              <span title={payment} aria-label={payment} className="inline-flex">
                {row.paymentType === "bank" ? <Landmark className="h-4 w-4 text-[#6261b0]" /> : <Banknote className="h-4 w-4 text-[rgb(79,113,220)]" />}
              </span>
              {row.currency !== base && <RateHint rate={row.rate} label={t("Курс")} />}
            </div>
            {row.currency !== base && row.baseAmount !== null && <div className="whitespace-nowrap text-[11px] text-[#666]">{money(row.baseAmount, base)}</div>}
          </div>
        )
      }
      case "real_amount":
        if (!row.cash) return "0"
        return (
          <div>
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap">{money(row.cash.amount, row.cash.currency)}</span>
              {row.cash.currency !== base && <RateHint rate={row.cash.rate} label={t("Курс")} />}
            </div>
            {row.cash.currency !== base && row.cash.baseAmount !== null && <div className="whitespace-nowrap text-[11px] text-[#666]">{money(row.cash.baseAmount, base)}</div>}
          </div>
        )
      case "cashbox":
        if (!row.cashbox) return t("Не указано")
        return row.cashbox.linked && row.docNo ? (
          <Link href={`/analytics/cash-management?search=${row.docNo}`} className="font-medium text-[#5869f0] hover:underline">
            {row.cashbox.name}
          </Link>
        ) : (
          row.cashbox.name
        )
      case "comment":
        return <span className="break-words">{row.comment || t("Не указано")}</span>
    }
  }

  const WEIGHTS: Record<ColumnId, number> = { id: 1, client: 3, user: 2, created_date: 2, division: 3, amount: 3, real_amount: 2, cashbox: 2, comment: 2 }
  const pageCount = Math.max(1, Math.ceil((data?.count ?? 0) / paging.pageSize))
  const heads = visibleColumns.map((column) => {
    const sorted = ordering.includes(column.id) ? "asc" : ordering.includes(`-${column.id}`) ? "desc" : null
    const label = (
      <span className={column.align === "right" || column.id === "comment" ? "-mr-[22px] block text-right" : undefined}>
        {t(column.label)}
        {sorted ? <span className="ml-1 text-[10px]">{sorted === "asc" ? "▲" : "▼"}</span> : null}
      </span>
    )
    return column.sortable ? (
      <button
        key={column.id}
        type="button"
        onClick={() => {
          setOrdering(nextOrdering(ordering, column.id))
          setPaging((current) => ({ ...current, page: 1 }))
        }}
        className="block w-full text-left font-semibold hover:opacity-80"
      >
        {label}
      </button>
    ) : (
      <span key={column.id}>{label}</span>
    )
  })

  return (
    <RefPage>
      <RefHeader title={t("Оплаты поставщикам")} />
      <div className="flex flex-wrap items-center gap-x-2 bg-[#5869f0] px-[5px] py-[5px] text-[13px] font-semibold leading-4 text-white">
        <span>{t("Оплаты поставщикам")}:</span>
        {loading && !data ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-label={t("Загрузка...")} />
        ) : (
          <span className="flex flex-wrap items-center gap-x-2">
            {(data?.totals.length ? data.totals : [{ currency: base, total: 0, count: 0 }]).map((total, index, list) => (
              <span key={total.currency} className="whitespace-nowrap">
                {money(total.total, total.currency)}
                {index < list.length - 1 ? " ," : ""}
              </span>
            ))}
          </span>
        )}
      </div>

      {error && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md bg-[#fdecec] px-4 py-3 text-sm text-[#c94848]">
          <span>
            {t("Не удалось загрузить данные")}: {t(error)}
          </span>
          <button type="button" onClick={reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <SupplierPaymentsFilterPanel
              open={filterOpen}
              values={filter}
              options={{
                organizations: options?.organizations ?? [],
                branches: options?.branches ?? [],
                suppliers: options?.suppliers ?? [],
                currencies: options?.currencies ?? [base],
              }}
              onApply={applyFilter}
              onClose={() => setFilterOpen(false)}
            />
          }
          query={searchInput}
          onQuery={setSearchInput}
          pageSize={paging.pageSize}
          onPageSize={(size) => setPaging({ page: 1, pageSize: size })}
          from={data?.count ? (paging.page - 1) * paging.pageSize + 1 : 0}
          to={Math.min(paging.page * paging.pageSize, data?.count ?? 0)}
          total={data?.count ?? 0}
          page={paging.page}
          pageCount={pageCount}
          onPage={(page) => setPaging((current) => ({ ...current, page }))}
          icons={
            <>
              <RefIconButton path={RI.download} label={exporting ? t("Загрузка...") : t("Скачать Excel")} onClick={() => void (!exporting && data?.count && exportExcel())} color="#333" />
              <ColumnChooser columns={COLUMNS} hidden={hidden} onChange={changeHidden} />
            </>
          }
        />
        {exportError && <div className="bg-white px-5 pb-2 text-sm text-[#e57373]">{exportError}</div>}
        <RefTable
          cols={visibleColumns.map((column) => `minmax(0,${WEIGHTS[column.id]}fr)`).join(" ")}
          heads={heads}
          headPad={30}
          rows={rows}
          rowKey={(row) => row.id}
          empty={loading && !rows.length ? t("Загрузка...") : error ? t("Не удалось загрузить данные") : t("По вашему запросу ничего не найдено")}
          render={(row) => visibleColumns.map((column) => (column.id === "comment" ? <div key={column.id} className="text-right">{renderCell(row, column.id)}</div> : renderCell(row, column.id)))}
        />
      </RefCard>
    </RefPage>
  )
}
