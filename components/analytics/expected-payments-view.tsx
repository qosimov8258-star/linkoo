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
import { RI, RefCard, RefHeader, RefIconButton, RefPage, RefTable, RefToolbar } from "@/components/ref/list-kit"
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

  const cols = "123.3px 230.7px 230.7px 115.3px 231px 230px 231px"
  const heads = [
    ...(state.showCheckboxes ? [<input key="all" type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label={t("Выбрать все")} className="h-4 w-4 accent-[#4f71dc]" />] : []),
    ...COLUMNS.map((column) => {
      const label = (
        <span className={column.align === "right" ? `block text-right ${column.id === "total_balance" ? "-mr-[30px]" : "-mr-[22px]"}` : undefined}>
          {t(column.label)}
          {state.ordering === column.id ? <span className="ml-1 text-[10px]">▲</span> : state.ordering === `-${column.id}` ? <span className="ml-1 text-[10px]">▼</span> : null}
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
  const pageCount = Math.max(1, Math.ceil((list.data?.count ?? 0) / state.pageSize))

  return (
    <RefPage>
      <RefHeader title={t("Ожидаемые оплаты")} />
      {hasSelection && (
        <div className="mb-2 bg-[#09890f] px-[5px] py-[5px] text-[13px] font-semibold leading-4 text-white">
          {t("Выбрано")}: {selectedRows.length} · {cards.map((card) => `${formatMoney(card.total, 3)} ${currencyLabel(card.currency)}`).join(" , ")}
        </div>
      )}
      <RefCard>
        <RefToolbar
          linkFilter="flush"
          filterOpen={filterOpen}
          onToggleFilter={() => setFilterOpen((value) => !value)}
          filterPanel={
            <ExpectedPaymentsFilterDialog
              filters={state.filters}
              options={optionsState.data}
              onClose={() => setFilterOpen(false)}
              onApply={(filters) => {
                setFilterOpen(false)
                update({ filters, page: 1 })
              }}
            />
          }
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
              <RefIconButton
                path={RI.checklist}
                label={t(state.showCheckboxes ? "Спрятать флажки" : "Выбрать из списка")}
                onClick={() => {
                  setSelected({})
                  update({ showCheckboxes: !state.showCheckboxes })
                }}
                color="#5d6474"
                active={state.showCheckboxes}
              />
              <RefIconButton path={RI.download} label={t("Скачать")} onClick={() => rows.length && exportPage()} color="#333" />
            </>
          }
        />

        {list.error && (
          <div className="flex flex-wrap items-center gap-3 bg-white px-5 py-3 text-[#e57373]">
            <span>
              {t("Не удалось загрузить данные")}: {t(list.error)}
            </span>
            <button type="button" onClick={list.reload} className="font-semibold text-[#4f70e7] hover:underline">
              {t("Повторить")}
            </button>
          </div>
        )}

        <RefTable
          cols={`${state.showCheckboxes ? "40px " : ""}${cols}`}
          heads={heads}
          headPad={30}
          rows={rows}
          rowKey={(row) => row.key}
          onRowClick={(row) => setPaying(row)}
          rowClass={(row) => (selected[row.key] ? "!bg-[#eaf0fd]" : "")}
          empty={list.loading ? t("Загрузка...") : list.error ? "" : t("По вашему запросу ничего не найдено")}
          render={(row) => [
            ...(state.showCheckboxes ? [<span key="check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={Boolean(selected[row.key])} onChange={() => toggleRow(row)} aria-label={`№ ${row.orderId}`} className="h-4 w-4 accent-[#4f71dc]" /></span>] : []),
            row.orderId,
            <div key="client">
              <div>{row.client.name}</div>
              {row.zone && <div className="text-[#4f71dc]">{row.zone}</div>}
            </div>,
            created(row.createdAt),
            due(row.paymentDate),
            row.organization,
            <div key="total" className="flex items-center justify-end gap-[6px] whitespace-nowrap text-right">
              {formatMoney(row.total, 3)} {currencyLabel(row.currency)}
              <svg viewBox="0 0 24 24" className="h-4 w-4 fill-[#4f71dc]" aria-label={row.paymentType === "bank" ? t("банковский счет") : t("наличный")}>
                <path d={row.paymentType === "bank" ? RI.card : "M3 5v14h18V5H3zm16 12H5V7h14v10zM12 8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"} />
              </svg>
            </div>,
            <div key="remaining" className="-mr-2 text-right">{formatMoney(row.remaining, 3)}</div>,
          ]}
        />
      </RefCard>

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
    </RefPage>
  )
}
