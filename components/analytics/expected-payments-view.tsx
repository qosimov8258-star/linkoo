"use client"

import { useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, CheckSquare, CreditCard, Download, RefreshCw, Search, Square } from "lucide-react"

import { nextOrdering } from "@/components/analytics/balance/balance-table"
import { BalanceFilterChip } from "@/components/analytics/balance/filter-bar"
import { BalancePagination } from "@/components/analytics/balance/pagination"
import { buildCashQuery, useCashJson } from "@/components/analytics/cash/use-cash"
import {
  countExpectedFilters,
  emptyExpectedFilters,
  expectedListQuery,
  expectedStateFromParams,
  expectedStateToSearch,
  ExpectedPaymentsFilterDialog,
  type ExpectedPaymentsState,
} from "@/components/analytics/expected-payments-filters"
import { ExpectedPaymentPayDialog } from "@/components/analytics/expected-payments-pay-dialog"
import { formatRuDate } from "@/components/analytics/customer-payments-filters"
import { FavoritesButton } from "@/components/dashboard/favorites-drawer"
import { downloadExcelTable } from "@/lib/excel-export"
import type { CustomerPaymentOptions, ExpectedOrderRow, ExpectedOrdersResult, ExpectedOrderTotal } from "@/lib/cash/customer-payments-types"
import { currencyLabel, formatMoney } from "@/lib/finance/currency"
import { useLanguage } from "@/lib/i18n/language-context"

// "Ожидаемые оплаты" (demo #/pending-payments, chunk 72 module 4127): orders
// (not cancelled) with an unpaid remainder, one row per order × currency,
// server paging / sorting / search and the demo's 10 filters in the URL;
// header cards per currency (Σ order totals with the cash / bank split, green
// and computed from the rows when some are selected); a row click opens the
// shared "Приход" dialog in order mode, which pays the order through the cash
// core (customer payment with order_id).

const LIST_URL = "/api/cash/customer-payments/expected"

type ColumnId = "id" | "client" | "created_date" | "payment_date" | "division" | "total_price" | "total_balance"

const COLUMNS: Array<{ id: ColumnId; label: string; sortable: boolean; align?: "right" }> = [
  { id: "id", label: "№ зак.", sortable: true },
  { id: "client", label: "Клиент", sortable: false },
  { id: "created_date", label: "Дата создания", sortable: true },
  { id: "payment_date", label: "Дата оплаты", sortable: true },
  { id: "division", label: "Организация", sortable: false },
  { id: "total_price", label: "Сумма заказа", sortable: true, align: "right" },
  { id: "total_balance", label: "Остаток", sortable: true, align: "right" },
]

/** Demo getTotalsFromList(selectedRows): Σ order totals by currency and payment type. */
function totalsOf(rows: ExpectedOrderRow[]): ExpectedOrderTotal[] {
  const map = new Map<string, ExpectedOrderTotal>()
  for (const row of rows) {
    let item = map.get(row.currency)
    if (!item) {
      item = {
        currency: row.currency,
        total: 0,
        remaining: 0,
        paymentTypes: [
          { paymentType: "cash", total: 0, remaining: 0 },
          { paymentType: "bank", total: 0, remaining: 0 },
        ],
      }
      map.set(row.currency, item)
    }
    item.total += row.total
    item.remaining += row.remaining
    const part = item.paymentTypes.find((entry) => entry.paymentType === row.paymentType)!
    part.total += row.total
    part.remaining += row.remaining
  }
  return [...map.values()]
}

function TotalsCards({ totals, selected, loading }: { totals: ExpectedOrderTotal[]; selected: boolean; loading: boolean }) {
  const { t } = useLanguage()
  if (!totals.length) return null
  const color = selected ? "#09890f" : "rgb(79, 113, 220)"
  return (
    <div className={`grid w-full grid-cols-1 gap-3 sm:grid-cols-2 lg:w-auto lg:min-w-[540px] lg:grid-cols-3 ${loading ? "opacity-60" : ""}`}>
      {totals.map((item) => {
        const cash = item.paymentTypes.find((entry) => entry.paymentType === "cash")?.total ?? 0
        const bank = item.paymentTypes.find((entry) => entry.paymentType === "bank")?.total ?? 0
        return (
          <div key={item.currency} className="rounded-md bg-white px-4 py-3 shadow-sm">
            <p className="text-right text-[20px] font-bold" style={{ color }}>
              {formatMoney(item.total, 3)} {currencyLabel(item.currency)}
            </p>
            <div className="mt-2 border-t border-[#e1e5eb] pt-2 text-[13px] text-[#586174]">
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <Banknote className="h-4 w-4 text-[#4f70e7]" /> {t("Наличными")}
                </span>
                <span className="font-semibold text-[#17233b]">{formatMoney(cash, 3)}</span>
              </p>
              <p className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5">
                  <CreditCard className="h-4 w-4 text-[#8e5ad8]" /> {t("Перечислением")}
                </span>
                <span className="font-semibold text-[#17233b]">{formatMoney(bank, 3)}</span>
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function ExpectedPaymentsView() {
  const { t, language } = useLanguage()
  const searchParams = useSearchParams()
  const [state, setState] = useState<ExpectedPaymentsState>(() => expectedStateFromParams(searchParams))
  const [searchDraft, setSearchDraft] = useState(state.search)
  const [filterOpen, setFilterOpen] = useState(false)
  const [selected, setSelected] = useState<Record<string, ExpectedOrderRow>>({})
  const [paying, setPaying] = useState<ExpectedOrderRow | null>(null)
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null)

  const list = useCashJson<ExpectedOrdersResult>(`${LIST_URL}?${buildCashQuery(expectedListQuery(state))}`)
  const optionsState = useCashJson<CustomerPaymentOptions>("/api/cash/customer-payments/options")
  const rows = useMemo(() => list.data?.rows ?? [], [list.data])
  const selectedRows = Object.values(selected)
  const hasSelection = selectedRows.length > 0
  const cards = hasSelection ? totalsOf(selectedRows) : (list.data?.totals ?? [])

  useEffect(() => {
    const search = expectedStateToSearch(state)
    if (window.location.search.slice(1) !== search) window.history.replaceState(window.history.state, "", `${window.location.pathname}?${search}`)
  }, [state])

  useEffect(() => {
    const value = searchDraft.trim()
    if (value === state.search) return
    const timer = window.setTimeout(() => setState((current) => ({ ...current, search: value, page: 1 })), 400)
    return () => window.clearTimeout(timer)
  }, [searchDraft, state.search])

  useEffect(() => {
    const data = list.data
    if (!data || list.loading || data.rows.length || state.page <= 1) return
    const last = Math.max(1, Math.ceil(data.count / Math.max(1, state.pageSize)))
    if (state.page > last) setState((current) => ({ ...current, page: last }))
  }, [list.data, list.loading, state.page, state.pageSize])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(null), 3500)
    return () => window.clearTimeout(timer)
  }, [notice])

  const update = (patch: Partial<ExpectedPaymentsState>) => setState((current) => ({ ...current, ...patch }))
  const sort = (id: ColumnId) => update({ ordering: nextOrdering(state.ordering ? [state.ordering] : [], id, "asc-first")[0] ?? "", page: 1 })
  const sortIcon = (id: ColumnId) =>
    state.ordering === id ? <ArrowUp className="h-3.5 w-3.5" /> : state.ordering === `-${id}` ? <ArrowDown className="h-3.5 w-3.5" /> : <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />

  const toggleRow = (row: ExpectedOrderRow) =>
    setSelected((current) => {
      const next = { ...current }
      if (next[row.key]) delete next[row.key]
      else next[row.key] = row
      return next
    })
  const allOnPage = rows.length > 0 && rows.every((row) => selected[row.key])
  const toggleAll = () =>
    setSelected((current) => {
      const next = { ...current }
      for (const row of rows) {
        if (allOnPage) delete next[row.key]
        else next[row.key] = row
      }
      return next
    })

  const created = (iso: string) => (iso ? formatRuDate(iso, true, language) : "")
  const due = (iso: string) => (iso ? formatRuDate(iso, false, language) : t("Не указано"))

  const exportPage = () =>
    downloadExcelTable(t("Ожидаемые оплаты"), [
      COLUMNS.map((column) => t(column.label)),
      ...rows.map((row) => [
        row.orderId,
        row.client.name,
        row.createdAt ? formatRuDate(row.createdAt, false, language) : "",
        due(row.paymentDate),
        row.organization,
        `${formatMoney(row.total, 3)} ${currencyLabel(row.currency)}`,
        formatMoney(row.remaining, 3),
      ]),
    ])

  const filterCount = countExpectedFilters(state.filters)
  const columnCount = COLUMNS.length + (state.showCheckboxes ? 1 : 0)

  return (
    <main className="min-h-screen bg-white text-[#17233b]">
      <header className="flex min-h-[76px] flex-wrap items-center justify-between gap-4 border-b border-[#d8dee7] bg-[#f2f5f8] px-4 py-3 md:px-9">
        <div className="flex min-w-0 items-center gap-3">
          <FavoritesButton className="flex items-center gap-3 text-2xl font-bold text-[#4f70e7]" />
          <span className="text-3xl font-light text-[#586174]">|</span>
          <h1 className="truncate text-xl font-bold text-[#586174] md:text-2xl">{t("Ожидаемые оплаты")}</h1>
        </div>
        <TotalsCards totals={cards} selected={hasSelection} loading={list.loading && !hasSelection} />
      </header>

      <section className="flex flex-wrap items-center gap-3 border-b border-[#e1e5eb] bg-white px-4 py-3 md:px-9">
        <BalanceFilterChip
          count={filterCount}
          onOpen={() => setFilterOpen(true)}
          onClear={() => {
            setSearchDraft("")
            update({ filters: emptyExpectedFilters(), search: "", page: 1 })
          }}
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
            <span className="font-semibold text-[#17233b]">
              {t("Выбрано")}: {selectedRows.length}
            </span>
          )}
          <BalancePagination page={state.page} pageSize={state.pageSize} count={list.data?.count ?? 0} onChange={({ page, pageSize }) => update({ page, pageSize })} />
          <button
            type="button"
            title={t(state.showCheckboxes ? "Спрятать флажки" : "Выбрать из списка")}
            aria-label={t(state.showCheckboxes ? "Спрятать флажки" : "Выбрать из списка")}
            onClick={() => {
              setSelected({})
              update({ showCheckboxes: !state.showCheckboxes })
            }}
            className="p-1 text-[#586174] hover:text-[#4f70e7]"
          >
            {state.showCheckboxes ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
          </button>
          <button type="button" title={t("Скачать")} aria-label={t("Скачать")} disabled={!rows.length} onClick={exportPage} className="p-1 text-[#586174] hover:text-[#4f70e7] disabled:opacity-40">
            <Download className="h-5 w-5" />
          </button>
          <button type="button" title={t("Обновить список")} aria-label={t("Обновить список")} onClick={list.reload} className="p-1 text-[#586174] hover:text-[#4f70e7]">
            <RefreshCw className={`h-5 w-5 ${list.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {list.error && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-[#e57373] md:px-9">
          <span>
            {t("Не удалось загрузить данные")}: {t(list.error)}
          </span>
          <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
            {t("Повторить")}
          </button>
        </div>
      )}

      <section className={`overflow-x-auto pb-10 ${list.loading ? "opacity-60" : ""}`}>
        <table className="w-full min-w-[900px] border-collapse text-[14px]">
          <thead>
            <tr className="bg-[#edf2f7] text-[#253653]">
              {state.showCheckboxes && (
                <th className="w-10 border-b border-[#e1e5eb] px-2 py-3">
                  <input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-4 w-4 accent-[#4f70e7]" />
                </th>
              )}
              {COLUMNS.map((column) => (
                <th key={column.id} className={`border-b border-[#e1e5eb] px-3 py-3 font-semibold whitespace-nowrap ${column.align === "right" ? "text-right" : "text-left"}`}>
                  {column.sortable ? (
                    <button type="button" onClick={() => sort(column.id)} className="inline-flex items-center gap-1">
                      {t(column.label)}
                      {sortIcon(column.id)}
                    </button>
                  ) : (
                    t(column.label)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const background = selected[row.key] ? "#eaf0fd" : index % 2 ? "#F4F8FB" : "#ffffff"
              return (
                <tr
                  key={row.key}
                  onClick={() => setPaying(row)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") setPaying(row)
                  }}
                  tabIndex={0}
                  className="cursor-pointer border-b border-dashed border-[#e1e5eb] hover:bg-[#eef3fb]"
                  style={{ background }}
                >
                  {state.showCheckboxes && (
                    <td className="px-2 py-3 text-center" onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" checked={Boolean(selected[row.key])} onChange={() => toggleRow(row)} aria-label={`№ ${row.orderId}`} className="h-4 w-4 accent-[#4f70e7]" />
                    </td>
                  )}
                  <td className="px-3 py-3">{row.orderId}</td>
                  <td className="px-3 py-3">
                    <div>{row.client.name}</div>
                    {row.zone && <div className="text-[13px] text-[#4f70e7]">{row.zone}</div>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3">{created(row.createdAt)}</td>
                  <td className="whitespace-nowrap px-3 py-3">{due(row.paymentDate)}</td>
                  <td className="px-3 py-3">{row.organization}</td>
                  <td className="px-3 py-3 text-right">
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      {formatMoney(row.total, 3)} {currencyLabel(row.currency)}
                      {row.paymentType === "bank" ? (
                        <span title={t("банковский счет")} className="inline-flex">
                          <CreditCard className="h-4 w-4 text-[#8e5ad8]" />
                        </span>
                      ) : (
                        <span title={t("наличный")} className="inline-flex">
                          <Banknote className="h-4 w-4 text-[#4f70e7]" />
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-right font-semibold">{formatMoney(row.remaining, 3)}</td>
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

      {filterOpen && (
        <ExpectedPaymentsFilterDialog
          filters={state.filters}
          options={optionsState.data}
          onClose={() => setFilterOpen(false)}
          onApply={(filters) => {
            setFilterOpen(false)
            update({ filters, page: 1 })
          }}
        />
      )}

      {paying && (
        <ExpectedPaymentPayDialog
          key={paying.key}
          orderId={paying.orderId}
          currency={paying.currency}
          options={optionsState.data}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null)
            setSelected({})
            list.reload()
            setNotice({ text: t("Успешно сохранено"), error: false })
          }}
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
